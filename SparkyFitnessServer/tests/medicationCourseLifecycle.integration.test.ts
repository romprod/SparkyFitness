import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  courseSlotsForDay,
  isScheduleDueOnDate,
  addDays,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import {
  getClient,
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import {
  createMedicationCourse,
  reviewMedicationCourse,
  reviseMedicationCourse,
  editMedicationCourse,
  setMedicationCourseStatus,
  deleteMedicationCourseRevision,
  getMedicationCourse,
  listMedicationCourses,
  getMedicationCourseHistory,
  reviewMedicationCourseCreate,
  listCourseHandoffRules,
  getMedicationCourseDue,
} from '../services/medicationCourseService.js';
import {
  lockCourseMedication,
  transitionCourseMedicationActivity,
  coursePlan,
} from '../models/medicationCourseRepository.js';
import injectionRepository from '../models/injectionRepository.js';
import medicationEntryRepository from '../models/medicationEntryRepository.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

describe.runIf(process.env.MEDICATION_COURSE_LIFECYCLE_INTEGRATION === '1')(
  'course lifecycle and revision transactions PostgreSQL',
  () => {
    const owner = randomUUID();
    const start = new Date('2026-11-01T00:00:00Z'),
      now = new Date('2026-11-16T12:00:00Z');
    beforeAll(async () => {
      const c: PoolClient = await getSystemClient();
      try {
        await c.query(
          'INSERT INTO public."user"(id,email,name,email_verified) VALUES($1,$2,$3,true)',
          [
            owner,
            `synthetic-course-${owner}@example.test`,
            'Synthetic course lifecycle',
          ]
        );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Europe/London') ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone",
          [owner]
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c: PoolClient = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=$1', [owner]);
      } finally {
        c.release();
        await endPool();
      }
    });
    const create = async (plan: Partial<MedicationCoursePlanInput> = {}) => {
      const c: PoolClient = await getSystemClient();
      let med: string;
      try {
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic lifecycle medication','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const authored = { ...medicationCoursePlanFixture(), ...plan };
      const result = await createMedicationCourse(
        owner,
        {
          ...authored,
          medication_id: med,
          operation_id: randomUUID(),
          expected_version: 0,
          native_reminder_limitation_acknowledged: false,
        },
        start
      );
      return { med, authored, result };
    };
    const actual = async (med: string, revision: string, day: string) => {
      const c: PoolClient = await getSystemClient();
      try {
        await c.query(
          "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,status,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id) VALUES($1,$2,$3,$4,'taken','Recorded synthetic',1,'tablet',$5)",
          [owner, med, day, `${day}T08:00:00Z`, revision]
        );
      } finally {
        c.release();
      }
    };
    const master = async (
      med: string,
      before: boolean,
      after: boolean,
      at: Date
    ) => {
      const c: PoolClient = await getClient(owner);
      try {
        await c.query('BEGIN');
        await lockCourseMedication(c, owner, med);
        await c.query(
          'UPDATE medications SET is_active=$3 WHERE user_id=$1 AND id=$2',
          [owner, med, after]
        );
        await transitionCourseMedicationActivity(
          c,
          owner,
          med,
          before,
          after,
          at
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    };
    it('serializes competing revisions and rejects new actuals after review without partial successors', async () => {
      const { med, authored, result } = await create();
      await actual(med, result.revision_id!, '2026-11-05');
      const plan = { ...authored, start_date: '2026-11-10', target_dose: '2' };
      let review = await reviewMedicationCourse(
        owner,
        result.course_id,
        { ...plan, expected_version: 1 },
        now
      );
      await actual(med, result.revision_id!, '2026-11-06');
      await expect(
        reviseMedicationCourse(
          owner,
          result.course_id,
          {
            ...plan,
            operation_id: randomUUID(),
            expected_version: 1,
            review_fingerprint: review.review_fingerprint,
          },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(
        (await getMedicationCourse(owner, result.course_id)).course.revisions
      ).toHaveLength(1);
      review = await reviewMedicationCourse(
        owner,
        result.course_id,
        { ...plan, expected_version: 1 },
        now
      );
      const outcomes = await Promise.allSettled(
        [1, 2].map(() =>
          reviseMedicationCourse(
            owner,
            result.course_id,
            {
              ...plan,
              operation_id: randomUUID(),
              expected_version: 1,
              review_fingerprint: review.review_fingerprint,
            },
            now
          )
        )
      );
      expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((x) => x.status === 'rejected')).toHaveLength(1);
      expect(
        (await getMedicationCourse(owner, result.course_id)).course.revisions
      ).toHaveLength(2);
    });
    it('preserves future predecessor dues and instant master activity without resurrecting a deleted future tip', async () => {
      const { med, authored, result } = await create({
        rules: [
          { schedule_type_id: 'daily', time_of_day: '08:00:00' },
          { schedule_type_id: 'daily', time_of_day: '12:01:30' },
        ],
      });
      const plan = { ...authored, start_date: '2026-11-20' };
      const review = await reviewMedicationCourse(
        owner,
        result.course_id,
        { ...plan, expected_version: 1 },
        now
      );
      const revised = await reviseMedicationCourse(
        owner,
        result.course_id,
        {
          ...plan,
          operation_id: randomUUID(),
          expected_version: 1,
          review_fingerprint: review.review_fingerprint,
        },
        now
      );
      let course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(
        courseSlotsForDay({
          course,
          day: '2026-11-17',
          today: '2026-11-16',
          nowInstant: now.toISOString(),
          medicationActive: true,
          delivered: [],
        })[0]?.course_revision_id
      ).toBe(result.revision_id);
      await master(med, true, false, new Date('2026-11-16T12:01:00Z'));
      await master(med, false, true, new Date('2026-11-16T12:02:00Z'));
      course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(course.version).toBe(4);
      const afterGap = courseSlotsForDay({
        course,
        day: '2026-11-16',
        today: '2026-11-16',
        nowInstant: '2026-11-16T13:00:00Z',
        medicationActive: true,
        delivered: [],
      });
      expect(afterGap.some((s) => s.time_of_day === '08:00:00')).toBe(true);
      expect(afterGap.some((s) => s.time_of_day === '12:01:30')).toBe(false);
      expect(course.revisions[0]?.activity.at(-1)?.from_at).toBe(
        '2026-11-16T12:02:00.000Z'
      );
      const futureSlot = courseSlotsForDay({
        course,
        day: '2026-11-20',
        today: '2026-11-16',
        nowInstant: now.toISOString(),
        medicationActive: true,
        delivered: [],
      })[0]!;
      const captured: PoolClient = await getSystemClient();
      let actualId: string;
      try {
        actualId = (
          await captured.query(
            "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,status,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id,course_rule_id,course_slot_key,scheduled_for,scheduled_day) VALUES($1,$2,'2026-11-16','2026-11-16T12:00:00Z','taken','Recorded synthetic',1,'tablet',$3,$4,$5,$6,$7) RETURNING id",
            [
              owner,
              med,
              futureSlot.course_revision_id,
              futureSlot.course_rule_id,
              futureSlot.course_slot_key,
              futureSlot.scheduled_for,
              futureSlot.scheduled_day,
            ]
          )
        ).rows[0].id;
      } finally {
        captured.release();
      }
      const deleted = await deleteMedicationCourseRevision(
        owner,
        result.course_id,
        revised.revision_id,
        { operation_id: randomUUID(), expected_version: course.version },
        new Date('2026-11-16T12:03:00Z')
      );
      course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(course.current_revision_id).toBeNull();
      expect(course.deleted_at).toBeNull();
      expect(
        (await listMedicationCourses(owner)).courses.some(
          (c) => c.id === course.id
        )
      ).toBe(true);
      await master(med, true, false, new Date('2026-11-16T12:04:00Z'));
      await master(med, false, true, new Date('2026-11-16T12:05:00Z'));
      course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(
        course.revisions
          .flatMap((r) => r.activity)
          .some((a) => a.until_at === null)
      ).toBe(false);
      expect(
        courseSlotsForDay({
          course,
          day: '2026-11-17',
          today: '2026-11-16',
          nowInstant: now.toISOString(),
          medicationActive: true,
          delivered: [],
        })
      ).toEqual([]);
      expect(deleted.revision_id).toBeNull();
      const preserved: PoolClient = await getSystemClient();
      try {
        const row = (
          await preserved.query(
            'SELECT course_revision_id,course_rule_id,course_slot_key,scheduled_day::text,scheduled_for,course_origin,taken_at FROM medication_entries WHERE user_id=$1 AND id=$2',
            [owner, actualId]
          )
        ).rows[0];
        expect(row).toMatchObject({
          course_revision_id: null,
          course_rule_id: null,
          course_slot_key: null,
          scheduled_day: '2026-11-20',
          course_origin: true,
        });
        expect(new Date(row.scheduled_for).toISOString()).toBe(
          futureSlot.scheduled_for
        );
        expect(new Date(row.taken_at).toISOString()).toBe(
          '2026-11-16T12:00:00.000Z'
        );
      } finally {
        preserved.release();
      }
    });
    it('does not automatically extend completion on reopen and preserves stable IDs for nonmaterial correction', async () => {
      const { authored, result } = await create({ end_date: '2026-12-31' });
      let course = (await getMedicationCourse(owner, result.course_id)).course;
      const ruleId = course.revisions[0]!.rules[0]!.id;
      await editMedicationCourse(
        owner,
        result.course_id,
        {
          ...authored,
          target_dose: '2',
          operation_id: randomUUID(),
          expected_version: 1,
        },
        now
      );
      course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(course.revisions[0]!.rules[0]!.id).toBe(ruleId);
      await setMedicationCourseStatus(
        owner,
        result.course_id,
        {
          status: 'completed',
          operation_id: randomUUID(),
          expected_version: 2,
        },
        now
      );
      await setMedicationCourseStatus(
        owner,
        result.course_id,
        { status: 'active', operation_id: randomUUID(), expected_version: 3 },
        new Date('2026-11-17T12:00:00Z')
      );
      course = (await getMedicationCourse(owner, result.course_id)).course;
      expect(course.revisions[0]?.end_date).toBe('2026-11-16');
      expect(
        courseSlotsForDay({
          course,
          day: '2026-11-18',
          today: '2026-11-17',
          nowInstant: '2026-11-17T12:00:00Z',
          medicationActive: true,
          delivered: [],
        })
      ).toEqual([]);
    });
    it('retains last attributed old actuals after a backdated overlap and keeps the new expected lineage cut explicit', async () => {
      const { med, authored, result } = await create();
      await actual(med, result.revision_id!, '2026-11-15');
      const plan = {
        ...authored,
        start_date: '2026-11-10',
        cycle_anchor_date: '2026-10-01',
      };
      const review = await reviewMedicationCourse(
        owner,
        result.course_id,
        { ...plan, expected_version: 1 },
        now
      );
      const next = await reviseMedicationCourse(
        owner,
        result.course_id,
        {
          ...plan,
          operation_id: randomUUID(),
          expected_version: 1,
          review_fingerprint: review.review_fingerprint,
        },
        now
      );
      const course = (await getMedicationCourse(owner, result.course_id))
        .course;
      expect(course.revisions[0]?.closed_date).toBe('2026-11-15');
      expect(course.revisions[1]?.cycle_anchor_date).toBe('2026-10-01');
      const slots = courseSlotsForDay({
        course,
        day: '2026-11-12',
        today: '2026-11-16',
        nowInstant: now.toISOString(),
        medicationActive: true,
        delivered: [],
      });
      expect(
        slots.every((s) => s.course_revision_id === next.revision_id)
      ).toBe(true);
      const history = await getMedicationCourseHistory(
        owner,
        result.course_id,
        undefined,
        undefined,
        now
      );
      expect(history.actuals).toHaveLength(1);
      expect(history.actuals[0]?.course_revision_id).toBe(result.revision_id);
      expect(history.from_date).toBe('2026-11-01');
    });
    it('preserves heterogeneous original cyclic anchors through handoff review and ordinary revision', async () => {
      const { med, authored } = await create();
      const c: PoolClient = await getSystemClient();
      let selectedIds: string[];
      try {
        selectedIds = (
          await c.query(
            "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,start_date,cycle_on_days,cycle_off_days,active) VALUES($1,$2,'cyclic','08:00','2026-03-04',2,3,true),($1,$2,'cyclic','20:00','2026-03-07',2,3,true),($1,$2,'cyclic','12:00',NULL,2,3,true) RETURNING id",
            [owner, med]
          )
        ).rows.map((row) => String(row.id));
      } finally {
        c.release();
      }
      const candidates = await listCourseHandoffRules(owner, med, now);
      const handoff = {
        cutover_day: '2026-11-16',
        selected_rules: candidates.rules
          .filter((row) => selectedIds.includes(row.schedule_id))
          .map(({ schedule_id, fingerprint }) => ({
            schedule_id,
            fingerprint,
          })),
      };
      const reviewedHandoff = await reviewMedicationCourseCreate(
        owner,
        med,
        {
          ...authored,
          start_date: '2026-11-16',
          cycle_anchor_date: null,
          expected_version: 0,
          handoff,
        },
        now
      );
      expect(
        reviewedHandoff.plan.rules.find(
          (rule) => rule.time_of_day === '12:00:00'
        )?.anchor_date
      ).toBe('2020-01-01');
      const captured = await createMedicationCourse(
        owner,
        {
          ...reviewedHandoff.plan,
          medication_id: med,
          operation_id: randomUUID(),
          expected_version: 0,
          handoff,
          native_reminder_limitation_acknowledged: true,
          review_fingerprint: reviewedHandoff.review_fingerprint,
        },
        now
      );
      const before = (await getMedicationCourse(owner, captured.course_id))
        .course;
      const old = before.revisions[0]!;
      expect(old.cycle_anchor_date).toBeNull();
      expect(old.start_date).toBe('2026-11-16');
      expect(old.rules.map((rule) => rule.anchor_date).sort()).toEqual([
        '2020-01-01',
        '2026-03-04',
        '2026-03-07',
      ]);
      const requested = { ...coursePlan(old), start_date: '2026-11-20' };
      const review = await reviewMedicationCourse(
        owner,
        captured.course_id,
        { ...requested, expected_version: 1 },
        now
      );
      expect(review.plan.cycle_anchor_date).toBeNull();
      const changed = await reviseMedicationCourse(
        owner,
        captured.course_id,
        {
          ...review.plan,
          operation_id: randomUUID(),
          expected_version: 1,
          review_fingerprint: review.review_fingerprint,
        },
        now
      );
      const after = (await getMedicationCourse(owner, captured.course_id))
        .course;
      const next = after.revisions.find(
        (revision) => revision.id === changed.revision_id
      )!;
      expect(next.cycle_anchor_date).toBeNull();
      expect(next.rules.map((rule) => rule.anchor_date).sort()).toEqual([
        '2020-01-01',
        '2026-03-04',
        '2026-03-07',
      ]);
      for (let day = '2026-11-20'; day <= '2026-11-27'; day = addDays(day, 1)) {
        const slots = courseSlotsForDay({
          course: after,
          day,
          today: '2026-11-16',
          nowInstant: now.toISOString(),
          medicationActive: true,
          delivered: [],
        }).filter((slot) => slot.course_revision_id === next.id);
        for (const rule of old.rules) {
          const expected = isScheduleDueOnDate(
            {
              ...rule,
              dose_amount: null,
              active: true,
              start_date: rule.anchor_date ?? rule.start_date ?? old.start_date,
            },
            day
          );
          expect(
            slots.some((slot) => slot.time_of_day === rule.time_of_day)
          ).toBe(expected);
        }
      }
      const explicit = {
        ...coursePlan(next),
        start_date: '2026-11-28',
        rules: next.rules.map((rule) => ({
          ...coursePlan(next).rules[rule.rule_index]!,
          anchor_date:
            rule.time_of_day === '08:00:00' ? '2026-03-10' : rule.anchor_date,
        })),
      };
      const explicitReview = await reviewMedicationCourse(
        owner,
        captured.course_id,
        { ...explicit, expected_version: 2 },
        now
      );
      expect(
        explicitReview.plan.rules.find(
          (rule) => rule.time_of_day === '08:00:00'
        )?.anchor_date
      ).toBe('2026-03-10');
      await reviseMedicationCourse(
        owner,
        captured.course_id,
        {
          ...explicitReview.plan,
          operation_id: randomUUID(),
          expected_version: 2,
          review_fingerprint: explicitReview.review_fingerprint,
        },
        now
      );
      const final = (await getMedicationCourse(owner, captured.course_id))
        .course;
      expect(
        final.revisions[2]?.rules.find(
          (rule) => rule.time_of_day === '08:00:00'
        )?.anchor_date
      ).toBe('2026-03-10');
      expect(
        final.revisions[2]?.rules.find(
          (rule) => rule.time_of_day === '20:00:00'
        )?.anchor_date
      ).toBe('2026-03-07');
    });
    it('reports a past selected slot fulfilled by an actual now without leaking unrelated history or stale state', async () => {
      const { med, result } = await create();
      const past = '2026-11-05';
      const before = await getMedicationCourseDue(owner, past, now);
      const selected = before.slots.find(
        (s) => s.course_id === result.course_id
      )!;
      const logged: { id: string } = await injectionRepository.createInjection(
        owner,
        {
          medication_id: med,
          entry_date: '2026-11-16',
          injected_at: now.toISOString(),
          dose_mg: 1,
          deduct_pen: false,
          course_revision_id: selected.course_revision_id,
          course_rule_id: selected.course_rule_id,
          course_slot_key: selected.course_slot_key,
          scheduled_day: past,
          scheduled_for: selected.scheduled_for,
          course_expected_version: selected.course_expected_version,
        }
      );
      const due = await getMedicationCourseDue(owner, past, now);
      expect(due.fulfilled_slots).toEqual([
        {
          course_revision_id: selected.course_revision_id,
          course_rule_id: selected.course_rule_id,
          course_slot_key: selected.course_slot_key,
          scheduled_day: past,
          status: 'taken',
          source_kind: 'injection',
          entry_id: logged.id,
          occurred_at: now.toISOString(),
          entry_date: '2026-11-16',
        },
      ]);
      expect(
        await medicationEntryRepository.listEntriesWithInjections(owner, {
          fromDate: past,
          toDate: past,
        })
      ).toEqual([]);
      expect(
        (await getMedicationCourseDue(owner, '2026-11-06', now)).fulfilled_slots
      ).toEqual([]);
      await setMedicationCourseStatus(
        owner,
        result.course_id,
        { status: 'paused', expected_version: 1, operation_id: randomUUID() },
        new Date('2026-11-16T12:01:00Z')
      );
      const after = await getMedicationCourseDue(
        owner,
        past,
        new Date('2026-11-16T12:01:00Z')
      );
      expect(
        after.slots.find((s) => s.course_id === result.course_id)
          ?.course_expected_version
      ).toBe(2);
      expect(after.fulfilled_slots).toEqual(due.fulfilled_slots);
      await expect(
        injectionRepository.createInjection(owner, {
          medication_id: med,
          entry_date: '2026-11-16',
          injected_at: now.toISOString(),
          dose_mg: 1,
          deduct_pen: false,
          course_revision_id: selected.course_revision_id,
          course_rule_id: selected.course_rule_id,
          course_slot_key: selected.course_slot_key,
          scheduled_day: past,
          scheduled_for: selected.scheduled_for,
          course_expected_version: 1,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      const foreign = randomUUID();
      const c: PoolClient = await getSystemClient();
      try {
        await c.query(
          'INSERT INTO public."user"(id,email,name,email_verified) VALUES($1,$2,$3,true)',
          [
            foreign,
            `synthetic-foreign-${foreign}@example.test`,
            'Synthetic foreign',
          ]
        );
        const hidden = await dbContextStorage.run(
          { authenticatedUserId: foreign },
          () => getMedicationCourseDue(owner, past, now)
        );
        expect(hidden.fulfilled_slots).toEqual([]);
        expect(hidden.courses).toEqual([]);
        expect(
          (
            await c.query(
              'SELECT count(*)::int AS count FROM injection_entries WHERE user_id=$1 AND course_revision_id=$2',
              [owner, selected.course_revision_id]
            )
          ).rows[0].count
        ).toBe(1);
      } finally {
        await c.query('DELETE FROM public."user" WHERE id=$1', [foreign]);
        c.release();
      }
    });
    it('hands off multiple selected rules once, keeps an unselected rule untouched, and rolls stale handoff back', async () => {
      const { med, authored } = await create();
      const c: PoolClient = await getSystemClient();
      let rules: string[];
      try {
        rules = (
          await c.query(
            "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,start_date,active) VALUES($1,$2,'daily','08:00','2026-10-01',true),($1,$2,'daily','20:00','2026-10-01',true),($1,$2,'daily','12:00','2026-10-01',true) RETURNING id",
            [owner, med]
          )
        ).rows.map((r) => r.id as string);
      } finally {
        c.release();
      }
      const candidates = await listCourseHandoffRules(owner, med, now);
      const selected = candidates.rules
        .filter((r) => rules.slice(0, 2).includes(r.schedule_id))
        .map(({ schedule_id, fingerprint }) => ({ schedule_id, fingerprint }));
      const handoff = { cutover_day: '2026-11-16', selected_rules: selected };
      const review = await reviewMedicationCourseCreate(
        owner,
        med,
        { ...authored, expected_version: 0, handoff },
        now
      );
      const input = {
        ...authored,
        medication_id: med,
        operation_id: randomUUID(),
        expected_version: 0,
        handoff,
        native_reminder_limitation_acknowledged: true,
        review_fingerprint: review.review_fingerprint,
      };
      const made = await createMedicationCourse(owner, input, now);
      const course = (await getMedicationCourse(owner, made.course_id)).course;
      expect(course.revisions[0]?.rules).toHaveLength(2);
      expect(course.revisions[0]?.rules.map((r) => r.anchor_date)).toEqual([
        '2026-10-01',
        '2026-10-01',
      ]);
      const check: PoolClient = await getSystemClient();
      try {
        const dates = (
          await check.query(
            'SELECT id,end_date::text FROM medication_schedules WHERE user_id=$1 AND id=ANY($2::uuid[])',
            [owner, rules]
          )
        ).rows;
        expect(
          dates
            .filter((r) => rules.slice(0, 2).includes(r.id))
            .every((r) => r.end_date === '2026-11-15')
        ).toBe(true);
        expect(dates.find((r) => r.id === rules[2])?.end_date).toBeNull();
      } finally {
        check.release();
      }
      await expect(
        createMedicationCourse(
          owner,
          { ...input, operation_id: randomUUID() },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await createMedicationCourse(owner, input, now)).toEqual(made);
    });
  }
);
