import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { coursePhaseActuals, coursePhaseForRevision } from '@workspace/shared';
import {
  loadCourseActuals,
  loadCoursePhaseActuals,
  loadMedicationCourse,
} from '../models/medicationCourseRepository.js';
import { deleteMedicationCourseRevision } from '../services/medicationCourseService.js';

// Runs in the same explicitly selected synthetic database as the command/phase gates.
describe.runIf(process.env.MEDICATION_COURSE_CYCLES_INTEGRATION === '1')(
  'cycle schema and retained provenance PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (client) => {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `synthetic-cycle-schema-${id}@example.test`]
          );
      });
    });
    afterAll(async () => {
      await admin((client) =>
        client.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });
    const fixture = async (user = owner) =>
      admin(async (client) => {
        const med = randomUUID(),
          course = randomUUID(),
          origin = randomUUID();
        await client.query(
          "INSERT INTO medications(id,user_id,name,type_id,dose_amount,dose_unit) VALUES($1,$2,'Synthetic cycle schema','injection',1,'mg')",
          [med, user]
        );
        await client.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic cycle schema','2026-01-01','UTC','2026-01-01T00:00:00Z')",
          [course, user, med]
        );
        await client.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,start_date,dose_unit,target_dose,phase_origin_context) VALUES($1,$2,$3,1,'Synthetic origin','2026-01-01','mg',1,'{\"start_date\":\"2026-01-01\",\"end_date\":null}'::jsonb)",
          [origin, user, course]
        );
        await client.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [course, origin]
        );
        return { user, med, course, origin };
      });
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const row = (f: Fixture) =>
      admin(
        async (client) =>
          (
            await client.query(
              'SELECT to_jsonb(r) AS value FROM medication_course_revisions r WHERE id=$1',
              [f.origin]
            )
          ).rows[0]!.value
      );
    const continuation = (f: Fixture, family = f.origin) =>
      admin(async (client) => {
        const next = randomUUID();
        await client.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,start_date,dose_unit,target_dose,phase_family_id) VALUES($1,$2,$3,$4,2,'Synthetic continuation','2026-01-15','mg',1,$5)",
          [next, f.user, f.course, f.origin, family]
        );
        return next;
      });
    const ordinary = (f: Fixture) =>
      admin(
        async (client) =>
          (
            await client.query(
              "INSERT INTO medication_entries(user_id,medication_id,course_revision_id,status,taken_at,entry_date,scheduled_day,scheduled_for) VALUES($1,$2,$3,'taken','2026-01-05T08:00:00Z','2026-01-05','2026-01-05','2026-01-05T08:00:00Z') RETURNING id",
              [f.user, f.med, f.origin]
            )
          ).rows[0]!.id as string
      );

    it('rejects invalid weekly ranges and orphaned breaks without changing the original row', async () => {
      const f = await fixture(),
        before = await row(f);
      for (const [on, off] of [
        [0, null],
        [105, null],
        [-1, 1],
        [null, 1],
      ]) {
        await expect(
          admin((client) =>
            client.query(
              'UPDATE medication_course_revisions SET course_cycle_on_weeks=$2,course_cycle_off_weeks=$3 WHERE id=$1',
              [f.origin, on, off]
            )
          )
        ).rejects.toThrow();
      }
      expect(await row(f)).toEqual(before);
    });
    it('rejects context rewrites or non-window JSON while delivered facts exist', async () => {
      const f = await fixture();
      await ordinary(f);
      const before = await row(f);
      for (const context of [
        { start_date: '2026-01-01', end_date: null, delivered_count: 9 },
        { start_date: '2026-02-30', end_date: null },
        { start_date: '2026-01-02', end_date: null },
      ]) {
        await expect(
          admin((client) =>
            client.query(
              'UPDATE medication_course_revisions SET phase_origin_context=$2::jsonb WHERE id=$1',
              [f.origin, JSON.stringify(context)]
            )
          )
        ).rejects.toThrow();
      }
      expect(await row(f)).toEqual(before);
    });
    it('scopes continuation families to the actual predecessor owner/course and freezes identity', async () => {
      const f = await fixture(),
        foreign = await fixture(other),
        independent = await fixture();
      await expect(continuation(f, foreign.origin)).rejects.toThrow();
      await expect(continuation(f, independent.origin)).rejects.toThrow();
      const next = await continuation(f);
      await expect(
        admin((client) =>
          client.query(
            'UPDATE medication_course_revisions SET phase_family_id=$2 WHERE id=$1',
            [next, independent.origin]
          )
        )
      ).rejects.toThrow();
    });
    it('derives actual family from known explicit attribution and forbids unlinked or foreign forgery', async () => {
      const f = await fixture(),
        foreign = await fixture(other);
      await expect(
        admin((client) =>
          client.query(
            "INSERT INTO medication_entries(user_id,medication_id,status,phase_family_id) VALUES($1,$2,'taken',$3)",
            [owner, f.med, f.origin]
          )
        )
      ).rejects.toThrow();
      await expect(
        admin((client) =>
          client.query(
            "INSERT INTO medication_entries(user_id,medication_id,course_revision_id,status,phase_family_id) VALUES($1,$2,$3,'taken',$4)",
            [owner, f.med, f.origin, foreign.origin]
          )
        )
      ).rejects.toThrow();
      const actual = await ordinary(f);
      await admin((client) =>
        client.query(
          'UPDATE medication_entries SET course_revision_id=NULL,course_rule_id=NULL,course_step_id=NULL,course_slot_key=NULL WHERE id=$1',
          [actual]
        )
      );
      await expect(
        admin((client) =>
          client.query(
            'UPDATE medication_entries SET phase_family_id=NULL WHERE id=$1',
            [actual]
          )
        )
      ).rejects.toThrow();
      const stored = await admin(
        async (client) =>
          (
            await client.query(
              'SELECT phase_family_id,course_revision_id,scheduled_day::text,scheduled_for FROM medication_entries WHERE id=$1',
              [actual]
            )
          ).rows[0]!
      );
      expect(stored.phase_family_id).toBe(f.origin);
      expect(stored.course_revision_id).toBeNull();
      expect(stored.scheduled_day).toBe('2026-01-05');
      expect(new Date(stored.scheduled_for).toISOString()).toBe(
        '2026-01-05T08:00:00.000Z'
      );
    });
    it('permits genuine medicine and whole-course FK cleanup while retaining actual timing and phase facts', async () => {
      const f = await fixture();
      await continuation(f);
      const actual = await ordinary(f);
      await admin((client) =>
        client.query('DELETE FROM medications WHERE id=$1', [f.med])
      );
      await admin((client) =>
        client.query('DELETE FROM medication_courses WHERE id=$1', [f.course])
      );
      const stored = await admin(
        async (client) =>
          (
            await client.query(
              'SELECT medication_id,course_revision_id,phase_family_id,scheduled_day::text FROM medication_entries WHERE id=$1',
              [actual]
            )
          ).rows[0]!
      );
      expect(stored.medication_id).toBeNull();
      expect(stored.course_revision_id).toBeNull();
      expect(stored.phase_family_id).toBe(f.origin);
      expect(stored.scheduled_day).toBe('2026-01-05');
    });
    it('captures pre-P07 NULL phase provenance on ordinary origin deletion without losing phase progress or timing', async () => {
      const f = await fixture(),
        next = await continuation(f),
        actual = randomUUID();
      await admin(async (client) => {
        for (const revision of [f.origin, next]) {
          await client.query(
            "INSERT INTO medication_course_rules(user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,0,'daily','08:00')",
            [owner, revision]
          );
          await client.query(
            "INSERT INTO medication_course_steps(user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,0,1,'mg',1),($1,$2,1,2,'mg',NULL)",
            [owner, revision]
          );
        }
        await client.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [f.course, next]
        );
        // A nullable column added to a real pre-P07 record stays NULL. Seed only
        // that synthetic representation under a transaction-local table lock;
        // restore the current trigger before COMMIT (ROLLBACK restores it on error).
        await client.query('BEGIN');
        try {
          await client.query(
            'ALTER TABLE public.medication_entries DISABLE TRIGGER medication_entry_course_scope'
          );
          await client.query(
            "INSERT INTO medication_entries(id,user_id,medication_id,course_revision_id,course_origin,phase_family_id,status,taken_at,entry_date,scheduled_for,scheduled_day) VALUES($1,$2,$3,$4,true,NULL,'taken','2026-01-05T08:00:00Z','2026-01-05','2026-01-05T08:00:00Z','2026-01-05')",
            [actual, owner, f.med, f.origin]
          );
          await client.query(
            'ALTER TABLE public.medication_entries ENABLE TRIGGER medication_entry_course_scope'
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      expect(
        (
          await admin(
            async (client) =>
              (
                await client.query(
                  'SELECT phase_family_id FROM medication_entries WHERE id=$1',
                  [actual]
                )
              ).rows[0]!
          )
        ).phase_family_id
      ).toBeNull();
      const state = () =>
        admin(async (client) => {
          const course = (await loadMedicationCourse(client, owner, f.course))!;
          const revision = course.revisions.find((item) => item.id === next)!;
          const facts = coursePhaseActuals({
            course,
            revision,
            delivered: await loadCoursePhaseActuals(client, owner, f.course),
          });
          return {
            count: facts.length,
            dose: coursePhaseForRevision({
              course,
              revision,
              deliveredCount: facts.length,
            }).dose_amount,
            visible: (await loadCourseActuals(client, owner, f.course)).length,
          };
        });
      expect(await state()).toEqual({ count: 1, dose: '2', visible: 1 });
      await deleteMedicationCourseRevision(
        owner,
        f.course,
        f.origin,
        { operation_id: randomUUID(), expected_version: 1 },
        new Date('2026-01-16T12:00:00Z')
      );
      expect(await state()).toEqual({ count: 1, dose: '2', visible: 0 });
      const stored = await admin(
        async (client) =>
          (
            await client.query(
              'SELECT course_revision_id,phase_family_id,scheduled_day::text,scheduled_for FROM medication_entries WHERE id=$1',
              [actual]
            )
          ).rows[0]!
      );
      expect(stored.course_revision_id).toBeNull();
      expect(stored.phase_family_id).toBe(f.origin);
      expect(stored.scheduled_day).toBe('2026-01-05');
      expect(new Date(stored.scheduled_for).toISOString()).toBe(
        '2026-01-05T08:00:00.000Z'
      );
    });

    it('permits actual account deletion with continuing families and both actual-table FK paths', async () => {
      const account = randomUUID();
      await admin((client) =>
        client.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [account, `synthetic-cycle-cleanup-${account}@example.test`]
        )
      );
      const f = await fixture(account),
        next = await continuation(f);
      await ordinary(f);
      await admin((client) =>
        client.query(
          "INSERT INTO injection_entries(user_id,medication_id,course_revision_id,entry_date,dose_mg,medication_name_snapshot) VALUES($1,$2,$3,'2026-01-15',1,'Synthetic cycle schema')",
          [account, f.med, next]
        )
      );
      await admin((client) =>
        client.query('DELETE FROM public."user" WHERE id=$1', [account])
      );
      const count = await admin(
        async (client) =>
          (
            await client.query(
              'SELECT COUNT(*)::int AS n FROM injection_entries WHERE user_id=$1',
              [account]
            )
          ).rows[0]!.n
      );
      expect(count).toBe(0);
    });
  }
);
