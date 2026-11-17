import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { medicationInventoryForecastResponseSchema } from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { getMedicationInventoryForecast } from '../services/medicationInventoryForecastService.js';
import { getMedicationInventoryDashboard } from '../services/medicationInventoryDashboardService.js';

describe.runIf(process.env.INVENTORY_FORECAST_MODES_INTEGRATION === '1')(
  'opt-in forecast modes from one read-only inventory snapshot PostgreSQL',
  () => {
    const owner = randomUUID(),
      med = randomUUID(),
      course = randomUUID(),
      revision = randomUUID(),
      device = randomUUID(),
      prepared = randomUUID(),
      queued = randomUUID();
    const now = new Date('2026-11-16T12:00:00Z');
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
      await admin(async (c) => {
        await c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [owner, `synthetic-forecast-mode-${owner}@example.test`]
        );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'UTC',14,3)",
          [owner]
        );
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,$2,'Synthetic planned-cycle peptide','injection','subcutaneous',1,'mg',false)",
          [med, owner]
        );
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic plan','2026-11-01','UTC','2026-11-01T00:00:00Z')",
          [course, owner, med]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,start_date,end_date,target_dose,dose_unit,dose_basis,course_cycle_on_weeks,course_cycle_off_weeks,course_cycle_anchor_date,phase_origin_context) VALUES($1,$2,$3,1,'Synthetic current plan','2026-11-01','2026-11-07',1,'mg','per_injection',1,1,'2026-11-01','{\"start_date\":\"2026-11-01\",\"end_date\":\"2026-11-07\"}'::jsonb)",
          [revision, owner, course]
        );
        await c.query(
          "INSERT INTO medication_course_rules(user_id,revision_id,rule_index,schedule_type_id,time_of_day) VALUES($1,$2,0,'daily','08:00')",
          [owner, revision]
        );
        await c.query(
          "INSERT INTO medication_course_activity(user_id,revision_id,from_at) VALUES($1,$2,'2026-11-01T00:00:00Z')",
          [owner, revision]
        );
        await c.query(
          'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
          [course, revision]
        );
        await c.query(
          "INSERT INTO medication_syringes(id,user_id,name,device_type,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES($1,$2,'Synthetic syringe','syringe','units',100,1,100,1)",
          [device, owner]
        );
        await c.query(
          'INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2)',
          [owner, device]
        );
        await c.query(
          "INSERT INTO medication_pens(id,user_id,medication_id,kind,status,doses_used,concentration_mg_ml,volume_ml,bud_date,bud_mode,created_at) VALUES($1,$2,$3,'vial','in_use',0,10,0.2,'2028-01-01','date','2026-11-01T00:00:00Z')",
          [prepared, owner, med]
        );
        await c.query(
          "INSERT INTO medication_pens(id,user_id,medication_id,kind,status,doses_used,dose_mg,doses_total) VALUES($1,$2,$3,'vial','sealed',0,1,10)",
          [queued, owner, med]
        );
      });
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [owner])
      );
      await endPool();
    });
    const facts = () =>
      admin(async (c) => {
        const result: Record<string, unknown> = {};
        for (const table of [
          'user_preferences',
          'medications',
          'medication_pens',
          'medication_preparations',
          'medication_course_revisions',
          'medication_course_rules',
          'medication_course_steps',
          'medication_course_activity',
          'medication_courses',
          'medication_entries',
          'injection_entries',
          'medication_course_operations',
          'medication_preparation_corrections',
        ])
          result[table] = (
            await c.query(
              `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE user_id=$1`,
              [owner]
            )
          ).rows[0]!.rows;
        return result;
      });
    it('echoes only planned reads, keeps default shape, and leaves Supply/queue/raw facts coherent and unchanged', async () => {
      const before = await facts();
      const committed = await getMedicationInventoryDashboard(owner, now);
      const planned = await getMedicationInventoryDashboard(
        owner,
        now,
        'planned_cycles'
      );
      expect(JSON.stringify(committed.forecast)).not.toMatch(
        /forecast_mode|cycle_assumptions|"projection"/
      );
      expect(planned.forecast.forecast_mode).toBe('planned_cycles');
      expect(
        planned.forecast.medications[0]!.cycle_assumptions[0]
      ).toMatchObject({
        course_id: course,
        revision_id: revision,
        manual_restart_required: true,
      });
      expect(
        planned.forecast.medications[0]!.projection.provisional_slots
      ).toBeGreaterThan(0);
      expect(
        planned.forecast.medications[0]!.prepared_only.projection
          .provisional_slots
      ).toBeGreaterThan(0);
      expect(JSON.stringify(planned.preparation_queue)).toBe(
        JSON.stringify(committed.preparation_queue)
      );
      expect(planned.preparation_queue.map((row) => row.stock_id)).toEqual([
        queued,
      ]);
      if (planned.supply.medication_id !== null)
        expect(
          planned.forecast.medications.some(
            (row) => row.medication_id === planned.supply.medication_id
          )
        ).toBe(true);
      expect(await facts()).toEqual(before);
    });
    it('echoes planned mode without provisional dates for an ineligible tip and never changes committed output', async () => {
      await admin((c) =>
        c.query(
          "UPDATE medication_course_revisions SET status='paused' WHERE id=$1",
          [revision]
        )
      );
      const before = await facts();
      const omitted = await getMedicationInventoryForecast(owner, now),
        explicit = await getMedicationInventoryForecast(
          owner,
          now,
          'committed'
        ),
        planned = await getMedicationInventoryForecast(
          owner,
          now,
          'planned_cycles'
        );
      expect(JSON.stringify(omitted)).toBe(JSON.stringify(explicit));
      expect(planned.forecast_mode).toBe('planned_cycles');
      expect(planned.medications[0]!.cycle_assumptions).toEqual([]);
      expect(planned.medications[0]!.projection).toMatchObject({
        provisional_slots: 0,
        projection_starts_on: null,
      });
      expect(medicationInventoryForecastResponseSchema.parse(planned)).toEqual(
        omitted
      );
      expect(await facts()).toEqual(before);
    });
  }
);
