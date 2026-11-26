import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  medicationStackScheduleInputSchema,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import {
  dbContextStorage,
  endPool,
  getClient,
  getSystemClient,
} from '../db/poolManager.js';
import * as stacks from '../models/medicationStackRepository.js';
import {
  createMedicationCourse,
  editMedicationCourse,
  getMedicationCourse,
  reviewMedicationCourseCreate,
  reviseMedicationCourse,
  setMedicationCourseStatus,
} from '../services/medicationCourseService.js';
import {
  bindAddedStackMembers,
  clearStackSchedule,
  reviewStackSchedule,
  saveStackSchedule,
} from '../services/medicationStackScheduleService.js';
import { coursePlan } from '../models/medicationCourseRepository.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const TODAY = '2026-11-16';

describe.runIf(process.env.MEDICATION_STACK_SCHEDULE_INTEGRATION === '1')(
  'stack schedules PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      writer = randomUUID(),
      reader = randomUUID();
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client: PoolClient = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const q = async <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
      (await admin((client) => client.query(sql, p))).rows as T[];

    beforeAll(async () => {
      await admin(async (client) => {
        for (const id of [owner, other, writer, reader])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `stack-schedule-${id}@example.test`]
          );
        await client.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Europe/London') ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone",
          [owner]
        );
        for (const [id, manage] of [
          [writer, true],
          [reader, false],
        ] as const)
          await client.query(
            `INSERT INTO public.family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status)
             VALUES($1,$2,$3,$4::jsonb,true,'active')`,
            [
              owner,
              id,
              `delegate-${id}@example.test`,
              JSON.stringify({
                ...(manage
                  ? { can_manage_medications: true }
                  : { can_view_reports: true }),
              }),
            ]
          );
      });
    });
    afterAll(async () => {
      await admin((client) =>
        client.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other, writer, reader],
        ])
      );
      await endPool();
    });

    let counter = 0;
    const med = async (userId = owner, name = `Stack med ${++counter}`) =>
      (
        await q<{ id: string }>(
          "INSERT INTO medications(user_id,name,type_id) VALUES($1,$2,'injection') RETURNING id",
          [userId, name]
        )
      )[0]!.id;
    const plan = async (
      medicationId: string,
      over: Partial<MedicationCoursePlanInput> = {}
    ) =>
      createMedicationCourse(
        owner,
        {
          ...medicationCoursePlanFixture(),
          name: `Plan ${++counter}`,
          ...over,
          medication_id: medicationId,
          operation_id: randomUUID(),
          expected_version: 0,
          native_reminder_limitation_acknowledged: false,
        },
        NOW
      );
    const dose = (medicationId: string, revision: string, day = '2026-11-10') =>
      q(
        "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,status,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id) VALUES($1,$2,$3,$4,'taken','Recorded synthetic',1,'mg',$5)",
        [owner, medicationId, day, `${day}T08:00:00Z`, revision]
      );
    const makeStack = (name: string, ids: string[]) =>
      stacks.createStack(owner, {
        name: `${name} ${++counter}`,
        notes: null,
        medication_ids: ids,
      });
    const tip = async (courseId: string) => {
      const { course } = await getMedicationCourse(owner, courseId);
      const revision = course.revisions.find(
        (r) => r.id === course.current_revision_id
      )!;
      return { course, revision, plan: coursePlan(revision) };
    };
    const stackSchedule = (value: Record<string, unknown>) =>
      medicationStackScheduleInputSchema.parse(value);
    const SPECIFIC = stackSchedule({
      schedule_type_id: 'specific_days',
      days_of_week: [1, 4],
      time_of_day: '20:00',
    });
    const save = async (
      stackId: string,
      schedule = SPECIFIC,
      over: Record<string, unknown> = {},
      as?: string
    ) => {
      const run = async () => {
        const review = await reviewStackSchedule(
          owner,
          stackId,
          { schedule },
          NOW
        );
        const out = await saveStackSchedule(
          owner,
          stackId,
          {
            schedule,
            operation_id: randomUUID(),
            expected_version: review.expected_version,
            review_fingerprint: review.review_fingerprint,
            effective_from: review.effective_from,
            skipped_member_ids: review.skipped_member_ids,
            acknowledged_member_ids: review.members
              .filter((m) => m.needs_ack)
              .map((m) => m.medication_id),
            ...over,
          },
          NOW
        );
        return { review, ...out };
      };
      return as
        ? dbContextStorage.run({ authenticatedUserId: as }, run)
        : run();
    };
    const rules = (courseId: string) =>
      q(
        `SELECT q.schedule_type_id, q.time_of_day::text AS time, q.days_of_week, q.interval_days, q.dose_amount::text AS dose, q.anchor_date::text AS anchor
         FROM medication_courses c JOIN medication_course_rules q ON q.revision_id=c.current_revision_id
         WHERE c.id=$1 ORDER BY q.rule_index`,
        [courseId]
      );
    const bindings = (stackId: string) =>
      q<{ medication_id: string; applied_version: number }>(
        'SELECT medication_id, applied_version FROM medication_stack_schedule_bindings WHERE stack_id=$1 ORDER BY medication_id',
        [stackId]
      );
    const count = async (table: string, where: string, p: unknown[]) =>
      Number(
        (
          await q<{ n: string }>(
            `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
            p
          )
        )[0]!.n
      );

    it('applies the migration twice and rejects malformed schedules', async () => {
      const sql = readFileSync(
        new URL(
          '../db/migrations/20261126120000_medication_stack_schedules.sql',
          import.meta.url
        ),
        'utf8'
      );
      await admin(async (client) => {
        await client.query(sql);
        await client.query(sql);
      });
      const stackId = await makeStack('Shape', [await med()]);
      const insert = (cols: string, vals: unknown[]) =>
        admin((client) =>
          client.query(
            `INSERT INTO medication_stack_schedules(stack_id,user_id,${cols}) VALUES($1,$2,${vals.map((_, i) => `$${i + 3}`).join(',')})`,
            [stackId, owner, ...vals]
          )
        );
      await expect(insert('schedule_type_id', ['monthly'])).rejects.toThrow();
      await expect(
        insert('schedule_type_id,days_of_week', ['specific_days', []])
      ).rejects.toThrow();
      await expect(
        insert('schedule_type_id,interval_days,start_date', [
          'every_n_days',
          1,
          '2026-12-01',
        ])
      ).rejects.toThrow();
      await expect(
        insert('schedule_type_id,interval_days', ['every_n_days', 3])
      ).rejects.toThrow();
      await expect(
        insert('schedule_type_id,cycle_on_days,cycle_off_days', [
          'cyclic',
          3,
          2,
        ])
      ).rejects.toThrow();
      await expect(
        insert('schedule_type_id,days_of_week', ['specific_days', [7]])
      ).rejects.toThrow();
      await insert('schedule_type_id', ['daily']);
      expect(
        await count('medication_stack_schedules', 'user_id=$1', [owner])
      ).toBeGreaterThan(0);
      await admin((client) =>
        client.query('DELETE FROM medication_stacks WHERE id=$1', [stackId])
      );
    });

    it('leaves existing stacks and plans alone until a schedule is saved', async () => {
      const a = await med(),
        b = await med();
      const courseA = await plan(a, {
        rules: [{ schedule_type_id: 'daily', time_of_day: '07:00:00' }],
      });
      const stackId = await makeStack('Unscheduled', [a, b]);
      const [listed] = (await stacks.listStacks(owner)).filter(
        (s) => s.id === stackId
      );
      expect(listed!.schedule).toBeNull();
      expect(
        listed!.members.every((m) => m.schedule_status === undefined)
      ).toBe(true);
      expect(await bindings(stackId)).toEqual([]);
      expect((await rules(courseA.course_id))[0]!.time).toBe('07:00:00');
      // A plan for an unbound medicine is created exactly as before.
      const created = await plan(b, {
        rules: [{ schedule_type_id: 'daily', time_of_day: '09:30:00' }],
      });
      expect((await rules(created.course_id))[0]!.time).toBe('09:30:00');
    });

    it('applies one schedule to every follower, keeping doses and steps, with one receipt', async () => {
      const a = await med(),
        b = await med(),
        c = await med();
      const planA = await plan(a, {
        end_date: '2027-03-01',
        steps: [{ dose: '1', dose_unit: 'mg', duration_days: 30 }],
        rules: [
          {
            schedule_type_id: 'daily',
            time_of_day: '08:00:00',
            dose_amount: '2',
          },
        ],
      });
      const planB = await plan(b);
      await dose(b, planB.revision_id!);
      const stackId = await makeStack('Three', [a, b, c]);
      const beforeA = await tip(planA.course_id);

      const out = await save(stackId);
      expect(out.created).toBe(true);
      expect(out.review.members.map((m) => m.action)).toEqual([
        'edit',
        'revise',
        'pending',
      ]);
      expect(out.review.effective_from).toBe(TODAY);

      // In place for the plan without delivered doses: same revision, same dose and steps.
      const afterA = await tip(planA.course_id);
      expect(afterA.revision.id).toBe(beforeA.revision.id);
      expect(afterA.course.version).toBe(beforeA.course.version + 1);
      expect(afterA.plan.end_date).toBe('2027-03-01');
      expect(afterA.plan.steps).toEqual(beforeA.plan.steps);
      expect(await rules(planA.course_id)).toMatchObject([
        {
          schedule_type_id: 'specific_days',
          time: '20:00:00',
          days_of_week: [1, 4],
          dose: '2',
        },
      ]);
      // A successor from the effective day for the plan with delivered doses.
      const afterB = await tip(planB.course_id);
      expect(afterB.course.revisions).toHaveLength(2);
      expect(afterB.revision.start_date).toBe(TODAY);
      expect(afterB.revision.predecessor_id).toBe(planB.revision_id);
      const predecessor = afterB.course.revisions.find(
        (r) => r.id === planB.revision_id
      )!;
      expect(predecessor.status).toBe('completed');
      expect(predecessor.closed_date).toBe('2026-11-15');
      expect(await rules(planB.course_id)).toMatchObject([
        { schedule_type_id: 'specific_days', time: '20:00:00' },
      ]);
      // The member with no plan waits.
      expect(await bindings(stackId)).toEqual(
        [
          { medication_id: a, applied_version: 1 },
          { medication_id: b, applied_version: 1 },
          { medication_id: c, applied_version: 0 },
        ].sort((x, y) => (x.medication_id < y.medication_id ? -1 : 1))
      );
      expect(
        await count(
          'medication_course_operations',
          "user_id=$1 AND action='stack_schedule:set'",
          [owner]
        )
      ).toBeGreaterThan(0);

      // Listing says who follows.
      const [listed] = (await stacks.listStacks(owner)).filter(
        (s) => s.id === stackId
      );
      expect(listed!.schedule).toMatchObject({
        schedule_type_id: 'specific_days',
        days_of_week: [1, 4],
        time_of_day: '20:00',
        version: 1,
      });
      expect(
        listed!.members.map((m) => [m.schedule_status, m.schedule_bound])
      ).toEqual([
        ['following', true],
        ['following', true],
        ['pending', true],
      ]);

      // Saving the same schedule again changes nothing and bumps nothing.
      const again = await save(stackId);
      expect(again.created).toBe(false);
      expect(again.review.members.map((m) => m.action)).toEqual([
        'unchanged',
        'unchanged',
        'pending',
      ]);
      expect(again.result.schedule.version).toBe(1);
      expect((await tip(planA.course_id)).course.version).toBe(
        afterA.course.version
      );
    });

    it('replays a receipt and refuses a reused operation id for a different request', async () => {
      const a = await med();
      await plan(a);
      const stackId = await makeStack('Replay', [a]);
      const first = await save(stackId);
      const receiptCount = () =>
        count(
          'medication_course_operations',
          'user_id=$1 AND operation_id=$2',
          [owner, first.result.operation_id]
        );
      expect(await receiptCount()).toBe(1);
      const body = {
        schedule: SPECIFIC,
        operation_id: first.result.operation_id,
        expected_version: 0,
        review_fingerprint: first.review.review_fingerprint,
        effective_from: first.review.effective_from,
        skipped_member_ids: [],
        acknowledged_member_ids: [],
      };
      const replay = await saveStackSchedule(owner, stackId, body, NOW);
      expect(replay.created).toBe(false);
      expect(replay.result).toEqual(first.result);
      expect(await receiptCount()).toBe(1);
      await expect(
        saveStackSchedule(
          owner,
          stackId,
          { ...body, effective_from: '2026-11-20' },
          NOW
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('moves the effective day to tomorrow when a follower has logged today', async () => {
      const a = await med();
      const created = await plan(a);
      await dose(a, created.revision_id!, TODAY);
      const stackId = await makeStack('Logged today', [a]);
      const out = await save(stackId);
      expect(out.review.effective_from).toBe('2026-11-17');
      expect((await tip(created.course_id)).revision.start_date).toBe(
        '2026-11-17'
      );
      // The day cannot be moved earlier than the computed one.
      const b = await med();
      const planB = await plan(b);
      await dose(b, planB.revision_id!, TODAY);
      await expect(
        reviewStackSchedule(
          owner,
          await makeStack('Too early', [b]),
          { schedule: SPECIFIC, effective_from: TODAY },
          NOW
        )
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('applies an every-N-days schedule with its anchor', async () => {
      const a = await med();
      const created = await plan(a);
      const stackId = await makeStack('Interval', [a]);
      await save(
        stackId,
        stackSchedule({
          schedule_type_id: 'every_n_days',
          interval_days: 3,
          start_date: '2026-12-01',
          time_of_day: '08:00',
        })
      );
      expect(await rules(created.course_id)).toMatchObject([
        {
          schedule_type_id: 'every_n_days',
          interval_days: 3,
          anchor: '2026-12-01',
        },
      ]);
    });

    it('rolls everything back when a later member fails', async () => {
      const a = await med(),
        b = await med();
      const planA = await plan(a, {
        rules: [{ schedule_type_id: 'daily', time_of_day: '06:00:00' }],
      });
      await plan(b);
      const stackId = await makeStack('Atomic', [a, b]);
      const operationId = randomUUID();
      const fn = `zz_fail_${counter}`;
      await admin(async (client) => {
        await client.query(
          `CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.medication_id = '${b}' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$`
        );
        await client.query(
          `CREATE TRIGGER ${fn} BEFORE INSERT ON public.medication_stack_schedule_bindings FOR EACH ROW EXECUTE FUNCTION public.${fn}()`
        );
      });
      try {
        const review = await reviewStackSchedule(
          owner,
          stackId,
          { schedule: SPECIFIC },
          NOW
        );
        await expect(
          saveStackSchedule(
            owner,
            stackId,
            {
              schedule: SPECIFIC,
              operation_id: operationId,
              expected_version: 0,
              review_fingerprint: review.review_fingerprint,
              effective_from: review.effective_from,
              skipped_member_ids: [],
              acknowledged_member_ids: [],
            },
            NOW
          )
        ).rejects.toThrow('forced failure');
      } finally {
        await admin(async (client) => {
          await client.query(
            `DROP TRIGGER ${fn} ON public.medication_stack_schedule_bindings`
          );
          await client.query(`DROP FUNCTION public.${fn}()`);
        });
      }
      expect(await rules(planA.course_id)).toMatchObject([
        { schedule_type_id: 'daily', time: '06:00:00' },
      ]);
      expect((await tip(planA.course_id)).course.version).toBe(1);
      expect(
        await count('medication_stack_schedules', 'stack_id=$1', [stackId])
      ).toBe(0);
      expect(await bindings(stackId)).toEqual([]);
      expect(
        await count(
          'medication_course_operations',
          'user_id=$1 AND operation_id=$2',
          [owner, operationId]
        )
      ).toBe(0);
    });

    it('serialises saves on one stack and settles two stacks that share a medicine', async () => {
      const shared = await med(),
        x = await med(),
        y = await med();
      for (const m of [shared, x, y]) await plan(m);
      const one = await makeStack('Race one', [shared, x]);
      const two = await makeStack('Race two', [y, shared]);

      for (let round = 0; round < 6; round++) {
        const settled = await Promise.allSettled([
          save(one, SPECIFIC),
          save(two, SPECIFIC),
        ]);
        for (const outcome of settled)
          if (outcome.status === 'rejected')
            expect(String(outcome.reason?.message)).not.toMatch(/deadlock/i);
        // A medicine follows at most one stack.
        expect(
          await count(
            'medication_stack_schedule_bindings',
            'medication_id=$1',
            [shared]
          )
        ).toBe(1);
        await q(
          'DELETE FROM medication_stack_schedules WHERE stack_id=ANY($1::uuid[])',
          [[one, two]]
        );
      }

      // Two saves of the same stack: the second sees the new version and is refused.
      const stackId = await makeStack('Race same', [shared, x]);
      const review = await reviewStackSchedule(
        owner,
        stackId,
        { schedule: SPECIFIC },
        NOW
      );
      const body = (operation_id: string) => ({
        schedule: SPECIFIC,
        operation_id,
        expected_version: 0,
        review_fingerprint: review.review_fingerprint,
        effective_from: review.effective_from,
        skipped_member_ids: [] as string[],
        acknowledged_member_ids: [] as string[],
      });
      const both = await Promise.allSettled([
        saveStackSchedule(owner, stackId, body(randomUUID()), NOW),
        saveStackSchedule(owner, stackId, body(randomUUID()), NOW),
      ]);
      expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = both.find((r) => r.status === 'rejected') as
        PromiseRejectedResult | undefined;
      expect(lost?.reason).toMatchObject({ statusCode: 409 });
    });

    it('does not deadlock a stack save against edits of its members', async () => {
      const meds = [await med(), await med(), await med()];
      const courses = [];
      for (const m of meds) courses.push(await plan(m));
      const stackId = await makeStack('Edits', meds);
      for (let round = 0; round < 6; round++) {
        const schedule = stackSchedule({
          schedule_type_id: 'daily',
          time_of_day: round % 2 ? '08:00' : '09:00',
        });
        const edits = [...courses].reverse().map(async (c) => {
          const current = await tip(c.course_id);
          return editMedicationCourse(owner, c.course_id, {
            ...current.plan,
            target_dose: String(2 + round),
            expected_version: current.course.version,
            operation_id: randomUUID(),
          });
        });
        const settled = await Promise.allSettled([
          save(stackId, schedule),
          ...edits,
        ]);
        for (const outcome of settled)
          if (outcome.status === 'rejected')
            expect(String(outcome.reason?.message)).not.toMatch(/deadlock/i);
        await q('DELETE FROM medication_stack_schedules WHERE stack_id=$1', [
          stackId,
        ]);
      }
    });

    it('keeps bindings on rename and reorder, drops them on removal, and binds additions', async () => {
      const a = await med(),
        b = await med(),
        c = await med(),
        d = await med(),
        e = await med();
      const planA = await plan(a),
        planB = await plan(b);
      const planD = await plan(d, {
        rules: [{ schedule_type_id: 'daily', time_of_day: '05:00:00' }],
      });
      await admin((client) =>
        client.query(
          "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,dose_amount,active) VALUES($1,$2,'daily','10:00',1,true)",
          [owner, e]
        )
      );
      const stackId = await makeStack('Members', [a, b, c]);
      await save(stackId);
      const before = await bindings(stackId);
      expect(before).toHaveLength(3);

      // Rename and reorder: nothing is rebound.
      await stacks.updateStack(
        owner,
        stackId,
        { name: `Renamed ${counter}`, notes: null, medication_ids: [c, b, a] },
        (client, added) => bindAddedStackMembers(client, owner, stackId, added)
      );
      expect(await bindings(stackId)).toEqual(before);

      // Remove b: its binding goes, its plan keeps the last rules.
      await stacks.updateStack(
        owner,
        stackId,
        { name: `Renamed ${counter}`, notes: null, medication_ids: [c, a] },
        (client, added) => bindAddedStackMembers(client, owner, stackId, added)
      );
      expect(
        (await bindings(stackId)).map((r) => r.medication_id)
      ).not.toContain(b);
      expect(await rules(planB.course_id)).toMatchObject([
        { schedule_type_id: 'specific_days', time: '20:00:00' },
      ]);
      expect((await tip(planB.course_id)).course.version).toBeGreaterThan(0);

      // Add d (has a plan), e (legacy rule) and a new one with no plan.
      const f = await med();
      await stacks.updateStack(
        owner,
        stackId,
        {
          name: `Renamed ${counter}`,
          notes: null,
          medication_ids: [c, a, d, e, f],
        },
        (client, added) => bindAddedStackMembers(client, owner, stackId, added)
      );
      expect(await rules(planD.course_id)).toMatchObject([
        { schedule_type_id: 'specific_days', time: '20:00:00' },
      ]);
      const after = await bindings(stackId);
      expect(after.map((r) => r.medication_id).sort()).toEqual(
        [a, c, d, f].sort()
      );
      expect(after.find((r) => r.medication_id === d)!.applied_version).toBe(1);
      expect(after.find((r) => r.medication_id === f)!.applied_version).toBe(0);
      // The legacy rule is untouched and e is an unbound member.
      expect(
        await q(
          'SELECT time_of_day::text AS t, active, end_date FROM medication_schedules WHERE medication_id=$1',
          [e]
        )
      ).toEqual([{ t: '10:00:00', active: true, end_date: null }]);
      const [listed] = (await stacks.listStacks(owner)).filter(
        (s) => s.id === stackId
      );
      expect(listed!.members.find((m) => m.medication_id === e)).toMatchObject({
        schedule_status: 'not_following',
        schedule_note: 'has_own_schedule',
        schedule_bound: false,
      });
      void planA;
    });

    it('leaves a legacy schedule untouched and reports it as blocking', async () => {
      const legacy = await med();
      await admin((client) =>
        client.query(
          "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,dose_amount,active) VALUES($1,$2,'daily','11:00',3,true)",
          [owner, legacy]
        )
      );
      const snapshot = () =>
        q('SELECT * FROM medication_schedules WHERE medication_id=$1', [
          legacy,
        ]);
      const before = await snapshot();
      const stackId = await makeStack('Legacy', [legacy, await med()]);
      const review = await reviewStackSchedule(
        owner,
        stackId,
        { schedule: SPECIFIC },
        NOW
      );
      const row = review.members.find((m) => m.medication_id === legacy)!;
      expect(row).toMatchObject({
        action: 'blocked',
        reason: 'has_own_schedule',
      });
      expect(review.skipped_member_ids).toEqual([legacy]);
      // Saving without echoing the left-out member is refused.
      await expect(
        save(stackId, SPECIFIC, { skipped_member_ids: [] })
      ).rejects.toMatchObject({ statusCode: 409 });
      await save(stackId);
      expect(await snapshot()).toEqual(before);
      expect(
        (await bindings(stackId)).map((b) => b.medication_id)
      ).not.toContain(legacy);
    });

    it('treats pause, resume and completion as per-member and keeps the guard on timing', async () => {
      const a = await med(),
        b = await med();
      const planA = await plan(a),
        planB = await plan(b);
      await dose(a, planA.revision_id!);
      const stackId = await makeStack('Lifecycle', [a, b]);
      await save(stackId);
      const bound = await bindings(stackId);

      // Pause b: binding and timing stay.
      const pausedB = await setMedicationCourseStatus(
        owner,
        planB.course_id,
        {
          status: 'paused',
          expected_version: (await tip(planB.course_id)).course.version,
          operation_id: randomUUID(),
        },
        NOW
      );
      expect(await bindings(stackId)).toEqual(bound);

      // The guard refuses a timing change and allows a dose change.
      const current = await tip(planB.course_id);
      await expect(
        editMedicationCourse(owner, planB.course_id, {
          ...current.plan,
          rules: [{ schedule_type_id: 'daily', time_of_day: '06:00:00' }],
          expected_version: pausedB.version,
          operation_id: randomUUID(),
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining(
          'Timing for this plan is set by the stack'
        ),
      });
      await editMedicationCourse(owner, planB.course_id, {
        ...current.plan,
        target_dose: '4',
        expected_version: pausedB.version,
        operation_id: randomUUID(),
      });
      expect((await tip(planB.course_id)).revision.target_dose).toBe('4');
      // Revise with a changed timing is refused the same way.
      const forA = await tip(planA.course_id);
      await expect(
        reviseMedicationCourse(
          owner,
          planA.course_id,
          {
            ...forA.plan,
            start_date: '2026-11-20',
            rules: [{ schedule_type_id: 'daily', time_of_day: '06:00:00' }],
            expected_version: forA.course.version,
            operation_id: randomUUID(),
            review_fingerprint: 'x',
          },
          NOW
        )
      ).rejects.toMatchObject({ statusCode: 422 });

      // A paused plan with delivered doses blocks a new schedule, which must be left out.
      await dose(b, planB.revision_id!);
      const next = stackSchedule({
        schedule_type_id: 'daily',
        time_of_day: '07:00',
      });
      const review = await reviewStackSchedule(
        owner,
        stackId,
        { schedule: next },
        NOW
      );
      expect(review.members.map((m) => m.action)).toEqual(['edit', 'blocked']);
      expect(review.members[1]).toMatchObject({ reason: 'paused' });
      const out = await save(stackId, next);
      expect(out.result.schedule.version).toBe(2);
      const [listed] = (await stacks.listStacks(owner)).filter(
        (s) => s.id === stackId
      );
      expect(
        listed!.members.map((m) => [m.schedule_status, m.schedule_note])
      ).toEqual([
        ['following', null],
        ['not_following', 'paused'],
      ]);

      // Resume and re-save: the paused member catches up, the other is a clean no-op.
      const resumed = await setMedicationCourseStatus(
        owner,
        planB.course_id,
        {
          status: 'active',
          expected_version: (await tip(planB.course_id)).course.version,
          operation_id: randomUUID(),
        },
        NOW
      );
      expect(resumed.version).toBeGreaterThan(1);
      const again = await save(stackId, next);
      expect(again.review.members.map((m) => m.action)).toEqual([
        'unchanged',
        'revise',
      ]);
      expect(
        (await bindings(stackId)).every((b) => b.applied_version === 2)
      ).toBe(true);

      // A finished plan is skipped and keeps its binding.
      await setMedicationCourseStatus(
        owner,
        planA.course_id,
        {
          status: 'completed',
          expected_version: (await tip(planA.course_id)).course.version,
          operation_id: randomUUID(),
        },
        NOW
      );
      const finished = await reviewStackSchedule(
        owner,
        stackId,
        { schedule: SPECIFIC },
        NOW
      );
      expect(finished.members[0]).toMatchObject({ action: 'skipped' });
    });

    it('adopts the schedule when a plan is created for a waiting member', async () => {
      const a = await med(),
        waiting = await med();
      await plan(a);
      const stackId = await makeStack('Adopt', [a, waiting]);
      await save(stackId);
      const draft = {
        ...medicationCoursePlanFixture(),
        rules: [
          { schedule_type_id: 'daily' as const, time_of_day: '06:00:00' },
        ],
        medication_id: waiting,
        operation_id: randomUUID(),
        expected_version: 0,
        native_reminder_limitation_acknowledged: false,
      };
      const reviewed = await reviewMedicationCourseCreate(
        owner,
        waiting,
        draft,
        NOW
      );
      expect(reviewed.plan.rules[0]).toMatchObject({
        schedule_type_id: 'specific_days',
        days_of_week: [1, 4],
      });
      const created = await createMedicationCourse(
        owner,
        { ...draft, review_fingerprint: reviewed.review_fingerprint },
        NOW
      );
      expect(await rules(created.course_id)).toMatchObject([
        { schedule_type_id: 'specific_days', time: '20:00:00' },
      ]);
      expect(
        (await bindings(stackId)).find((b) => b.medication_id === waiting)!
          .applied_version
      ).toBe(1);
    });

    it('removes the schedule and bindings without touching plans, and cascades with stacks and medicines', async () => {
      const a = await med(),
        b = await med();
      const planA = await plan(a);
      await plan(b);
      const stackId = await makeStack('Cascade', [a, b]);
      const first = await save(stackId);
      await clearStackSchedule(owner, stackId, {
        operation_id: randomUUID(),
        expected_version: first.result.schedule.version,
      });
      expect(await bindings(stackId)).toEqual([]);
      expect(
        await count('medication_stack_schedules', 'stack_id=$1', [stackId])
      ).toBe(0);
      expect(await rules(planA.course_id)).toMatchObject([
        { schedule_type_id: 'specific_days', time: '20:00:00' },
      ]);
      await save(stackId);
      await admin((client) =>
        client.query('DELETE FROM medications WHERE id=$1', [b])
      );
      expect((await bindings(stackId)).map((r) => r.medication_id)).toEqual([
        a,
      ]);
      await stacks.deleteStack(owner, stackId);
      expect(await bindings(stackId)).toEqual([]);
      expect((await tip(planA.course_id)).course.id).toBe(planA.course_id);
    });

    it('lets a medicine be in two stacks but follow only one', async () => {
      const shared = await med();
      await plan(shared);
      const one = await makeStack('Both one', [shared]);
      const two = await makeStack('Both two', [shared]);
      await save(one);
      const review = await reviewStackSchedule(
        owner,
        two,
        { schedule: SPECIFIC },
        NOW
      );
      expect(review.members[0]).toMatchObject({
        action: 'blocked',
        reason: 'follows_other_stack',
        reason_stack_name: expect.stringContaining('Both one'),
      });
      await expect(
        admin((client) =>
          client.query(
            "INSERT INTO medication_stack_schedules(stack_id,user_id,schedule_type_id) VALUES($1,$2,'daily')",
            [two, owner]
          )
        ).then(() =>
          admin((client) =>
            client.query(
              'INSERT INTO medication_stack_schedule_bindings(medication_id,stack_id,user_id) VALUES($1,$2,$3)',
              [shared, two, owner]
            )
          )
        )
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('applies row-level security to the schedule tables and to delegates', async () => {
      const a = await med();
      await plan(a);
      const stackId = await makeStack('Rls', [a]);
      await save(stackId);

      // Another person sees and binds nothing of the owner's.
      const stranger: PoolClient = await getClient(other);
      try {
        for (const table of [
          'medication_stack_schedules',
          'medication_stack_schedule_bindings',
        ])
          expect((await stranger.query(`SELECT * FROM ${table}`)).rows).toEqual(
            []
          );
        await expect(
          stranger.query(
            'UPDATE medication_stack_schedules SET version = version + 1 WHERE stack_id=$1',
            [stackId]
          )
        ).resolves.toMatchObject({ rowCount: 0 });
        await expect(
          stranger.query(
            'INSERT INTO medication_stack_schedule_bindings(medication_id,stack_id,user_id) VALUES($1,$2,$3)',
            [a, stackId, owner]
          )
        ).rejects.toThrow();
      } finally {
        stranger.release();
      }

      // A delegate who manages medications can read and save; a read-only one cannot save.
      const next = stackSchedule({
        schedule_type_id: 'daily',
        time_of_day: '12:00',
      });
      const out = await save(stackId, next, {}, writer);
      expect(out.result.schedule.version).toBe(2);
      await expect(save(stackId, SPECIFIC, {}, reader)).rejects.toMatchObject({
        statusCode: 403,
      });
      const asReader = await dbContextStorage.run(
        { authenticatedUserId: reader },
        async () => {
          const client: PoolClient = await getClient(owner);
          try {
            return (
              await client.query(
                'SELECT version FROM medication_stack_schedules WHERE stack_id=$1',
                [stackId]
              )
            ).rows;
          } finally {
            client.release();
          }
        }
      );
      expect(asReader).toEqual([{ version: 2 }]);
    });
  }
);
