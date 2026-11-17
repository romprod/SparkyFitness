import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import { loadInventoryForecastSnapshot } from '../models/medicationInventoryForecastRepository.js';
import { classifyInventoryPreparation } from '../services/medicationInventoryDashboardClassification.js';

// No projection mode is persisted or needed by this shared, read-only fact loader.
describe.runIf(
  process.env.INVENTORY_PLANNED_CYCLES_SNAPSHOT_INTEGRATION === '1'
)('planned cycle complete read-only snapshot PostgreSQL', () => {
  const owner = randomUUID(),
    other = randomUUID(),
    delegate = randomUUID();
  const now = new Date('2026-11-17T12:00:00Z');
  const admin = async <T>(fn: (c: PoolClient) => Promise<T>) => {
    const c = await getSystemClient();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  };
  const read = async (actor = owner) => {
    const c = await getClient(owner, actor);
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await loadInventoryForecastSnapshot(c, owner, now);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  };
  beforeAll(async () => {
    expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
    await admin(async (c) => {
      for (const id of [owner, other, delegate])
        await c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [id, `planned-snapshot-${id}@example.test`]
        );
      await c.query(
        "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_manage_medications\":true}'::jsonb,$3,'active')",
        [owner, delegate, `synthetic-${delegate}@example.test`]
      );
    });
  });
  afterAll(async () => {
    await admin((c) =>
      c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
        [owner, other, delegate],
      ])
    );
    await endPool();
  });
  const fixture = async (
    status: 'active' | 'paused' | 'completed' = 'active',
    future = false,
    user = owner
  ) =>
    admin(async (c) => {
      const med = randomUUID(),
        course = randomUUID(),
        origin = randomUUID(),
        next = future ? randomUUID() : null,
        rule = randomUUID(),
        raw = randomUUID();
      await c.query('BEGIN');
      try {
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,$2,'Synthetic planned cycle','injection','subcutaneous',1,'mg',false)",
          [med, user]
        );
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic planned cycle','2026-11-01','Europe/London','2026-11-01T00:00:00Z')",
          [course, user, med]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,status,start_date,end_date,target_dose,dose_unit,dose_basis,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date,phase_origin_context) VALUES($1,$2,$3,1,'Synthetic origin',$4,'2026-11-02','2026-11-08',1.125,'mg','per_injection',1,2,'2026-11-02','{\"start_date\":\"2026-11-02\",\"end_date\":\"2026-11-08\"}'::jsonb)",
          [origin, user, course, status]
        );
        await c.query(
          "INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,schedule_type_id,time_of_day,interval_days,start_date,end_date,anchor_date) VALUES($1,$2,$3,0,'every_n_days','08:15',3,'2026-11-02','2026-12-31','2026-11-02')",
          [rule, user, origin]
        );
        await c.query(
          "INSERT INTO medication_course_steps(user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,0,1.125,'mg',7),($1,$2,1,2.25,'mg',NULL)",
          [user, origin]
        );
        await c.query(
          "INSERT INTO medication_course_activity(user_id,revision_id,from_at,until_at) VALUES($1,$2,'2026-11-02T00:00:00Z','2026-11-09T00:00:00Z')",
          [user, origin]
        );
        if (next) {
          await c.query(
            "INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,status,start_date,end_date,target_dose,dose_unit,dose_basis,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date,phase_family_id) VALUES($1,$2,$3,$4,2,'Synthetic future tip','active','2026-12-01','2026-12-07',1.125,'mg','per_injection',1,2,'2026-12-01',$4)",
            [next, user, course, origin]
          );
          await c.query(
            "INSERT INTO medication_course_rules(user_id,revision_id,rule_index,schedule_type_id,time_of_day,start_date,anchor_date) VALUES($1,$2,0,'daily','09:00','2026-12-01','2026-11-02')",
            [user, next]
          );
          await c.query(
            "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-12-01T00:00:00Z')",
            [user, next]
          );
        }
        await c.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [course, next ?? origin]
        );
        const actual = (
          await c.query<{ id: string }>(
            "INSERT INTO medication_entries(user_id,medication_id,course_revision_id,course_rule_id,entry_date,taken_at,status) VALUES($1,$2,$3,$4,'2026-11-03','2026-11-03T08:16:00Z','taken') RETURNING id",
            [user, med, origin, rule]
          )
        ).rows[0]!.id;
        await c.query(
          'UPDATE medication_entries SET course_revision_id=NULL,course_rule_id=NULL WHERE id=$1',
          [actual]
        );
        await c.query(
          "INSERT INTO medication_pens(id,user_id,medication_id,kind,label,label_mass_mg,dose_mg,doses_total,doses_used,status) VALUES($1,$2,$3,'vial','Synthetic raw',10.1234567890123456789,1,10,0,'sealed')",
          [raw, user, med]
        );
        await c.query('COMMIT');
        return { med, course, origin, next, rule, raw, actual };
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    });
  const facts = () =>
    admin(async (c) => {
      const result: Record<string, unknown> = {};
      for (const table of [
        'medications',
        'medication_courses',
        'medication_course_revisions',
        'medication_course_rules',
        'medication_course_steps',
        'medication_course_activity',
        'medication_entries',
        'injection_entries',
        'medication_pens',
        'medication_preparations',
        'user_preferences',
        'medication_device_preferences',
      ]) {
        result[table] = (
          await c.query(
            `SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY to_jsonb(t)::text`,
            [owner]
          )
        ).rows;
      }
      return result;
    });
  it('retains active past-end, future-tip, paused and completed authored facts without projecting or mutating them', async () => {
    const active = await fixture(),
      paused = await fixture('paused'),
      completed = await fixture('completed'),
      future = await fixture('completed', true);
    const before = await facts(),
      snapshot = await read();
    for (const [f, status] of [
      [active, 'active'],
      [paused, 'paused'],
      [completed, 'completed'],
      [future, 'completed'],
    ] as const) {
      const med = snapshot.medications.find((m) => m.id === f.med)!;
      const course = med.courses.find((c) => c.id === f.course)!;
      const revision = course.revisions.find((r) => r.id === f.origin)!;
      expect(course.timezone).toBe('Europe/London');
      expect(revision).toMatchObject({
        status,
        start_date: '2026-11-02',
        end_date: '2026-11-08',
        course_cycle_on_weeks: 1,
        course_cycle_off_weeks: 2,
        course_cycle_anchor_date: '2026-11-02',
        phase_origin_context: {
          start_date: '2026-11-02',
          end_date: '2026-11-08',
        },
      });
      expect(revision.rules[0]).toMatchObject({
        id: f.rule,
        schedule_type_id: 'every_n_days',
        interval_days: 3,
        time_of_day: '08:15:00',
        anchor_date: '2026-11-02',
        end_date: '2026-12-31',
      });
      expect(revision.steps.map((s) => s.dose)).toEqual(['1.125', '2.25']);
      expect(revision.activity[0]).toMatchObject({
        from_at: '2026-11-02T00:00:00.000Z',
        until_at: '2026-11-09T00:00:00.000Z',
      });
      expect(med.actuals).toHaveLength(0);
      expect(med.phase_actuals).toEqual([
        expect.objectContaining({
          id: f.actual,
          phase_family_id: f.origin,
          course_revision_id: null,
          status: 'taken',
        }),
      ]);
      const raw = snapshot.dashboard_stock.find((s) => s.id === f.raw)!;
      expect(raw).toMatchObject({
        status: 'sealed',
        label_mass_mg: '10.1234567890123456789',
        dose_mg: '1',
        doses_total: 10,
        doses_used: 0,
        concentration_mg_ml: null,
        volume_ml: null,
        current_preparation_id: null,
        prior_preparation: false,
        linked_actual_count: '0',
      });
      expect(classifyInventoryPreparation(raw)).toBe('needs_preparation');
    }
    expect(
      snapshot.medications.find((m) => m.id === future.med)!.courses[0]
    ).toMatchObject({
      current_revision_id: future.next,
      revisions: expect.arrayContaining([
        expect.objectContaining({
          id: future.next,
          predecessor_id: future.origin,
          phase_family_id: future.origin,
          start_date: '2026-12-01',
          course_cycle_anchor_date: '2026-12-01',
        }),
      ]),
    });
    expect(await facts()).toEqual(before);
  });
  it('uses one caller-owned repeatable-read snapshot for course status, rules, activity, phase actuals and raw stock', async () => {
    const f = await fixture(),
      c = await getClient(owner);
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const first = await loadInventoryForecastSnapshot(c, owner, now);
      await admin(async (writer) => {
        await writer.query('BEGIN');
        try {
          await writer.query(
            "UPDATE medication_course_revisions SET status='paused' WHERE id=$1",
            [f.origin]
          );
          await writer.query(
            "UPDATE medication_course_rules SET time_of_day='10:30' WHERE id=$1",
            [f.rule]
          );
          await writer.query(
            "UPDATE medication_course_activity SET until_at='2026-11-08T23:00:00Z' WHERE revision_id=$1",
            [f.origin]
          );
          await writer.query(
            "UPDATE medication_entries SET status='skipped' WHERE id=$1",
            [f.actual]
          );
          await writer.query(
            "UPDATE medication_pens SET status='in_use',opened_at='2026-11-17' WHERE id=$1",
            [f.raw]
          );
          await writer.query('COMMIT');
        } catch (error) {
          await writer.query('ROLLBACK');
          throw error;
        }
      });
      expect(await loadInventoryForecastSnapshot(c, owner, now)).toEqual(first);
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const fresh = await read(),
      med = fresh.medications.find((m) => m.id === f.med)!;
    expect(med.courses[0]!.revisions[0]).toMatchObject({
      status: 'paused',
      rules: [expect.objectContaining({ time_of_day: '10:30:00' })],
      activity: [
        expect.objectContaining({ until_at: '2026-11-08T23:00:00.000Z' }),
      ],
    });
    expect(med.phase_actuals[0]!.status).toBe('skipped');
    expect(fresh.dashboard_stock.find((s) => s.id === f.raw)).toMatchObject({
      status: 'in_use',
      opened_at: '2026-11-17',
    });
  });
  it('keeps owner/delegate scope and leaves all facts and missing preferences unchanged across repeated reads', async () => {
    const f = await fixture(),
      foreign = await fixture('active', false, other),
      before = await facts();
    const own = await read(),
      delegated = await read(delegate);
    expect(delegated).toEqual(own);
    expect(own.medications.some((m) => m.id === f.med)).toBe(true);
    expect(own.medications.some((m) => m.id === foreign.med)).toBe(false);
    expect(own.dashboard_stock.some((s) => s.id === foreign.raw)).toBe(false);
    expect(await read()).toEqual(own);
    expect(await facts()).toEqual(before);
  });
});
