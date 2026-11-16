import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  coursePhaseActuals,
  coursePhaseContext,
  coursePhaseDeliveredBeforeSlot,
} from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import * as entries from '../models/medicationEntryRepository.js';
import * as injections from '../models/injectionRepository.js';
import * as medications from '../models/medicationRepository.js';
import { getMedicationCourseHistory } from '../services/medicationCourseService.js';
import { loadInventoryForecastSnapshot } from '../models/medicationInventoryForecastRepository.js';
import {
  loadCourseActuals,
  loadCoursePhaseActuals,
  loadMedicationCourse,
} from '../models/medicationCourseRepository.js';

// Synthetic opt-in only. Family metadata is fixture server state, never a client-authored association.
describe.runIf(process.env.COURSE_PHASE_SNAPSHOT_INTEGRATION === '1')(
  'phase-only snapshot and actual mutation locking PostgreSQL',
  () => {
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
    const read = async <T>(
      fn: (c: PoolClient) => Promise<T>,
      actor = owner
    ) => {
      const c: PoolClient = await getClient(owner, actor);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await fn(c);
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
            [id, `phase-snapshot-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_manage_medications\":true}'::jsonb,$3,'active')",
          [owner, delegate, `synthetic-${delegate}@example.test`]
        );
      });
    });
    afterAll(async () => {
      await admin(async (c) => {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other, delegate],
        ]);
      });
      await endPool();
    });
    const fixture = async (user = owner, existingMedication?: string) =>
      admin(async (c) => {
        const med = existingMedication ?? randomUUID(),
          course = randomUUID(),
          origin = randomUUID(),
          next = randomUUID(),
          rule = randomUUID(),
          nextRule = randomUUID(),
          pen = randomUUID();
        await c.query('BEGIN');
        try {
          if (!existingMedication)
            await c.query(
              "INSERT INTO medications(id,user_id,name,type_id,dose_amount,dose_unit,is_glp1) VALUES($1,$2,'Synthetic phase product','injection',1,'mg',false)",
              [med, user]
            );
          await c.query(
            "INSERT INTO medication_pens(id,user_id,medication_id,kind,dose_mg,doses_total,doses_used) VALUES($1,$2,$3,'pen',1,10,0)",
            [pen, user, med]
          );
          await c.query(
            "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic phase product','2026-01-01','UTC','2026-01-01T00:00:00Z')",
            [course, user, med]
          );
          await c.query(
            "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,status,start_date,end_date,closed_date,target_dose,dose_unit,dose_basis,phase_origin_context,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date) VALUES($1,$2,$3,1,'Synthetic origin','active','2026-01-01','2026-06-30',NULL,1,'mg','per_injection','{\"start_date\":\"2026-01-01\",\"end_date\":\"2026-06-30\"}'::jsonb,2,1,'2026-01-01')",
            [origin, user, course]
          );
          await c.query(
            "UPDATE medication_course_revisions SET status='completed',end_date='2026-01-14',closed_date='2026-01-14' WHERE id=$1",
            [origin]
          );
          await c.query(
            "INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,start_date,end_date,target_dose,dose_unit,dose_basis,phase_family_id,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date) VALUES($1,$2,$3,$4,2,'Synthetic continuation','2026-01-15','2026-01-28',1,'mg','per_injection',$4,2,1,'2026-01-15')",
            [next, user, course, origin]
          );
          for (const [id, revision] of [
            [rule, origin],
            [nextRule, next],
          ])
            await c.query(
              "INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,$3,0,'daily','08:00')",
              [id, user, revision]
            );
          await c.query(
            "INSERT INTO medication_course_steps(user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,0,1,'mg',7),($1,$2,1,2,'mg',NULL)",
            [user, origin]
          );
          await c.query(
            "INSERT INTO medication_course_steps(user_id,revision_id,step_index,dose,dose_unit,duration_days) VALUES($1,$2,0,1,'mg',7),($1,$2,1,2,'mg',NULL)",
            [user, next]
          );
          await c.query(
            'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
            [course, next]
          );
          await c.query('COMMIT');
          return { med, course, origin, next, rule, nextRule, pen };
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const snapshot = () =>
      read((c) => loadInventoryForecastSnapshot(c, owner, now));
    const phaseCount = async (f: Fixture) =>
      read(async (c) => {
        const course = (await loadMedicationCourse(c, owner, f.course))!;
        return coursePhaseActuals({
          course,
          revision: course.revisions.find((r) => r.id === f.next)!,
          delivered: await loadCoursePhaseActuals(c, owner, f.course),
        }).length;
      });
    const takenEntry = (f: Fixture) =>
      entries.createEntry(owner, {
        medication_id: f.med,
        course_revision_id: f.origin,
        course_rule_id: f.rule,
        status: 'taken',
        entry_date: '2026-01-05',
        taken_at: '2026-01-05T08:00:00Z',
      });
    const detachedEntry = async (f: Fixture) => {
      const e = await takenEntry(f);
      return entries.updateEntry(owner, e.id, {
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
      });
    };
    const detachInjection = async (f: Fixture, deduct = false) => {
      const i = await injections.createInjection(owner, {
        medication_id: f.med,
        dose_mg: 1,
        entry_date: '2026-01-05',
        injected_at: '2026-01-05T08:00:00Z',
        course_revision_id: f.origin,
        course_rule_id: f.rule,
        ...(deduct ? { pen_id: f.pen, deduct_pen: true } : {}),
      });
      return injections.updateInjection(owner, i.id, {
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
      });
    };
    const waitForLock = async (table: string) => {
      for (let n = 0; n < 100; n++) {
        const waiting = await admin(
          async (c) =>
            (
              await c.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1 AND pid<>pg_backend_pid()) AS waiting",
                [`%${table}%`]
              )
            ).rows[0]!.waiting
        );
        if (waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Synthetic writer did not wait for expected lock');
    };
    const heldCourse = async <T>(f: Fixture, work: () => Promise<T>) => {
      const blocker = await getSystemClient();
      let request: Promise<T> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT id FROM medication_courses WHERE id=$1 FOR UPDATE',
          [f.course]
        );
        request = work();
        request.catch(() => {});
        await waitForLock('medication_courses');
        await blocker.query('COMMIT');
        return await request;
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await request?.catch(() => {});
      }
    };
    it('captures only explicitly attributed families and projects detached phase facts separately from actual history and due/stock references', async () => {
      const f = await fixture();
      const e = await detachedEntry(f);
      await entries.createEntry(owner, {
        medication_id: f.med,
        status: 'taken',
        entry_date: '2026-01-05',
      });
      expect(
        (await read((c) => loadCoursePhaseActuals(c, owner, f.course))).find(
          (row) => row.id === e.id
        )!.phase_family_id
      ).toBe(f.origin);
      expect(e).not.toHaveProperty('phase_family_id');
      expect(e.course_revision_id).toBeNull();
      expect(e.course_origin).toBe(true);
      const med = (await snapshot()).medications.find((m) => m.id === f.med)!;
      expect(med.actuals).toEqual([]);
      expect(med.phase_actuals).toHaveLength(1);
      expect(med.phase_actuals[0]).toMatchObject({
        id: e.id,
        source_kind: 'entry',
        course_revision_id: null,
        phase_family_id: f.origin,
      });
      expect(
        med.legacy_entries.find((row) => row.id === e.id)!.course_revision_id
      ).toBeNull();
      expect(await read((c) => loadCourseActuals(c, owner, f.course))).toEqual(
        []
      );
      const visible = await getMedicationCourseHistory(
        owner,
        f.course,
        '2026-01-01',
        '2026-01-31',
        now
      );
      expect(visible.actuals).toEqual([]);
      expect(visible.adherence.taken).toBe(0);
      expect(await phaseCount(f)).toBe(1);
    });
    it('retains the server-captured origin window and tombstoned origin rather than replacing them with cycle bounds', async () => {
      const f = await fixture();
      await detachedEntry(f);
      await admin(async (c) => {
        await c.query(
          'UPDATE medication_course_revisions SET deleted_at=NOW() WHERE id=$1',
          [f.origin]
        );
      });
      const course = (await read((c) =>
        loadMedicationCourse(c, owner, f.course)
      ))!;
      const context = coursePhaseContext({
        course,
        revision: course.revisions.find((r) => r.id === f.next)!,
      });
      expect(context.family_id).toBe(f.origin);
      expect(context.origin!.deleted_at).not.toBeNull();
      expect(context.window).toEqual({
        start_date: '2026-01-01',
        end_date: '2026-06-30',
      });
      expect(context.origin!.end_date).toBe('2026-01-14');
      expect(await phaseCount(f)).toBe(1);
    });
    it('updates phase counts from current status, time corrections and actual deletion without changing stock or actual mass', async () => {
      const f = await fixture();
      const e = await detachedEntry(f);
      const i = await detachInjection(f, true);
      expect(await phaseCount(f)).toBe(2);
      await entries.updateEntry(owner, e.id, { status: 'skipped' });
      expect(await phaseCount(f)).toBe(1);
      await entries.updateEntry(owner, e.id, { status: 'taken' });
      expect(await phaseCount(f)).toBe(2);
      const corrected = await injections.updateInjection(owner, i.id, {
        entry_date: '2026-02-01',
        injected_at: '2026-02-01T08:00:00Z',
      });
      expect(corrected.dose_mg_exact).toBe('1');
      expect(corrected.pen_id).toBe(f.pen);
      const course = (await read((c) =>
        loadMedicationCourse(c, owner, f.course)
      ))!;
      const revision = course.revisions.find((r) => r.id === f.next)!;
      expect(
        coursePhaseDeliveredBeforeSlot({
          course,
          revision,
          rule: revision.rules[0]!,
          day: '2026-01-20',
          at: '2026-01-20T08:00:00Z',
          key: 'synthetic-future-slot',
          delivered: await read((c) =>
            loadCoursePhaseActuals(c, owner, f.course)
          ),
        })
      ).toBe(1);
      expect(await entries.deleteEntry(owner, e.id)).toBe(true);
      expect(await phaseCount(f)).toBe(1);
      expect(await injections.deleteInjection(owner, i.id)).toBe(true);
      expect(await phaseCount(f)).toBe(0);
      expect(
        await admin(
          async (c) =>
            (
              await c.query(
                'SELECT doses_used FROM medication_pens WHERE id=$1',
                [f.pen]
              )
            ).rows[0].doses_used
        )
      ).toBe(0);
    });
    it('reassociates only through a valid explicit revision and removes the actual from the old family cursor', async () => {
      const f = await fixture(),
        g = await fixture(owner, f.med);
      const e = await detachedEntry(f);
      const moved = await entries.updateEntry(owner, e.id, {
        course_revision_id: g.next,
        course_rule_id: g.nextRule,
      });
      expect(moved).not.toHaveProperty('phase_family_id');
      expect(
        (await read((c) => loadCoursePhaseActuals(c, owner, g.course))).find(
          (row) => row.id === e.id
        )!.phase_family_id
      ).toBe(g.origin);
      expect(await phaseCount(f)).toBe(0);
      expect(await phaseCount(g)).toBe(1);
      await entries.updateEntry(owner, e.id, {
        course_revision_id: null,
        course_rule_id: null,
      });
      expect(await phaseCount(g)).toBe(1);
    });
    it('keeps owner, course and independent family boundaries and deduplicates using source kind plus actual ID', async () => {
      const f = await fixture(),
        g = await fixture(owner, f.med),
        foreign = await fixture(other);
      const shared = randomUUID();
      await admin(async (c) => {
        await c.query(
          "INSERT INTO medication_entries(id,user_id,medication_id,course_revision_id,status,entry_date,taken_at) VALUES($1,$2,$3,$4,'taken','2026-01-05','2026-01-05T08:00:00Z')",
          [shared, owner, f.med, f.origin]
        );
        await c.query(
          "INSERT INTO injection_entries(id,user_id,medication_id,course_revision_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,$4,1,'2026-01-05','2026-01-05T08:00:00Z')",
          [shared, owner, f.med, f.origin]
        );
      });
      await detachedEntry(g);
      expect(await phaseCount(f)).toBe(2);
      expect(await phaseCount(g)).toBe(1);
      expect(
        await read((c) => loadCoursePhaseActuals(c, owner, foreign.course))
      ).toEqual([]);
      expect(
        await read((c) => loadCoursePhaseActuals(c, owner, f.course), delegate)
      ).toHaveLength(2);
      await expect(
        admin(async (c) => {
          await c.query(
            'UPDATE medication_entries SET phase_family_id=$2 WHERE id=$1',
            [shared, foreign.origin]
          );
        })
      ).rejects.toThrow();
    });
    it('holds one caller-owned read-only RR snapshot while detached phase facts change concurrently', async () => {
      const f = await fixture();
      const e = await detachedEntry(f);
      const c: PoolClient = await getClient(owner);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const before = await loadInventoryForecastSnapshot(c, owner, now);
        await entries.updateEntry(owner, e.id, { status: 'skipped' });
        expect(await loadInventoryForecastSnapshot(c, owner, now)).toEqual(
          before
        );
        expect(
          (await c.query('SHOW transaction_read_only')).rows[0]
            .transaction_read_only
        ).toBe('on');
        await c.query('COMMIT');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect(await phaseCount(f)).toBe(0);
    });
    it('locks the retained family before ordinary detached status edits and deletion', async () => {
      const f = await fixture();
      const e = await detachedEntry(f);
      expect(
        (await heldCourse(f, () =>
          entries.updateEntry(owner, e.id, { status: 'skipped' })
        ))!.status
      ).toBe('skipped');
      expect(await heldCourse(f, () => entries.deleteEntry(owner, e.id))).toBe(
        true
      );
    });
    it('locks retained family after medication deletion even with null medicine and original revision IDs', async () => {
      const f = await fixture();
      const e = await detachedEntry(f);
      const i = await detachInjection(f);
      await medications.deleteMedication(owner, f.med);
      expect(await heldCourse(f, () => entries.deleteEntry(owner, e.id))).toBe(
        true
      );
      expect(
        await heldCourse(f, () => injections.deleteInjection(owner, i.id))
      ).toBe(true);
    });
    it('locks phase course before waiting for stock and restores stock only through normal injection deletion', async () => {
      const f = await fixture();
      const i = await detachInjection(f, true);
      const stockBlocker = await getSystemClient();
      const probe = await getSystemClient();
      let deletion: Promise<boolean> | undefined;
      try {
        await stockBlocker.query('BEGIN');
        await stockBlocker.query(
          'SELECT id FROM medication_pens WHERE id=$1 FOR UPDATE',
          [f.pen]
        );
        deletion = injections.deleteInjection(owner, i.id);
        deletion.catch(() => {});
        await waitForLock('medication_pens');
        await probe.query('BEGIN');
        await expect(
          probe.query(
            'SELECT id FROM medication_courses WHERE id=$1 FOR UPDATE NOWAIT',
            [f.course]
          )
        ).rejects.toMatchObject({ code: '55P03' });
        await probe.query('ROLLBACK');
        await stockBlocker.query('COMMIT');
        expect(await deletion).toBe(true);
        expect(
          await admin(
            async (c) =>
              (
                await c.query(
                  'SELECT doses_used FROM medication_pens WHERE id=$1',
                  [f.pen]
                )
              ).rows[0].doses_used
          )
        ).toBe(0);
      } finally {
        await probe.query('ROLLBACK');
        probe.release();
        await stockBlocker.query('ROLLBACK');
        stockBlocker.release();
        await deletion?.catch(() => {});
      }
    });
    it('rejects new reassociation after medicine deletion while retaining family history and allowing serialized status edits', async () => {
      const f = await fixture(),
        g = await fixture(owner, f.med);
      const e = await detachedEntry(f);
      await medications.deleteMedication(owner, f.med);
      await expect(
        entries.updateEntry(owner, e.id, {
          course_revision_id: g.next,
          course_rule_id: g.nextRule,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(await phaseCount(f)).toBe(1);
      expect(await phaseCount(g)).toBe(0);
      const preserved = await admin(
        async (c) =>
          (
            await c.query(
              'SELECT medication_id,course_revision_id,phase_family_id,status,entry_date::text FROM medication_entries WHERE id=$1',
              [e.id]
            )
          ).rows[0]
      );
      expect(preserved).toMatchObject({
        medication_id: null,
        course_revision_id: null,
        phase_family_id: f.origin,
        status: 'taken',
        entry_date: '2026-01-05',
      });
      expect(
        (await heldCourse(f, () =>
          entries.updateEntry(owner, e.id, { status: 'skipped' })
        ))!.status
      ).toBe('skipped');
      expect(await phaseCount(f)).toBe(0);
    });
  }
);
