import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  buildMedicationLogWeek,
  courseSlotsForDay,
  medicationLogWeekResponseSchema,
} from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import { loadMedicationCalendarSnapshot } from '../models/medicationCalendarRepository.js';
import { getMedicationCalendarWeek } from '../services/medicationCalendarService.js';
import injectionRepository from '../models/injectionRepository.js';

describe.runIf(process.env.MEDICATION_CALENDAR_INTEGRATION === '1')(
  'A02 coherent synthetic week PostgreSQL',
  () => {
    const owner = randomUUID(),
      reader = randomUUID(),
      foreign = randomUUID(),
      med = randomUUID(),
      course = randomUUID(),
      revision = randomUUID(),
      rule = randomUUID(),
      sameId = randomUUID(),
      crossId = randomUUID();
    const now = new Date('2026-11-18T12:00:00Z');
    const admin = async <T>(work: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await work(c);
      } finally {
        c.release();
      }
    };
    const read = async (actor = owner) => {
      const c = await getClient(owner, actor);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const snapshot = await loadMedicationCalendarSnapshot(
          c,
          owner,
          now,
          '2026-11-16'
        );
        const result = medicationLogWeekResponseSchema.parse(
          buildMedicationLogWeek(snapshot)
        );
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
        for (const id of [owner, reader, foreign])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `synthetic-calendar-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_view_reports\":true}'::jsonb,$3,'active')",
          [owner, reader, `synthetic-${reader}@example.test`]
        );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Europe/London')",
          [owner]
        );
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,is_active,dose_amount,dose_unit) VALUES($1,$2,'Synthetic current name','injection',true,999,'mg')",
          [med, owner]
        );
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,captured_at,timezone) VALUES($1,$2,$3,'Synthetic original','2026-11-17','2026-11-17T00:00Z','Europe/London')",
          [course, owner, med]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,status,start_date,target_dose,dose_unit,dose_basis) VALUES($1,$2,$3,1,'Synthetic plan','active','2026-11-16',1,'mg','per_injection')",
          [revision, owner, course]
        );
        await c.query(
          "INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,$3,0,'daily','08:00')",
          [rule, owner, revision]
        );
        await c.query(
          "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-11-16T00:00Z')",
          [owner, revision]
        );
        await c.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [course, revision]
        );
        await c.query(
          "INSERT INTO medication_entries(id,user_id,medication_id,entry_date,taken_at,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot) VALUES($1,$2,$3,'2026-11-18','2026-11-18T07:00Z','Synthetic saved ordinary',250,'mcg')",
          [sameId, owner, med]
        );
        await c.query(
          "INSERT INTO injection_entries(id,user_id,medication_id,entry_date,injected_at,dose_mg,medication_name_snapshot) VALUES($1,$2,NULL,'2026-11-18','2026-11-18T09:00Z',0.125,'Synthetic orphan injection')",
          [sameId, owner]
        );
      });
      const c = await getClient(owner);
      try {
        const snapshot = await loadMedicationCalendarSnapshot(
          c,
          owner,
          now,
          '2026-11-16'
        );
        const slot = courseSlotsForDay({
          course: snapshot.courses[0]!,
          day: '2026-11-17',
          today: snapshot.today,
          nowInstant: now.toISOString(),
          medicationActive: true,
        })[0]!;
        await admin((c) =>
          c.query(
            "INSERT INTO medication_entries(id,user_id,medication_id,entry_date,taken_at,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id,course_rule_id,course_slot_key,scheduled_day,scheduled_for) VALUES($1,$2,$3,'2026-11-23','2026-11-23T09:00Z','Synthetic cross-week',1,'mg',$4,$5,$6,'2026-11-17',$7)",
            [
              crossId,
              owner,
              med,
              revision,
              rule,
              slot.course_slot_key,
              slot.scheduled_for,
            ]
          )
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, reader, foreign],
        ])
      );
      await endPool();
    });
    it('returns kind-prefixed same-ID actuals once on stored days, exact saved dose and orphan identity', async () => {
      const result = await getMedicationCalendarWeek(owner, '2026-11-16', now);
      expect(result.actuals.filter((a) => a.id === sameId)).toHaveLength(2);
      expect(new Set(result.actuals.map((a) => a.key)).size).toBe(
        result.actuals.length
      );
      expect(
        result.actuals.find((a) => a.key === 'entry:' + sameId)
      ).toMatchObject({
        dose_amount: '250',
        dose_unit: 'mcg',
        medication_name: 'Synthetic saved ordinary',
        occurred_at: '2026-11-18T07:00:00.000Z',
      });
      expect(
        result.actuals.find((a) => a.key === 'injection:' + sameId)
      ).toMatchObject({
        medication_id: null,
        medication_name: 'Synthetic orphan injection',
      });
    });
    it('includes only exact cross-week fulfilment reference without moving the actual into the visible week', async () => {
      const result = await read();
      expect(result.actuals.some((a) => a.id === crossId)).toBe(false);
      expect(
        result.fulfilled_slots.find((f) => f.actual.id === crossId)?.actual
          .entry_date
      ).toBe('2026-11-23');
      expect(
        result.planned_slots.find((p) => p.scheduled_day === '2026-11-17')
          ?.status
      ).toBe('taken');
    });
    it('does not invent pre-capture misses or mutable legacy historical expectations', async () => {
      await admin((c) =>
        c.query(
          "INSERT INTO medication_schedules(user_id,medication_id,schedule_type_id,time_of_day,start_date,active) VALUES($1,$2,'daily','10:00','2026-01-01',true)",
          [owner, med]
        )
      );
      const result = await read();
      expect(
        result.planned_slots.some(
          (p) => p.plan_kind === 'managed' && p.scheduled_day < '2026-11-17'
        )
      ).toBe(false);
      expect(
        result.planned_slots.some(
          (p) => p.plan_kind === 'legacy' && p.scheduled_day < '2026-11-18'
        )
      ).toBe(false);
      expect(
        result.coverage.some(
          (c) => c.day === '2026-11-16' && c.coverage === 'unavailable'
        )
      ).toBe(true);
    });
    it('allows existing reports reader facts but foreign actor receives no owner rows', async () => {
      expect(await read(reader)).toEqual(await read());
      const c = await getClient(owner, foreign);
      try {
        const snapshot = await loadMedicationCalendarSnapshot(
          c,
          owner,
          now,
          '2026-11-16'
        );
        expect(snapshot.medications).toHaveLength(0);
        expect(snapshot.courses).toHaveLength(0);
        expect(snapshot.actuals).toHaveLength(0);
      } finally {
        c.release();
      }
    });
    it('keeps all cross-table reads coherent under concurrent changes and GET performs no writes', async () => {
      const c = await getClient(owner);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const before = await loadMedicationCalendarSnapshot(
          c,
          owner,
          now,
          '2026-11-16'
        );
        await admin((c) =>
          c.query(
            'UPDATE medication_entries SET dose_amount_snapshot=251 WHERE id=$1 AND user_id=$2',
            [sameId, owner]
          )
        );
        const during = await loadMedicationCalendarSnapshot(
          c,
          owner,
          now,
          '2026-11-16'
        );
        expect(during).toEqual(before);
        await expect(
          c.query('UPDATE medications SET name=name WHERE user_id=$1', [owner])
        ).rejects.toThrow();
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
      const snapshot = await read();
      expect(
        snapshot.actuals.find((a) => a.key === 'entry:' + sameId)?.dose_amount
      ).toBe('251');
    });
    it('exact injection read is same owner and ID, preserves orphan correction facts and returns null for foreign', async () => {
      expect(
        await injectionRepository.getInjection(owner, sameId)
      ).toMatchObject({
        id: sameId,
        medication_id: null,
        dose_mg_exact: '0.125',
        medication_name_snapshot: 'Synthetic orphan injection',
      });
      expect(
        await injectionRepository.getInjection(foreign, sameId)
      ).toBeNull();
    });
  }
);
