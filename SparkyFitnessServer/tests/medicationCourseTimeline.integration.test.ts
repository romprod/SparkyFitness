import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import { getMedicationCourseTimeline } from '../services/medicationCourseTimelineService.js';
import { loadMedicationCourseTimelineSnapshot } from '../models/medicationCourseTimelineRepository.js';

describe.runIf(process.env.MEDICATION_COURSE_TIMELINE_INTEGRATION === '1')(
  'read-only plan timeline PostgreSQL ownership and coherent facts',
  () => {
    const owner = randomUUID(),
      reportReader = randomUUID(),
      manager = randomUUID(),
      foreign = randomUUID(),
      med = randomUUID();
    const now = new Date('2026-11-16T23:30:00Z');
    let primary: { course: string; revision: string };
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const createCourse = async (
      options: {
        medication?: string | null;
        name?: string;
        end?: string | null;
      } = {}
    ) =>
      admin(async (c) => {
        const id = randomUUID(),
          revision = randomUUID();
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,captured_at,timezone) VALUES($1,$2,$3,'Synthetic saved medication','2026-11-01','2026-11-01T00:00:00Z','America/Los_Angeles')",
          [
            id,
            owner,
            options.medication === undefined ? med : options.medication,
          ]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,status,start_date,end_date,target_dose,dose_unit,dose_basis,notes,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date) VALUES($1,$2,$3,1,$4,'active','2026-11-01',$5,777,'mg','per_injection','Synthetic private note excluded from timeline',1,1,'2026-11-01')",
          [
            revision,
            owner,
            id,
            options.name ?? 'Synthetic timeline current',
            options.end === undefined ? '2026-11-07' : options.end,
          ]
        );
        await c.query(
          "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-11-01T00:00:00Z')",
          [owner, revision]
        );
        await c.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [id, revision]
        );
        return { course: id, revision };
      });
    const snapshot = async (actor = owner) => {
      const client: PoolClient = await getClient(owner, actor);
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await loadMedicationCourseTimelineSnapshot(
          client,
          owner,
          now
        );
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of [owner, reportReader, manager, foreign])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `synthetic-timeline-${id}@example.test`]
          );
        for (const [actor, permission] of [
          [reportReader, 'can_view_reports'],
          [manager, 'can_manage_medications'],
        ])
          await c.query(
            "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,$3::jsonb,$4,'active')",
            [
              owner,
              actor,
              JSON.stringify({ [permission!]: true }),
              `synthetic-${actor}@example.test`,
            ]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Pacific/Kiritimati')",
          [owner]
        );
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,is_active,dose_amount,dose_unit) VALUES($1,$2,'Synthetic current medication','injection',true,777,'mg')",
          [med, owner]
        );
      });
      primary = await createCourse();
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, reportReader, manager, foreign],
        ])
      );
      await endPool();
    });
    it('uses authoritative profile calendar and saved course timezone, with distinct active/archived/missing master facts', async () => {
      const timeline = await getMedicationCourseTimeline(owner, now);
      expect(timeline).toMatchObject({
        as_of: now.toISOString(),
        today: '2026-11-17',
        timezone: 'Pacific/Kiritimati',
      });
      expect(timeline.window.days).toBe(140);
      expect(timeline.week_ticks).toHaveLength(20);
      expect(timeline.overlap).toHaveLength(140);
      expect(
        timeline.rows.find((row) => row.revision_id === primary.revision)
      ).toMatchObject({
        timezone: 'America/Los_Angeles',
        local_today: '2026-11-16',
        medication_active: true,
        is_current_tip: true,
        overlap_eligible: true,
      });
      await admin((c) =>
        c.query('UPDATE medications SET is_active=false WHERE id=$1', [med])
      );
      const archived = await getMedicationCourseTimeline(owner, now);
      expect(
        archived.rows.find((row) => row.revision_id === primary.revision)
      ).toMatchObject({ medication_active: false, overlap_eligible: false });
      const missing = await createCourse({
        medication: null,
        name: 'Synthetic missing medication',
      });
      const after = await getMedicationCourseTimeline(owner, now);
      expect(
        after.rows.find((row) => row.revision_id === missing.revision)
      ).toMatchObject({
        medication_id: null,
        medication_name: 'Synthetic saved medication',
        medication_active: null,
        overlap_eligible: false,
      });
      await admin((c) =>
        c.query('UPDATE medications SET is_active=true WHERE id=$1', [med])
      );
    });
    it('retains deleted successor cutoffs without resurrecting a tip or exposing deleted courses', async () => {
      const f = await createCourse({ end: '2026-11-30' }),
        successor = randomUUID();
      await admin(async (c) => {
        await c.query(
          "UPDATE medication_course_revisions SET status='completed',closed_date='2026-11-30' WHERE id=$1",
          [f.revision]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,status,start_date,end_date,dose_unit,dose_basis,deleted_at) VALUES($1,$2,$3,$4,2,'Synthetic deleted tip','active','2026-11-15','2026-11-30','mg','per_injection','2026-11-16T12:00:00Z')",
          [successor, owner, f.course, f.revision]
        );
        await c.query(
          'UPDATE medication_courses SET current_revision_id=NULL WHERE id=$1',
          [f.course]
        );
      });
      const timeline = await getMedicationCourseTimeline(owner, now);
      expect(timeline.rows.some((row) => row.revision_id === successor)).toBe(
        false
      );
      const row = timeline.rows.find((row) => row.revision_id === f.revision)!;
      expect(row).toMatchObject({
        is_current_tip: false,
        overlap_eligible: false,
      });
      expect(row.segments.length).toBeGreaterThan(0);
      expect(row.segments.every((segment) => segment.to <= '2026-11-14')).toBe(
        true
      );
      await admin((c) =>
        c.query(
          "UPDATE medication_courses SET deleted_at='2026-11-16T12:00:00Z' WHERE id=$1",
          [f.course]
        )
      );
      expect(
        (await getMedicationCourseTimeline(owner, now)).rows.some(
          (row) => row.course_id === f.course
        )
      ).toBe(false);
    });
    it('keeps plan, medication, activity and profile facts in one read-only repeatable-read snapshot', async () => {
      const client: PoolClient = await getClient(owner);
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        expect(
          (await client.query('SHOW transaction_isolation')).rows[0]!
            .transaction_isolation
        ).toBe('repeatable read');
        expect(
          (await client.query('SHOW transaction_read_only')).rows[0]!
            .transaction_read_only
        ).toBe('on');
        const first = await loadMedicationCourseTimelineSnapshot(
          client,
          owner,
          now
        );
        await admin(async (c) => {
          await c.query(
            "UPDATE medication_course_revisions SET name='Synthetic changed plan' WHERE id=$1",
            [primary.revision]
          );
          await c.query('UPDATE medications SET is_active=false WHERE id=$1', [
            med,
          ]);
          await c.query(
            "UPDATE user_preferences SET timezone='UTC' WHERE user_id=$1",
            [owner]
          );
          await c.query(
            "UPDATE medication_course_activity SET until_at='2026-11-16T12:00:00Z' WHERE revision_id=$1",
            [primary.revision]
          );
        });
        expect(
          await loadMedicationCourseTimelineSnapshot(client, owner, now)
        ).toEqual(first);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const fresh = await getMedicationCourseTimeline(owner, now);
      expect(fresh).toMatchObject({ timezone: 'UTC', today: '2026-11-16' });
      expect(
        fresh.rows.find((row) => row.revision_id === primary.revision)
      ).toMatchObject({
        name: 'Synthetic changed plan',
        medication_active: false,
        overlap_eligible: false,
      });
    });
    it('retains existing owner/report/medication-reader visibility and excludes foreign users under RLS', async () => {
      for (const actor of [owner, reportReader, manager]) {
        const value = await snapshot(actor);
        expect(value.courses.some((row) => row.id === primary.course)).toBe(
          true
        );
      }
      const denied = await snapshot(foreign);
      expect(denied.courses).toEqual([]);
      expect(denied.medications.size).toBe(0);
    });
    it('changes no stored facts and exposes no dose/private notes or fabricated actual history', async () => {
      const facts = () =>
        admin(async (c) => {
          const value: Record<string, unknown> = {};
          for (const table of [
            'user_preferences',
            'medications',
            'medication_courses',
            'medication_course_revisions',
            'medication_course_activity',
            'medication_course_rules',
            'medication_course_steps',
            'medication_course_operations',
          ])
            value[table] = (
              await c.query(
                `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE user_id=$1`,
                [owner]
              )
            ).rows[0]!.rows;
          return value;
        });
      const before = await facts(),
        timeline = await getMedicationCourseTimeline(owner, now);
      expect(await facts()).toEqual(before);
      const wire = JSON.stringify(timeline);
      expect(wire).not.toContain('Synthetic private note');
      expect(wire).not.toMatch(
        /target_dose|dose_unit|phase_family|actuals|stock|notes|user_id/
      );
    });
  }
);
