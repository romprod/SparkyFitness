import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import { getMedicationCourseCosts } from '../models/medicationCourseCostsRepository.js';

describe.runIf(process.env.COURSE_COSTS_INTEGRATION === '1')(
  'owner course-cost report PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      med = randomUUID(),
      course = randomUUID(),
      revision = randomUUID(),
      device = randomUUID(),
      purchase = randomUUID(),
      line = randomUUID(),
      vial = randomUUID();
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
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `synthetic-course-costs-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'UTC',14,3)",
          [owner]
        );
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,$2,'Synthetic course-cost peptide','injection','subcutaneous',1,'mg',false)",
          [med, owner]
        );
        await c.query(
          "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic plan','2026-11-01','UTC','2026-11-01T00:00:00Z')",
          [course, owner, med]
        );
        await c.query(
          "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,start_date,end_date,target_dose,dose_unit,dose_basis) VALUES($1,$2,$3,1,'Synthetic costed course','2026-11-01','2026-11-30',1,'mg','per_injection')",
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
          "INSERT INTO medication_pens(id,user_id,medication_id,kind,status,doses_used,label_mass_mg) VALUES($1,$2,$3,'vial','in_use',0,10)",
          [vial, owner, med]
        );
        await c.query(
          "INSERT INTO medication_purchases(id,user_id,ordered_date,currency,allocation_method) VALUES($1,$2,'2026-11-01','GBP','value')",
          [purchase, owner]
        );
        await c.query(
          "INSERT INTO medication_purchase_items(id,user_id,purchase_id,kind,medication_id,description,quantity,unit_cost,sort_index) VALUES($1,$2,$3,'medication',$4,'Synthetic vial',1,100,0)",
          [line, owner, purchase, med]
        );
        await c.query(
          'INSERT INTO medication_purchase_vials(pen_id,user_id,purchase_item_id) VALUES($1,$2,$3)',
          [vial, owner, line]
        );
        // Two doses logged under the course, one unattributed.
        for (const [mg, rev, day] of [
          ['1', revision, '2026-11-05'],
          ['2', revision, '2026-11-06'],
          ['4', null, '2026-11-07'],
        ] as const)
          await c.query(
            'INSERT INTO injection_entries(user_id,medication_id,pen_id,entry_date,dose_mg,injected_at,course_revision_id) VALUES($1,$2,$3,$4::date,$5,($4::date)::timestamptz,$6)',
            [owner, med, vial, day, mg, rev]
          );
      });
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });
    it('prices actual doses per course and keeps unattributed doses apart', async () => {
      const report = await getMedicationCourseCosts(owner, now);
      const row = report.rows.find((r) => r.course_id === course)!;
      expect(row.name).toBe('Synthetic costed course');
      expect(row.actual).toMatchObject({
        cost: '30.00',
        currency: 'GBP',
        costed_doses: 2,
        uncosted_doses: 0,
        delivered_mg: '3',
        cost_per_mg: '10',
      });
      expect(report.unattributed).toMatchObject({
        cost: '40.00',
        costed_doses: 1,
      });
    });
    it('is owner-only and leaves other accounts empty', async () => {
      const report = await getMedicationCourseCosts(other, now);
      expect(report.rows).toEqual([]);
      expect(report.unattributed.costed_doses).toBe(0);
    });
  }
);
