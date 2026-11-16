import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  medicationCoursePlanInputSchema,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import { getSystemClient, getClient, endPool } from '../db/poolManager.js';
import {
  createMedicationCourse,
  editMedicationCourse,
  getMedicationCourse,
  getMedicationCourseDue,
  getMedicationCourseHistory,
  reviewMedicationCourse,
  reviseMedicationCourse,
  deleteMedicationCourseRevision,
  setMedicationCourseStatus,
} from '../services/medicationCourseService.js';
import {
  getMedicationCourseCycle,
  reviewMedicationCourseCycle,
  startMedicationCourseCycle,
  endMedicationCourseCycle,
} from '../services/medicationCourseCycleService.js';
import { loadCoursePhaseActuals } from '../models/medicationCourseRepository.js';
import medicationEntryRepository from '../models/medicationEntryRepository.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

describe.runIf(process.env.MEDICATION_COURSE_CYCLES_INTEGRATION === '1')(
  'reviewed weekly cycle commands PostgreSQL',
  () => {
    const owner = randomUUID();
    const now = new Date('2026-11-16T12:00:00Z'),
      created = new Date('2026-11-01T00:00:00Z');
    const admin = async <T>(fn: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin((c) =>
        c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [owner, `synthetic-cycles-${owner}@example.test`]
        )
      );
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [owner])
      );
      await endPool();
    });
    const create = async (
      patch: Partial<MedicationCoursePlanInput> = {},
      zone = 'UTC'
    ) => {
      const med = await admin(async (c) => {
        await c.query(
          'INSERT INTO user_preferences(user_id,timezone) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone',
          [owner, zone]
        );
        return (
          await c.query<{ id: string }>(
            "INSERT INTO medications(user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,'Synthetic cycle peptide','injection','subcutaneous',1,'mg',false) RETURNING id",
            [owner]
          )
        ).rows[0]!.id;
      });
      const plan = {
        ...medicationCoursePlanFixture(),
        course_cycle_on_weeks: 1,
        course_cycle_off_weeks: 1,
        ...patch,
      };
      const result = await createMedicationCourse(
        owner,
        {
          ...plan,
          medication_id: med,
          expected_version: 0,
          operation_id: randomUUID(),
          native_reminder_limitation_acknowledged: false,
        },
        created
      );
      return { med, plan, result };
    };
    const course = async (id: string) =>
      (await getMedicationCourse(owner, id)).course;
    const record = async (
      med: string,
      revision: string,
      day: string,
      status: 'taken' | 'skipped' | 'snoozed' = 'taken'
    ) => {
      const row = await medicationEntryRepository.createEntry(owner, {
        medication_id: med,
        course_revision_id: revision,
        entry_date: day,
        taken_at: `${day}T08:00:00Z`,
        status,
      });
      return String(row.id);
    };
    const review = async (id: string, action: 'end' | 'start', at = now) =>
      reviewMedicationCourseCycle(
        owner,
        id,
        { action, expected_version: (await course(id)).version },
        at
      );
    const start = async (id: string, at = now) => {
      const r = await review(id, 'start', at);
      expect(r.can_commit).toBe(true);
      return startMedicationCourseCycle(
        owner,
        id,
        {
          expected_version: r.cycle.version,
          operation_id: randomUUID(),
          review_fingerprint: r.review_fingerprint,
        },
        at
      );
    };
    const phasePlan = {
      steps: [
        { dose: '1', dose_unit: 'mg', duration_days: 7, notes: null },
        { dose: '2', dose_unit: 'mg', duration_days: null, notes: null },
      ],
    };
    const seed = async (x: Awaited<ReturnType<typeof create>>) => {
      const ids: string[] = [];
      for (let d = 1; d <= 7; d++)
        ids.push(await record(x.med, x.result.revision_id!, `2026-11-0${d}`));
      return ids;
    };
    const dueDose = async (id: string, day = '2026-11-17') =>
      (await getMedicationCourseDue(owner, day, now)).slots.find(
        (row) => row.course_id === id
      )?.per_dose_amount;
    const stored = async (id: string) =>
      admin(async (c) => ({
        course: (
          await c.query(
            'SELECT to_jsonb(c) AS v FROM medication_courses c WHERE id=$1',
            [id]
          )
        ).rows,
        revisions: (
          await c.query(
            'SELECT to_jsonb(r) AS v FROM medication_course_revisions r WHERE course_id=$1 ORDER BY revision_no',
            [id]
          )
        ).rows,
        operations: (
          await c.query(
            'SELECT operation_id FROM medication_course_operations WHERE course_id=$1 ORDER BY operation_id',
            [id]
          )
        ).rows,
      }));
    it('preserves omitted weekly metadata and explicit clear intent, and old strict non-cycle review commits', async () => {
      const x = await create();
      await editMedicationCourse(
        owner,
        x.result.course_id,
        {
          ...medicationCoursePlanFixture(),
          expected_version: 1,
          operation_id: randomUUID(),
        },
        now
      );
      let c = await course(x.result.course_id);
      expect(c.revisions[0]).toMatchObject({
        course_cycle_on_weeks: 1,
        course_cycle_off_weeks: 1,
        course_cycle_anchor_date: '2026-11-01',
      });
      await editMedicationCourse(
        owner,
        c.id,
        {
          ...medicationCoursePlanFixture(),
          course_cycle_off_weeks: null,
          expected_version: c.version,
          operation_id: randomUUID(),
        },
        now
      );
      c = await course(c.id);
      expect(c.revisions[0]!.course_cycle_off_weeks).toBeNull();
      const clearing = await reviewMedicationCourse(
        owner,
        c.id,
        {
          ...medicationCoursePlanFixture(),
          course_cycle_on_weeks: null,
          course_cycle_off_weeks: 2,
          expected_version: c.version,
        },
        now
      );
      expect(clearing.plan).toMatchObject({
        course_cycle_on_weeks: null,
        course_cycle_off_weeks: null,
      });
      await editMedicationCourse(
        owner,
        c.id,
        {
          ...clearing.plan,
          expected_version: c.version,
          operation_id: randomUUID(),
        },
        now
      );
      c = await course(c.id);
      expect(c.revisions[0]).toMatchObject({
        course_cycle_on_weeks: null,
        course_cycle_off_weeks: null,
        course_cycle_anchor_date: '2026-11-01',
      });
      await expect(
        editMedicationCourse(
          owner,
          c.id,
          {
            ...medicationCoursePlanFixture(),
            course_cycle_off_weeks: 1,
            expected_version: c.version,
            operation_id: randomUUID(),
          },
          now
        )
      ).rejects.toMatchObject({ statusCode: 422 });
      const oldInput = {
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-02',
        expected_version: c.version,
      };
      const r = await reviewMedicationCourse(owner, c.id, oldInput, now);
      const oldStrict = medicationCoursePlanInputSchema
        .omit({ course_cycle_on_weeks: true, course_cycle_off_weeks: true })
        .strict();
      expect(oldStrict.safeParse(r.plan).success).toBe(true);
      expect(r.cycle_plan_preview).toBeNull();
      const result = await reviseMedicationCourse(
        owner,
        c.id,
        {
          ...oldStrict.parse(r.plan),
          expected_version: c.version,
          operation_id: randomUUID(),
          review_fingerprint: r.review_fingerprint,
        },
        now
      );
      expect((await course(c.id)).current_revision_id).toBe(result.revision_id);
    });
    it('commits earlier authored End, clamps finite activity, audits and replays original result on a later day', async () => {
      const x = await create({ end_date: '2026-11-05' });
      await admin((c) =>
        c.query(
          "UPDATE medication_course_activity SET until_at='2026-11-25T00:00:00Z' WHERE revision_id=$1",
          [x.result.revision_id]
        )
      );
      const r = await review(x.result.course_id, 'end');
      expect(r.candidate_end_date).toBe('2026-11-05');
      const input = {
        expected_version: 1,
        operation_id: randomUUID(),
        review_fingerprint: r.review_fingerprint,
      };
      const ended = await endMedicationCourseCycle(
        owner,
        x.result.course_id,
        input,
        now
      );
      expect(ended.boundary_audit.after).toMatchObject({
        status: 'completed',
        end_date: '2026-11-05',
      });
      const c = await course(x.result.course_id);
      expect(
        c.revisions[0]!.activity.every(
          (a) => a.until_at !== null && a.until_at <= '2026-11-06T00:00:00.000Z'
        )
      ).toBe(true);
      expect(c.revisions[0]!.phase_origin_context).toEqual({
        start_date: '2026-11-01',
        end_date: '2026-11-05',
      });
      expect(
        await endMedicationCourseCycle(
          owner,
          c.id,
          input,
          new Date('2026-12-01T12:00:00Z')
        )
      ).toEqual(ended);
      await expect(
        endMedicationCourseCycle(
          owner,
          c.id,
          { ...input, expected_version: 2 },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('rejects later stored taken/skipped/snoozed history without mutation and permits virtual missed history', async () => {
      for (const status of ['taken', 'skipped', 'snoozed'] as const) {
        const x = await create();
        await record(x.med, x.result.revision_id!, '2026-11-08', status);
        const before = await stored(x.result.course_id);
        const r = await review(x.result.course_id, 'end');
        expect(r.can_commit).toBe(false);
        await expect(
          endMedicationCourseCycle(
            owner,
            x.result.course_id,
            {
              expected_version: 1,
              operation_id: randomUUID(),
              review_fingerprint: r.review_fingerprint,
            },
            now
          )
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(await stored(x.result.course_id)).toEqual(before);
      }
      const x = await create();
      expect((await review(x.result.course_id, 'end')).can_commit).toBe(true);
      await record(x.med, x.result.revision_id!, '2026-11-16', 'skipped');
      expect((await review(x.result.course_id, 'start')).can_commit).toBe(
        false
      );
    });
    it('keeps phase progression dynamic through Start, old actual edits, revision tombstone and actual deletion', async () => {
      const x = await create(phasePlan),
        ids = await seed(x);
      const captured = await admin((client) =>
        client.query(
          'SELECT phase_family_id FROM medication_entries WHERE id=ANY($1::uuid[])',
          [ids]
        )
      );
      expect(captured.rows).toHaveLength(7);
      expect(
        captured.rows.every(
          (row) => row.phase_family_id === x.result.revision_id
        )
      ).toBe(true);
      const started = await start(x.result.course_id);
      const c = await course(x.result.course_id);
      expect(c.revisions.at(-1)).toMatchObject({
        phase_family_id: x.result.revision_id,
        course_cycle_anchor_date: '2026-11-16',
        start_date: '2026-11-16',
        end_date: '2026-11-22',
      });
      expect(c.revisions[0]!.start_date).toBe('2026-11-01');
      expect(c.revisions.at(-1)!.activity[0]!.from_at).toBe(now.toISOString());
      expect(await dueDose(c.id)).toBe('2');
      expect(
        (await getMedicationCourseDue(owner, '2026-11-16', now)).slots.some(
          (s) => s.course_revision_id === started.revision_id
        )
      ).toBe(false);
      await medicationEntryRepository.updateEntry(owner, ids[0]!, {
        status: 'skipped',
      });
      expect(await dueDose(c.id)).toBe('1');
      await medicationEntryRepository.updateEntry(owner, ids[0]!, {
        status: 'taken',
      });
      expect(await dueDose(c.id)).toBe('2');
      await deleteMedicationCourseRevision(
        owner,
        c.id,
        x.result.revision_id!,
        { expected_version: c.version, operation_id: randomUUID() },
        now
      );
      expect(await dueDose(c.id)).toBe('2');
      const history = await getMedicationCourseHistory(
        owner,
        c.id,
        undefined,
        undefined,
        now
      );
      expect(history.actuals).toHaveLength(0);
      const client = await getClient(owner);
      try {
        expect(
          (await loadCoursePhaseActuals(client, owner, c.id)).filter(
            (a) => a.course_revision_id === null
          )
        ).toHaveLength(7);
      } finally {
        client.release();
      }
      await medicationEntryRepository.deleteEntry(owner, ids[0]!);
      expect(await dueDose(c.id)).toBe('1');
    });
    it('ordinary reviewed Revise uses family carry then creates a fresh explicit authored family', async () => {
      const x = await create(phasePlan);
      await seed(x);
      await start(x.result.course_id);
      const c = await course(x.result.course_id);
      const input = {
        ...x.plan,
        start_date: '2026-11-20',
        end_date: '2026-12-01',
        expected_version: c.version,
      };
      const r = await reviewMedicationCourse(owner, c.id, input, now);
      expect(r.carried_steps[0]!.dose).toBe('2');
      await reviseMedicationCourse(
        owner,
        c.id,
        {
          ...r.plan,
          expected_version: c.version,
          operation_id: randomUUID(),
          review_fingerprint: r.review_fingerprint,
        },
        now
      );
      const revised = (await course(c.id)).revisions.at(-1)!;
      expect(revised.phase_family_id).toBeNull();
      expect(revised.course_cycle_anchor_date).toBe('2026-11-16');
      expect(await dueDose(c.id, '2026-11-20')).toBe('1');
    });
    it('preserves daily cyclic/interval anchors and original rule bounds independently of weekly restart', async () => {
      const x = await create({
        rules: [
          {
            schedule_type_id: 'cyclic',
            cycle_on_days: 2,
            cycle_off_days: 3,
            time_of_day: '08:00',
            end_date: '2026-12-31',
          },
          {
            schedule_type_id: 'every_n_days',
            interval_days: 5,
            time_of_day: '09:00',
          },
          {
            schedule_type_id: 'every_n_days',
            interval_days: 5,
            time_of_day: '10:00',
            start_date: '2026-10-30',
          },
        ],
      });
      const at = new Date('2026-11-18T12:00:00Z');
      const r = await review(x.result.course_id, 'start', at);
      expect(r.first_due?.scheduled_day).toBe('2026-11-19');
      await start(x.result.course_id, at);
      const latest = (await course(x.result.course_id)).revisions.at(-1)!;
      expect(latest.rules.map((rule) => rule.anchor_date)).toEqual([
        '2026-11-01',
        '2026-11-01',
        null,
      ]);
      expect(latest.rules[0]!.end_date).toBe('2026-12-31');
      expect(latest.rules[2]!.start_date).toBe('2026-10-30');
      expect(latest.cycle_anchor_date).toBeNull();
    });
    it('serializes same-operation concurrent retries and rejects different-operation stale CAS without extra revisions', async () => {
      const x = await create(),
        r = await review(x.result.course_id, 'start');
      const input = {
        expected_version: 1,
        operation_id: randomUUID(),
        review_fingerprint: r.review_fingerprint,
      };
      const results = await Promise.all([
        startMedicationCourseCycle(owner, x.result.course_id, input, now),
        startMedicationCourseCycle(owner, x.result.course_id, input, now),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect((await course(x.result.course_id)).revisions).toHaveLength(2);
      const before = await stored(x.result.course_id);
      await expect(
        startMedicationCourseCycle(
          owner,
          x.result.course_id,
          { ...input, operation_id: randomUUID() },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await stored(x.result.course_id)).toEqual(before);
    });
    it('refreshes reviewed Start after actual changes, a saved-zone day boundary or the first-due instant passes', async () => {
      const x = await create(),
        r = await review(
          x.result.course_id,
          'start',
          new Date('2026-11-16T07:00:00Z')
        );
      const input = {
        expected_version: 1,
        operation_id: randomUUID(),
        review_fingerprint: r.review_fingerprint,
      };
      await expect(
        startMedicationCourseCycle(owner, x.result.course_id, input, now)
      ).rejects.toMatchObject({ statusCode: 409 });
      const r2 = await review(x.result.course_id, 'start');
      await record(x.med, x.result.revision_id!, '2026-11-15');
      await expect(
        startMedicationCourseCycle(
          owner,
          x.result.course_id,
          {
            expected_version: 1,
            operation_id: randomUUID(),
            review_fingerprint: r2.review_fingerprint,
          },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      const r3 = await review(x.result.course_id, 'start');
      await expect(
        startMedicationCourseCycle(
          owner,
          x.result.course_id,
          {
            expected_version: 1,
            operation_id: randomUUID(),
            review_fingerprint: r3.review_fingerprint,
          },
          new Date('2026-11-17T12:00:00Z')
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await course(x.result.course_id)).revisions).toHaveLength(1);
    });
    it('uses saved course timezone, allows completed restart and never activates paused/inactive medication', async () => {
      const x = await create({}, 'Pacific/Kiritimati');
      await admin((c) =>
        c.query("UPDATE user_preferences SET timezone='UTC' WHERE user_id=$1", [
          owner,
        ])
      );
      expect(
        (
          await getMedicationCourseCycle(
            owner,
            x.result.course_id,
            new Date('2026-11-14T12:00:00Z')
          )
        ).today
      ).toBe('2026-11-15');
      await setMedicationCourseStatus(
        owner,
        x.result.course_id,
        {
          status: 'completed',
          expected_version: 1,
          operation_id: randomUUID(),
        },
        new Date('2026-11-08T12:00:00Z')
      );
      expect((await review(x.result.course_id, 'start')).can_commit).toBe(true);
      await admin((c) =>
        c.query('UPDATE medications SET is_active=false WHERE id=$1', [x.med])
      );
      expect((await review(x.result.course_id, 'start')).can_commit).toBe(
        false
      );
      const before = await stored(x.result.course_id);
      await expect(start(x.result.course_id)).rejects.toThrow();
      expect(await stored(x.result.course_id)).toEqual(before);
    });
    it('reapplies the additive migration twice without mutating legacy stock, schedule or unlinked actual facts', async () => {
      const x = await create();
      await admin((c) =>
        c.query(
          "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,dose_amount,active) VALUES($1,$2,'daily',1,true)",
          [owner, x.med]
        )
      );
      const row = await medicationEntryRepository.createEntry(owner, {
        medication_id: x.med,
        entry_date: '2026-11-02',
        taken_at: '2026-11-02T12:00:00Z',
        status: 'taken',
      });
      const snapshot = () =>
        admin(async (c) => {
          const result: Record<string, unknown> = {};
          for (const table of [
            'medications',
            'medication_schedules',
            'medication_pens',
            'medication_entries',
            'injection_entries',
            'medication_courses',
            'medication_course_revisions',
          ])
            result[table] = (
              await c.query(
                `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) AS rows FROM ${table} t WHERE user_id=$1`,
                [owner]
              )
            ).rows[0]!.rows;
          return result;
        });
      const before = await snapshot();
      const sql = await readFile(
        new URL(
          '../db/migrations/20261117010000_medication_course_cycles.sql',
          import.meta.url
        ),
        'utf8'
      );
      await admin(async (c) => {
        await c.query(sql);
        await c.query(sql);
      });
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await admin((c) =>
            c.query(
              'SELECT phase_family_id FROM medication_entries WHERE id=$1',
              [row.id]
            )
          )
        ).rows[0]!.phase_family_id
      ).toBeNull();
    });
    it('uses the identical weekly anchor resolver in ordinary review, initial enable plus start Edit, and Revise', async () => {
      const x = await create({
        course_cycle_on_weeks: null,
        course_cycle_off_weeks: null,
      });
      const editInput = {
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-02',
        course_cycle_on_weeks: 1,
        course_cycle_off_weeks: 1,
        expected_version: 1,
      };
      const editReview = await reviewMedicationCourse(
        owner,
        x.result.course_id,
        editInput,
        now
      );
      expect(editReview.cycle_plan_preview?.anchor_date).toBe('2026-11-01');
      await editMedicationCourse(
        owner,
        x.result.course_id,
        { ...editReview.plan, expected_version: 1, operation_id: randomUUID() },
        now
      );
      let current = await course(x.result.course_id);
      expect(current.revisions[0]!.course_cycle_anchor_date).toBe(
        editReview.cycle_plan_preview!.anchor_date
      );
      const reviseReview = await reviewMedicationCourse(
        owner,
        current.id,
        {
          ...medicationCoursePlanFixture(),
          start_date: '2026-11-03',
          expected_version: current.version,
        },
        now
      );
      await reviseMedicationCourse(
        owner,
        current.id,
        {
          ...reviseReview.plan,
          expected_version: current.version,
          operation_id: randomUUID(),
          review_fingerprint: reviseReview.review_fingerprint,
        },
        now
      );
      current = await course(current.id);
      expect(current.revisions.at(-1)!.course_cycle_anchor_date).toBe(
        reviseReview.cycle_plan_preview!.anchor_date
      );
      expect(current.revisions.at(-1)!.course_cycle_anchor_date).toBe(
        '2026-11-01'
      );
    });
  }
);
