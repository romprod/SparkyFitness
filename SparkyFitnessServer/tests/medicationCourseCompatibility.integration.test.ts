import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  courseSlotKey,
  courseSlotsForDay,
  todayInZone,
  entryMatchesDue,
  addDays,
  type MedicationCoursePlanInput,
  type MedicationCourseAttributionInput,
} from '@workspace/shared';
import {
  getClient,
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import * as entries from '../models/medicationEntryRepository.js';
import * as injections from '../models/injectionRepository.js';
import * as medications from '../models/medicationRepository.js';
import { loadMedicationCourse } from '../models/medicationCourseRepository.js';
import {
  createMedicationCourse,
  reviewMedicationCourseCreate,
  reviewMedicationCourse,
  reviseMedicationCourse,
  setMedicationCourseStatus,
  deleteMedicationCourseRevision,
  listCourseHandoffRules,
} from '../services/medicationCourseService.js';
import { getAppointmentReportData } from '../services/appointmentReportService.js';

// The repository refuses a medicine that is in use, so tests of what the database does
// when one goes (cascades, SET NULL, retained history) delete it directly.
async function rawDeleteMedication(id: string) {
  const client = await getSystemClient();
  try {
    const result = await client.query('DELETE FROM medications WHERE id=$1', [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

// Explicit opt-in; the companion runner provisions a new empty, synthetic database.
describe.runIf(process.env.MEDICATION_COURSE_COMPAT_INTEGRATION === '1')(
  'managed course actual-log compatibility PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      delegate = randomUUID(),
      reportsOnly = randomUUID();
    const day = todayInZone('UTC');
    const withAdmin = async <T>(fn: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    };
    const withOwner = async <T>(
      fn: (client: PoolClient) => Promise<T>,
      actor = owner
    ) =>
      dbContextStorage.run({ authenticatedUserId: actor }, async () => {
        const client: PoolClient = await getClient(owner);
        try {
          return await fn(client);
        } finally {
          client.release();
        }
      });
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await withAdmin(async (client) => {
        for (const id of [owner, other, delegate, reportsOnly])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `course-compat-${id}@example.test`]
          );
        await client.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'UTC') ON CONFLICT(user_id) DO UPDATE SET timezone='UTC'",
          [owner]
        );
        for (const [actor, permission] of [
          [delegate, 'can_manage_medications'],
          [reportsOnly, 'can_view_reports'],
        ])
          await client.query(
            "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,$3::jsonb,$4,'active')",
            [
              owner,
              actor,
              JSON.stringify({ [permission!]: true }),
              `synthetic-${actor}@example.test`,
            ]
          );
      });
    });
    afterAll(async () => {
      await withAdmin(async (client) => {
        await client.query(
          'DELETE FROM public."user" WHERE id=ANY($1::uuid[])',
          [[owner, other, delegate, reportsOnly]]
        );
      });
      await endPool();
    });
    const fixture = async (user = owner) =>
      withAdmin(async (client) => {
        const med = randomUUID(),
          pen = randomUUID(),
          course = randomUUID(),
          revision = randomUUID(),
          rule = randomUUID(),
          step = randomUUID();
        await client.query('BEGIN');
        try {
          await client.query(
            "INSERT INTO medications(id,user_id,name,type_id,dose_amount,dose_unit,is_active) VALUES($1,$2,'Synthetic course medication','injection',1,'mg',true)",
            [med, user]
          );
          await client.query(
            "INSERT INTO medication_pens(id,user_id,medication_id,kind,dose_mg,doses_total,doses_used) VALUES($1,$2,$3,'pen',1,10,0)",
            [pen, user, med]
          );
          await client.query(
            "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic course medication','2026-01-01','UTC','2026-01-01T00:00:00Z')",
            [course, user, med]
          );
          await client.query(
            "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,start_date,target_dose,dose_unit,dose_basis) VALUES($1,$2,$3,1,'Synthetic authored plan','2026-01-01',1,'mg','per_injection')",
            [revision, user, course]
          );
          await client.query(
            "INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,$3,0,'daily','08:00')",
            [rule, user, revision]
          );
          await client.query(
            "INSERT INTO medication_course_steps(id,user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,$3,0,1,'mg',NULL)",
            [step, user, revision]
          );
          await client.query(
            "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-01-01T00:00:00Z')",
            [user, revision]
          );
          await client.query(
            'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
            [course, revision]
          );
          await client.query('COMMIT');
          return { med, pen, course, revision, rule, step };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const attribution = (f: Fixture): MedicationCourseAttributionInput => ({
      course_revision_id: f.revision,
      course_rule_id: f.rule,
      course_step_id: f.step,
      course_expected_version: 1,
      scheduled_day: day,
      scheduled_for: `${day}T08:00:00.000Z`,
      course_slot_key: courseSlotKey(f.revision, f.rule, day, '08:00:00'),
    });
    const stock = (f: Fixture) =>
      withAdmin(
        async (client) =>
          (
            await client.query<{ doses_used: number }>(
              'SELECT doses_used FROM medication_pens WHERE id=$1',
              [f.pen]
            )
          ).rows[0]!.doses_used
      );
    it('reapplies the additive migration twice without mutating legacy schedule or actual rows', async () => {
      const f = await fixture();
      await withAdmin(async (client) => {
        const legacy = (
          await client.query(
            "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,start_date) VALUES($1,$2,'every_n_days','09:30','2026-01-01') RETURNING id",
            [owner, f.med]
          )
        ).rows[0].id;
        const actual = (
          await client.query(
            "INSERT INTO injection_entries(user_id,medication_id,dose_mg,injected_at,entry_date) VALUES($1,$2,1,'2026-01-02T09:31:00Z','2026-01-02') RETURNING id",
            [owner, f.med]
          )
        ).rows[0].id;
        const snapshot = async () => [
          (
            await client.query(
              'SELECT to_jsonb(s) AS row FROM medication_schedules s WHERE id=$1',
              [legacy]
            )
          ).rows[0],
          (
            await client.query(
              'SELECT to_jsonb(i) AS row FROM injection_entries i WHERE id=$1',
              [actual]
            )
          ).rows[0],
        ];
        const before = await snapshot();
        const migration = await readFile(
          new URL(
            '../db/migrations/20261116120000_medication_course_history.sql',
            import.meta.url
          ),
          'utf8'
        );
        try {
          await client.query(migration);
          await client.query(migration);
          expect(await snapshot()).toEqual(before);
        } finally {
          // A historical replay replaces its functions. Restore the current phase
          // guard before subsequent suites exercise current logging semantics.
          await client.query(
            await readFile(
              new URL(
                '../db/migrations/20261117010000_medication_course_cycles.sql',
                import.meta.url
              ),
              'utf8'
            )
          );
        }
      });
    });
    it('keeps old-client ordinary and injection logs unassigned with unchanged physical values', async () => {
      const f = await fixture();
      const entry = await entries.createEntry(owner, {
        medication_id: f.med,
        entry_date: day,
        status: 'taken',
      });
      const injection = await injections.createInjection(owner, {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
      });
      expect(entry.course_revision_id).toBeNull();
      expect(injection.course_revision_id).toBeNull();
      expect(injection.scheduled_for).toBeNull();
      expect(Number(injection.dose_mg)).toBe(1);
      expect(await stock(f)).toBe(1);
      expect(await injections.deleteInjection(owner, injection.id)).toBe(true);
      expect(await stock(f)).toBe(0);
    });
    it('persists explicit managed ordinary and injection attribution once and keeps exact stock semantics', async () => {
      const f = await fixture();
      const entry = await entries.createEntry(owner, {
        medication_id: f.med,
        status: 'snoozed',
        entry_date: day,
        ...attribution(f),
      });
      const injection = await injections.createInjection(owner, {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
        injected_at: `${day}T08:12:00Z`,
        ...attribution(f),
      });
      expect(entry.course_revision_id).toBe(f.revision);
      expect(injection.course_rule_id).toBe(f.rule);
      expect(await stock(f)).toBe(1);
      const merged = await entries.listEntriesWithInjections(owner, {
        medicationId: f.med,
      });
      expect(merged.map((row) => row.id).sort()).toEqual(
        [entry.id, injection.id].sort()
      );
      expect(
        merged.find((row) => row.id === injection.id).course_slot_key
      ).toBe(attribution(f).course_slot_key);
      const updated = await injections.updateInjection(owner, injection.id, {
        notes: 'Synthetic historical note',
      });
      expect(updated.course_slot_key).toBe(attribution(f).course_slot_key);
      expect(await stock(f)).toBe(1);
      await entries.deleteEntry(owner, entry.id);
      await injections.deleteInjection(owner, injection.id);
      expect(await stock(f)).toBe(0);
    });
    it.each(['version', 'slot', 'rule', 'step', 'instant'] as const)(
      'rejects a forged or stale managed %s before taking stock',
      async (field) => {
        const f = await fixture(),
          forged = await fixture();
        const refs = attribution(f);
        if (field === 'version') refs.course_expected_version = 99;
        if (field === 'slot') refs.course_slot_key = 'forged';
        if (field === 'rule') refs.course_rule_id = forged.rule;
        if (field === 'step') refs.course_step_id = forged.step;
        if (field === 'instant') refs.scheduled_for = `${day}T09:00:00Z`;
        await expect(
          injections.createInjection(owner, {
            medication_id: f.med,
            pen_id: f.pen,
            deduct_pen: true,
            dose_mg: 1,
            entry_date: day,
            ...refs,
          })
        ).rejects.toHaveProperty('statusCode');
        expect(await stock(f)).toBe(0);
        expect(
          await injections.listInjections(owner, { medicationId: f.med })
        ).toHaveLength(0);
      }
    );
    it('rejects stale metadata edits atomically before changing a manual actual amount or stock', async () => {
      const f = await fixture();
      const logged = await injections.createInjection(owner, {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
        ...attribution(f),
      });
      await expect(
        injections.updateInjection(owner, logged.id, {
          dose_mg: 2,
          ...attribution(f),
          course_expected_version: 99,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      const stored = (
        await injections.listInjections(owner, { medicationId: f.med })
      )[0];
      expect(Number(stored.dose_mg)).toBe(1);
      expect(await stock(f)).toBe(1);
    });
    it('allows explicit backdated predecessor manual logs and corrections without crediting the successor', async () => {
      const f = await fixture();
      const successor = randomUUID();
      await withAdmin(async (client) => {
        await client.query('BEGIN');
        await client.query(
          "UPDATE medication_course_revisions SET status='completed',closed_date='2026-02-01' WHERE id=$1",
          [f.revision]
        );
        await client.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,start_date,dose_unit,dose_basis) VALUES($1,$2,$3,$4,2,'Synthetic successor','2026-02-02','mg','per_injection')",
          [successor, owner, f.course, f.revision]
        );
        await client.query(
          'UPDATE medication_courses SET current_revision_id=$2,version=2 WHERE id=$1',
          [f.course, successor]
        );
        await client.query('COMMIT');
      });
      const logged = await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: '2026-01-15',
        injected_at: '2026-01-15T08:00:00Z',
        course_revision_id: f.revision,
        course_rule_id: f.rule,
        course_step_id: f.step,
      });
      const updated = await injections.updateInjection(owner, logged.id, {
        notes: 'Synthetic old revision remains old',
      });
      expect(updated.course_revision_id).toBe(f.revision);
      expect(updated.scheduled_for).toBeNull();
      await injections.deleteInjection(owner, logged.id);
    });
    it('enforces owner, delegated medication access, reports-only isolation and cross-scope SQL attribution', async () => {
      const f = await fixture(),
        foreign = await fixture(other);
      expect(
        await withOwner(
          async (client) =>
            (
              await client.query(
                'SELECT id FROM medication_courses WHERE id=$1',
                [f.course]
              )
            ).rowCount,
          delegate
        )
      ).toBe(1);
      expect(
        await withOwner(
          async (client) =>
            (
              await client.query(
                'SELECT id FROM medication_courses WHERE id=$1',
                [f.course]
              )
            ).rowCount,
          reportsOnly
        )
      ).toBe(1);
      expect(
        await withOwner(
          async (client) =>
            (
              await client.query(
                'UPDATE medication_courses SET version=version+1 WHERE id=$1',
                [f.course]
              )
            ).rowCount,
          reportsOnly
        )
      ).toBe(0);
      expect(
        await withOwner(
          async (client) =>
            (
              await client.query(
                'SELECT id FROM medication_courses WHERE id=$1',
                [foreign.course]
              )
            ).rowCount
        )
      ).toBe(0);
      await expect(
        withAdmin(async (client) => {
          await client.query(
            'INSERT INTO medication_entries(user_id,medication_id,course_revision_id) VALUES($1,$2,$3)',
            [owner, f.med, foreign.revision]
          );
        })
      ).rejects.toThrow();
      await expect(
        withAdmin(async (client) => {
          await client.query(
            'INSERT INTO injection_entries(user_id,medication_id,course_revision_id,course_rule_id) VALUES($1,$2,$3,$4)',
            [owner, f.med, f.revision, foreign.rule]
          );
        })
      ).rejects.toThrow();
    });
    it('retains bounded legacy handoff rules and rejects direct edits/deletes while parent cleanup succeeds', async () => {
      const f = await fixture();
      const retainedActual = await injections.createInjection(owner, {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
        course_revision_id: f.revision,
      });
      const legacy = await withAdmin(async (client) => {
        const row = (
          await client.query(
            "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,start_date,end_date,active) VALUES($1,$2,'daily','09:00','2026-01-01','2026-02-01',true) RETURNING *",
            [owner, f.med]
          )
        ).rows[0];
        await client.query(
          "INSERT INTO medication_course_handoffs(user_id,course_id,revision_id,schedule_id,original_schedule_id,original_rule,original_fingerprint,cutover_day,capped_end_date) VALUES($1,$2,$3,$4,$4,$5::jsonb,'synthetic','2026-02-02','2026-02-01')",
          [owner, f.course, f.revision, row.id, JSON.stringify(row)]
        );
        return row.id as string;
      });
      for (const patch of [
        { end_date: null },
        { end_date: '2026-03-01' },
        { time_of_day: '10:00' },
        { active: false },
      ])
        await expect(
          medications.updateSchedule(owner, legacy, patch)
        ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        medications.deleteSchedule(owner, legacy)
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        withAdmin(async (client) => {
          await client.query('DELETE FROM medication_schedules WHERE id=$1', [
            legacy,
          ]);
        })
      ).rejects.toThrow();
      expect(await rawDeleteMedication(f.med)).toBe(true);
      const retained = await withAdmin(
        async (client) =>
          (
            await client.query(
              'SELECT medication_id,pen_id,course_revision_id,dose_mg::text FROM injection_entries WHERE id=$1',
              [retainedActual.id]
            )
          ).rows[0]
      );
      expect(retained).toMatchObject({
        medication_id: null,
        pen_id: null,
        course_revision_id: f.revision,
        dose_mg: '1',
      });
      const exportAfterDelete = await getAppointmentReportData(owner, {
        from: day,
        to: day,
      });
      expect(
        exportAfterDelete.doseLog.find((row) => row.id === retainedActual.id)
      ).toMatchObject({
        name: 'Synthetic course medication',
        nameBasis: 'snapshot',
        deliveredMassMg: '1',
      });
      expect(
        await withAdmin(
          async (client) =>
            (
              await client.query(
                'SELECT medication_id FROM medication_courses WHERE id=$1',
                [f.course]
              )
            ).rows[0]?.medication_id
        )
      ).toBeNull();
      expect(
        await withAdmin(
          async (client) =>
            (
              await client.query(
                'SELECT original_rule FROM medication_course_handoffs WHERE original_schedule_id=$1',
                [legacy]
              )
            ).rowCount
        )
      ).toBe(1);
    });
    it('preserves saved schedule timing in appointment data without deriving historical injection times', async () => {
      const f = await fixture();
      await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: day,
        injected_at: `${day}T08:12:00Z`,
        ...attribution(f),
      });
      await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: day,
        injected_at: `${day}T08:15:00Z`,
      });
      const report = await getAppointmentReportData(owner, {
        from: day,
        to: day,
      });
      const actuals = report.doseLog.filter(
        (row) => row.medicationId === f.med
      );
      expect(actuals).toHaveLength(2);
      expect(
        actuals.filter((row) => row.timingDeltaMinutes === 12)
      ).toHaveLength(1);
      expect(
        actuals.filter((row) => row.timingDeltaMinutes === null)
      ).toHaveLength(1);
      expect(
        report.managedPlans?.find((plan) => plan.revisionId === f.revision)
      ).toMatchObject({
        current: true,
        medicationName: 'Synthetic course medication',
      });
    });
    it('archives and restores instant activity without reopening a paused revision or rewriting status/dates', async () => {
      const f = await fixture();
      await medications.updateMedication(owner, f.med, { is_active: false });
      let course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(
        course!.revisions[0]!.activity.every((a) => a.until_at !== null)
      ).toBe(true);
      await medications.updateMedication(owner, f.med, { is_active: true });
      course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(
        course!.revisions[0]!.activity.filter((a) => a.until_at === null)
      ).toHaveLength(1);
      expect(course!.revisions[0]!.status).toBe('active');
      expect(course!.revisions[0]!.start_date).toBe('2026-01-01');
      await withAdmin(async (client) => {
        await client.query(
          "UPDATE medication_course_revisions SET status='paused' WHERE id=$1",
          [f.revision]
        );
      });
      await medications.updateMedication(owner, f.med, { is_active: false });
      await medications.updateMedication(owner, f.med, { is_active: true });
      course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(
        course!.revisions[0]!.activity.filter((a) => a.until_at === null)
      ).toHaveLength(0);
      expect(course!.revisions[0]!.status).toBe('paused');
      expect(
        courseSlotsForDay({
          course: course!,
          day: addDays(day, 1),
          today: day,
          nowInstant: new Date().toISOString(),
          medicationActive: true,
        })
      ).toEqual([]);
    });
    const plan = (
      patch: Partial<MedicationCoursePlanInput> = {}
    ): MedicationCoursePlanInput => ({
      name: 'Synthetic service plan',
      start_date: '2026-01-01',
      end_date: null,
      target_dose: '1',
      dose_unit: 'mg',
      dose_basis: 'per_injection',
      rules: [{ schedule_type_id: 'daily', time_of_day: '08:00' }],
      steps: [],
      ...patch,
    });
    it('replays duplicate operations, rejects hash reuse and keeps independent authored courses', async () => {
      const f = await fixture();
      const input = {
        ...plan(),
        medication_id: f.med,
        operation_id: randomUUID(),
        expected_version: 0,
        native_reminder_limitation_acknowledged: true,
      };
      const [a, b] = await Promise.all([
        createMedicationCourse(owner, input),
        createMedicationCourse(owner, input),
      ]);
      expect(a).toEqual(b);
      await expect(
        createMedicationCourse(owner, {
          ...input,
          name: 'Synthetic changed request',
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(
        await withAdmin(
          async (client) =>
            (
              await client.query(
                'SELECT id FROM medication_courses WHERE medication_id=$1',
                [f.med]
              )
            ).rowCount
        )
      ).toBe(2);
    });
    it('invalidates a revision review when attributed actual history changes', async () => {
      const f = await fixture();
      const next = {
        ...plan({ start_date: addDays(day, 1) }),
        expected_version: 1,
      };
      const review = await reviewMedicationCourse(owner, f.course, next);
      await entries.createEntry(owner, {
        medication_id: f.med,
        status: 'taken',
        entry_date: day,
        course_revision_id: f.revision,
      });
      await expect(
        reviseMedicationCourse(owner, f.course, {
          ...review.plan,
          start_date: next.start_date!,
          expected_version: 1,
          review_fingerprint: review.review_fingerprint,
          operation_id: randomUUID(),
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(
        await withAdmin(
          async (client) =>
            (
              await client.query(
                'SELECT id FROM medication_course_revisions WHERE course_id=$1',
                [f.course]
              )
            ).rowCount
        )
      ).toBe(1);
    });
    it('serializes revise versus stock-backed actual logging without lost or reassigned administrations', async () => {
      const f = await fixture();
      const next = {
        ...plan({ start_date: addDays(day, 1) }),
        expected_version: 1,
      };
      const review = await reviewMedicationCourse(owner, f.course, next);
      const results = await Promise.allSettled([
        reviseMedicationCourse(owner, f.course, {
          ...review.plan,
          start_date: next.start_date!,
          expected_version: 1,
          review_fingerprint: review.review_fingerprint,
          operation_id: randomUUID(),
        }),
        injections.createInjection(owner, {
          medication_id: f.med,
          pen_id: f.pen,
          deduct_pen: true,
          dose_mg: 1,
          entry_date: day,
          course_revision_id: f.revision,
        }),
      ]);
      expect(results[1]!.status).toBe('fulfilled');
      if (results[0]!.status === 'rejected')
        expect(results[0]!.reason).toMatchObject({ statusCode: 409 });
      const logged = await injections.listInjections(owner, {
        medicationId: f.med,
      });
      expect(logged).toHaveLength(1);
      expect(logged[0].course_revision_id).toBe(f.revision);
      expect(await stock(f)).toBe(1);
      const course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(course!.revisions).toHaveLength(
        results[0]!.status === 'fulfilled' ? 2 : 1
      );
    });
    it('uses reviewed selected legacy handoff atomically, preserving unselected recurrence and original anchors', async () => {
      const f = await fixture();
      const ids = await withAdmin(async (client) =>
        (
          await client.query(
            "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,interval_days,start_date,active) VALUES($1,$2,'every_n_days',3,'2026-01-01',true),($1,$2,'every_n_days',5,'2026-01-02',true) RETURNING id",
            [owner, f.med]
          )
        ).rows.map((row) => row.id as string)
      );
      const available = await listCourseHandoffRules(owner, f.med);
      const selected = available.rules.find(
        (rule) => rule.schedule_id === ids[0]
      )!;
      const input = {
        ...plan({ start_date: day }),
        expected_version: 0,
        handoff: {
          cutover_day: day,
          selected_rules: [
            {
              schedule_id: selected.schedule_id,
              fingerprint: selected.fingerprint,
            },
          ],
        },
      };
      const review = await reviewMedicationCourseCreate(owner, f.med, input);
      const created = await createMedicationCourse(owner, {
        ...review.plan,
        medication_id: f.med,
        operation_id: randomUUID(),
        expected_version: 0,
        handoff: input.handoff,
        review_fingerprint: review.review_fingerprint,
        native_reminder_limitation_acknowledged: true,
      });
      const legacy = await withAdmin(
        async (client) =>
          (
            await client.query(
              'SELECT id,start_date::text,end_date::text,active,interval_days FROM medication_schedules WHERE id=ANY($1::uuid[]) ORDER BY id',
              [ids]
            )
          ).rows
      );
      expect(legacy.find((row) => row.id === ids[0])).toMatchObject({
        start_date: '2026-01-01',
        end_date: addDays(day, -1),
        active: true,
        interval_days: 3,
      });
      expect(legacy.find((row) => row.id === ids[1])).toMatchObject({
        start_date: '2026-01-02',
        end_date: null,
        active: true,
        interval_days: 5,
      });
      expect(created.course_id).not.toBe(f.course);
      const rollbackInput = {
        ...plan({ start_date: day }),
        expected_version: 0,
        handoff: {
          cutover_day: day,
          selected_rules: [
            { schedule_id: ids[1]!, fingerprint: 'stale-fingerprint' },
          ],
        },
      };
      await expect(
        createMedicationCourse(owner, {
          ...rollbackInput,
          medication_id: f.med,
          operation_id: randomUUID(),
          native_reminder_limitation_acknowledged: true,
          review_fingerprint: 'stale-review',
        })
      ).rejects.toHaveProperty('statusCode');
      expect(
        await withAdmin(
          async (client) =>
            (
              await client.query(
                'SELECT end_date FROM medication_schedules WHERE id=$1',
                [ids[1]]
              )
            ).rows[0].end_date
        )
      ).toBeNull();
    });
    it('preserves actual quantities and stock on tip deletion and never revives its predecessor', async () => {
      const f = await fixture();
      const actual = await injections.createInjection(owner, {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
        course_revision_id: f.revision,
      });
      const next = {
        ...plan({ start_date: addDays(day, 1) }),
        expected_version: 1,
      };
      const review = await reviewMedicationCourse(owner, f.course, next);
      const revised = await reviseMedicationCourse(owner, f.course, {
        ...review.plan,
        start_date: next.start_date!,
        expected_version: 1,
        review_fingerprint: review.review_fingerprint,
        operation_id: randomUUID(),
      });
      await deleteMedicationCourseRevision(
        owner,
        f.course,
        revised.revision_id,
        { operation_id: randomUUID(), expected_version: revised.version }
      );
      const course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(course!.current_revision_id).toBeNull();
      expect(course!.revisions.find((r) => r.id === f.revision)!.status).toBe(
        'completed'
      );
      const stored = (
        await injections.listInjections(owner, { medicationId: f.med })
      )[0];
      expect(stored.id).toBe(actual.id);
      expect(stored.course_revision_id).toBe(f.revision);
      expect(Number(stored.dose_mg)).toBe(1);
      expect(await stock(f)).toBe(1);
      await deleteMedicationCourseRevision(owner, f.course, f.revision, {
        operation_id: randomUUID(),
        expected_version: course!.version,
      });
      const detached = (
        await injections.listInjections(owner, { medicationId: f.med })
      )[0];
      expect(detached.course_revision_id).toBeNull();
      expect(Number(detached.dose_mg)).toBe(1);
      expect(await stock(f)).toBe(1);
    });
    it('records pause/resume intervals without backfill and keeps archived creation inactive', async () => {
      const f = await fixture();
      const paused = await setMedicationCourseStatus(owner, f.course, {
        operation_id: randomUUID(),
        expected_version: 1,
        status: 'paused',
      });
      const resumed = await setMedicationCourseStatus(owner, f.course, {
        operation_id: randomUUID(),
        expected_version: paused.version,
        status: 'active',
      });
      const course = await withOwner((client) =>
        loadMedicationCourse(client, owner, f.course)
      );
      expect(course!.revisions[0]!.activity).toHaveLength(2);
      expect(course!.version).toBe(resumed.version);
      await medications.updateMedication(owner, f.med, { is_active: false });
      const created = await createMedicationCourse(owner, {
        ...plan({ start_date: day }),
        medication_id: f.med,
        operation_id: randomUUID(),
        expected_version: 0,
        native_reminder_limitation_acknowledged: true,
      });
      const inactive = await withOwner((client) =>
        loadMedicationCourse(client, owner, created.course_id)
      );
      expect(inactive!.revisions[0]!.activity).toEqual([]);
    });
    it('allows only one exact-slot fulfilment under concurrent stock-backed requests', async () => {
      const f = await fixture();
      const request = {
        medication_id: f.med,
        pen_id: f.pen,
        deduct_pen: true,
        dose_mg: 1,
        entry_date: day,
        ...attribution(f),
      };
      const outcomes = await Promise.allSettled([
        injections.createInjection(owner, request),
        injections.createInjection(owner, request),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled')
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === 'rejected'
      );
      expect(rejected?.reason).toMatchObject({ statusCode: 409 });
      expect(await stock(f)).toBe(1);
      expect(
        await injections.listInjections(owner, { medicationId: f.med })
      ).toHaveLength(1);
      const actual = (
        await injections.listInjections(owner, { medicationId: f.med })
      )[0];
      expect(
        await injections.updateInjection(owner, actual.id, {
          notes: 'Synthetic self edit after scheduled take',
        })
      ).toMatchObject({ id: actual.id });
      await injections.deleteInjection(owner, actual.id);
      expect(await stock(f)).toBe(0);
    });
    it('keeps an immutable forward injection label across supported medication deletion then revision deletion', async () => {
      const f = await fixture();
      const actual = await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: day,
        course_revision_id: f.revision,
      });
      expect(actual.medication_name_snapshot).toBe(
        'Synthetic course medication'
      );
      await rawDeleteMedication(f.med);
      await deleteMedicationCourseRevision(owner, f.course, f.revision, {
        operation_id: randomUUID(),
        expected_version: 1,
      });
      const stored = await withAdmin(
        async (client) =>
          (
            await client.query(
              'SELECT medication_id,course_revision_id,course_origin,medication_name_snapshot,dose_mg::text FROM injection_entries WHERE id=$1',
              [actual.id]
            )
          ).rows[0]
      );
      expect(stored).toMatchObject({
        medication_id: null,
        course_revision_id: null,
        course_origin: true,
        medication_name_snapshot: 'Synthetic course medication',
        dose_mg: '1',
      });
      await expect(
        withAdmin(async (client) => {
          await client.query(
            'UPDATE injection_entries SET medication_name_snapshot=$2 WHERE id=$1',
            [actual.id, 'Synthetic rewritten label']
          );
        })
      ).rejects.toThrow();
      await expect(
        withAdmin(async (client) => {
          await client.query(
            'UPDATE injection_entries SET course_origin=NULL WHERE id=$1',
            [actual.id]
          );
        })
      ).rejects.toThrow();
      await expect(
        withAdmin(async (client) => {
          await client.query(
            'UPDATE injection_entries SET user_id=$2 WHERE id=$1',
            [actual.id, other]
          );
        })
      ).rejects.toThrow();
      const pdf = await getAppointmentReportData(owner, { from: day, to: day });
      expect(pdf.doseLog.find((row) => row.id === actual.id)).toMatchObject({
        name: 'Synthetic course medication',
        nameBasis: 'snapshot',
        deliveredMassMg: '1',
      });
    });
    it('retains explicit managed origin after detachment so manual and scheduled actuals never become implicit legacy credit', async () => {
      for (const scheduled of [false, true]) {
        const f = await fixture();
        const refs = scheduled
          ? attribution(f)
          : { course_revision_id: f.revision };
        const actual = await entries.createEntry(owner, {
          medication_id: f.med,
          status: 'taken',
          entry_date: day,
          ...refs,
        });
        await deleteMedicationCourseRevision(owner, f.course, f.revision, {
          operation_id: randomUUID(),
          expected_version: 1,
        });
        const detached = (
          await entries.listEntriesWithInjections(owner, {
            medicationId: f.med,
          })
        )[0];
        expect(detached.id).toBe(actual.id);
        expect(detached.course_revision_id).toBeNull();
        expect(detached.course_origin).toBe(true);
        if (scheduled) {
          expect(detached.scheduled_day).toBe(day);
          expect(new Date(detached.scheduled_for).toISOString()).toBe(
            attribution(f).scheduled_for
          );
        }
        await expect(
          withAdmin(async (client) => {
            await client.query(
              'UPDATE medication_entries SET course_origin=NULL WHERE id=$1',
              [actual.id]
            );
          })
        ).rejects.toThrow();
        await expect(
          withAdmin(async (client) => {
            await client.query(
              'UPDATE medication_entries SET user_id=$2 WHERE id=$1',
              [actual.id, other]
            );
          })
        ).rejects.toThrow();
        expect(
          entryMatchesDue(detached, {
            medication: { id: f.med },
            schedule: { id: 'unselected-legacy-rule' },
          })
        ).toBe(false);
      }
      const f = await fixture();
      const actual = await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: day,
        course_revision_id: f.revision,
      });
      await deleteMedicationCourseRevision(owner, f.course, f.revision, {
        operation_id: randomUUID(),
        expected_version: 1,
      });
      const detached = (
        await entries.listEntriesWithInjections(owner, { medicationId: f.med })
      )[0];
      expect(detached.id).toBe(actual.id);
      expect(detached.course_origin).toBe(true);
      expect(
        entryMatchesDue(detached, {
          medication: { id: f.med },
          schedule: { id: 'unselected-legacy-rule' },
        })
      ).toBe(false);
    });
    it('detaches explicit course references without erasing captured planned timing', async () => {
      const f = await fixture();
      const actual = await entries.createEntry(owner, {
        medication_id: f.med,
        entry_date: day,
        status: 'taken',
        ...attribution(f),
      });
      const detached = await entries.updateEntry(owner, actual.id, {
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
        scheduled_day: null,
        scheduled_for: null,
      });
      expect(detached.course_revision_id).toBeNull();
      expect(detached.course_origin).toBe(true);
      expect(detached.scheduled_day).toBe(day);
      expect(new Date(detached.scheduled_for).toISOString()).toBe(
        attribution(f).scheduled_for
      );
      const g = await fixture();
      const injection = await injections.createInjection(owner, {
        medication_id: g.med,
        dose_mg: 1,
        entry_date: day,
        ...attribution(g),
      });
      const detachedInjection = await injections.updateInjection(
        owner,
        injection.id,
        {
          course_revision_id: null,
          course_rule_id: null,
          course_step_id: null,
          course_slot_key: null,
          scheduled_day: null,
          scheduled_for: null,
        }
      );
      const echoed = await injections.updateInjection(owner, injection.id, {
        scheduled_for: attribution(g).scheduled_for,
        scheduled_day: day,
        notes: 'Synthetic retained timing echo',
      });
      expect(echoed.scheduled_day).toBe(day);
      await expect(
        injections.updateInjection(owner, injection.id, {
          scheduled_for: `${day}T09:00:00Z`,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(detachedInjection.course_revision_id).toBeNull();
      expect(detachedInjection.course_origin).toBe(true);
      expect(detachedInjection.scheduled_day).toBe(day);
      expect(new Date(detachedInjection.scheduled_for).toISOString()).toBe(
        attribution(g).scheduled_for
      );
    });
  }
);
