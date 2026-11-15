import express from 'express';
// @ts-expect-error no declarations installed.
import cookieParser from 'cookie-parser';
// @ts-expect-error no declarations installed.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppointmentReportData } from '@workspace/shared';
import {
  getSystemClient,
  dbContextStorage,
  endPool,
} from '../db/poolManager.js';
import { getAppointmentReportData } from '../services/appointmentReportService.js';
import reportRepository from '../models/reportRepository.js';
const renderer = vi.hoisted(() =>
  vi.fn(async (_data: AppointmentReportData) =>
    Buffer.from('%PDF-1.7\nsynthetic test')
  )
);
vi.mock('../services/appointmentReportPdf.js', () => ({
  renderAppointmentReportPdf: renderer,
}));
describe.runIf(process.env.APPOINTMENT_REPORT_INTEGRATION === '1')(
  'appointment report real owner/auth snapshot PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    let med: string,
      app: express.Express,
      full: string,
      read: string,
      foreign: string;
    const range = {
      from: '2026-03-29',
      to: '2026-03-29',
      timezone: 'Europe/London',
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,name,email_verified) VALUES($1,$2,$3,true)',
            [id, `synthetic-${id}@example.test`, 'Synthetic export owner']
          );
        await c.query(
          "INSERT INTO profiles(id,full_name) VALUES($1,'Synthetic profile')",
          [owner]
        );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Europe/London') ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone",
          [owner]
        );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id,dose_amount,dose_unit) VALUES($1,'Current synthetic','injection',1,'tablet') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await c.query(
          "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,status) SELECT $1,$2,'2026-03-29',TIMESTAMPTZ '2026-03-29 22:00:00+00','Recorded synthetic',2,'tablet',CASE WHEN n=1 THEN 'skipped' ELSE 'taken' END FROM generate_series(1,25)n",
          [owner, med]
        );
        for (const day of ['2026-03-28', '2026-03-30'])
          await c.query(
            "INSERT INTO medication_entries(user_id,medication_id,entry_date,med_name_snapshot,status) VALUES($1,$2,$3,'Outside range','taken')",
            [owner, med, day]
          );
        await c.query(
          "INSERT INTO injection_entries(user_id,medication_id,entry_date,injected_at,dose_mg,volume_ml,dose_input_unit,administration_route) VALUES($1,$2,'2026-03-29','2026-03-29 23:30:00+00',0,NULL,NULL,NULL),($1,$2,'2026-03-29','2026-03-29 00:30:00+00',0,0,'ml','injection')",
          [owner, med]
        );
        await c.query(
          "INSERT INTO medication_entries(user_id,entry_date,med_name_snapshot,status) VALUES($1,'2026-03-29','Foreign synthetic','taken')",
          [other]
        );
        const meal = (
          await c.query(
            "INSERT INTO meal_types(user_id,name) VALUES($1,'Synthetic export meal') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await c.query(
          "INSERT INTO food_entries(user_id,meal_type_id,entry_date,quantity,serving_size,food_name,calories,protein) VALUES($1,$2,'2026-03-29',1,1,'Synthetic unknown',0,NULL),($1,$2,'2026-03-29',1,1,'Synthetic known',0,2),($1,$2,'2026-03-28',1,1,'Synthetic zero',0,0)",
          [owner, meal]
        );
        await c.query(
          "INSERT INTO water_intake_entries(user_id,entry_date,water_ml) VALUES($1,'2026-03-29',0)",
          [owner]
        );
        await c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status) VALUES($1,$2,$3,$4::jsonb,true,'active')",
          [
            owner,
            other,
            `synthetic-${other}@example.test`,
            JSON.stringify({
              can_view_reports: true,
              can_manage_medications: true,
              can_view_checkin: true,
            }),
          ]
        );
        for (const date of [
          '2019-01-01',
          '2020-01-01',
          '2021-01-01',
          '2022-01-01',
        ]) {
          const panel = (
            await c.query(
              "INSERT INTO lab_reports(user_id,collected_on,lab_name,origin) VALUES($1,$2,'Synthetic explicit','manual') RETURNING id",
              [owner, date]
            )
          ).rows[0].id;
          await c.query(
            "INSERT INTO lab_results(user_id,report_id,marker_key,entry_date,value_numeric,value_text,unit,ref_range_low,ref_range_high,source) VALUES($1,$2,'crp',$3,3,'<3','mg/L',1,2,'manual'),($1,$2,'hs_crp',$3,0,NULL,'mg/dL',1,2,'manual')",
            [owner, panel, date]
          );
        }
        await c.query(
          "INSERT INTO lab_results(user_id,marker_key,entry_date,value_numeric,unit,source) VALUES($1,'crp','2026-03-29',99,'mg/L','manual')",
          [owner]
        );
      } finally {
        c.release();
      }
      const { auth } = await import('../auth.js');
      const key = async (userId: string, write: boolean) => {
        // @ts-expect-error configured plugin endpoint not in auth.api inference.
        const v = (await auth.api.createApiKey({
          body: {
            userId,
            name: 'Synthetic appointment key',
            permissions: { sparky: write ? ['read', 'write'] : ['read'] },
            expiresIn: 31536000,
          },
        })) as { key: string };
        return v.key;
      };
      full = await key(owner, true);
      read = await key(owner, false);
      foreign = await key(other, true);
      const { default: router } =
        await import('../routes/v2/appointmentReportRoutes.js');
      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/v2/reports', router);
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });
    it('allows full and read-only owner keys with private PDF headers and rejects delegated/foreign/unauthenticated requests', async () => {
      for (const key of [full, read]) {
        const r = await request(app)
          .get('/api/v2/reports/appointment.pdf')
          .set('x-api-key', key)
          .query({ ...range, expected_owner_id: owner });
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toContain('application/pdf');
        expect(r.headers['cache-control']).toBe('no-store');
      }
      for (const headers of [
        { 'x-api-key': foreign, Cookie: `sparky_active_user_id=${owner}` },
        { 'x-api-key': foreign, 'x-on-behalf-of-user-id': owner },
      ])
        expect(
          (
            await request(app)
              .get('/api/v2/reports/appointment.pdf')
              .set(headers)
              .query(range)
          ).status
        ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v2/reports/appointment.pdf')
            .set('x-api-key', full)
            .query({ ...range, expected_owner_id: other })
        ).status
      ).toBe(403);
      expect(
        (await request(app).get('/api/v2/reports/appointment.pdf')).status
      ).toBe(401);
    });
    it('returns all selected tracking-day facts once without foreign rows, preserving zero/unknown and latest explicit panel membership', async () => {
      const r = await request(app)
        .get('/api/v2/reports/appointment.pdf')
        .set('x-api-key', read)
        .query(range);
      expect(r.status).toBe(200);
      const data = renderer.mock.calls.at(-1)![0];
      expect(data.doseLog).toHaveLength(27);
      expect(
        data.doseLog.filter((d) => d.sourceKind === 'medication_entry')
      ).toHaveLength(25);
      expect(data.doseLog.filter((d) => !d.administered)).toHaveLength(1);
      expect(
        data.doseLog
          .filter((d) => d.sourceKind === 'injection')
          .map((d) => d.deliveredMassMg)
          .sort()
      ).toEqual(['0', null]);
      expect(data.doseLog.every((d) => d.trackingDay === '2026-03-29')).toBe(
        true
      );
      expect(data.wellness.nutrition).toEqual([
        { day: '2026-03-29', calories: 0, proteinGrams: null },
      ]);
      expect(data.wellness.water).toEqual([
        { day: '2026-03-29', millilitres: 0 },
      ]);
      expect(data.labPanels.map((p) => p.collectedOn)).toEqual([
        '2022-01-01',
        '2021-01-01',
        '2020-01-01',
      ]);
      expect(data.labPanels.flatMap((p) => p.results)).toHaveLength(6);
      expect(data.labPanels[0]?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            markerId: 'builtin:crp',
            valueText: '<3',
            unit: 'mg/L',
            rangeFlag: 'unknown',
          }),
          expect.objectContaining({
            markerId: 'builtin:hs_crp',
            valueNumeric: 0,
            unit: 'mg/dL',
            rangeFlag: 'low',
          }),
        ])
      );
    });
    it('keeps existing nutrition callers zero-coalesced while appointment fully-known days retain explicit zeros', async () => {
      const old: { date: string; protein: number | null }[] =
        await reportRepository.getNutritionData(
          owner,
          '2026-03-28',
          '2026-03-29'
        );
      expect(old.find((r) => r.date === '2026-03-29')?.protein).toBe(2);
      const data = await getAppointmentReportData(
        owner,
        { from: '2026-03-28', to: '2026-03-29' },
        new Date('2026-03-29T23:30:00Z')
      );
      expect(data.wellness.nutrition).toEqual([
        { day: '2026-03-28', calories: 0, proteinGrams: 0 },
        { day: '2026-03-29', calories: 0, proteinGrams: null },
      ]);
    });
    it('rejects impossible/reversed dates and invalid zones without rendering', async () => {
      const count = renderer.mock.calls.length;
      for (const query of [
        { from: '2026-02-30' },
        { from: '2026-03-30', to: '2026-03-29' },
        { timezone: 'Invalid/zone' },
      ])
        expect(
          (
            await request(app)
              .get('/api/v2/reports/appointment.pdf')
              .set('x-api-key', read)
              .query(query)
          ).status
        ).toBe(400);
      expect(renderer).toHaveBeenCalledTimes(count);
    });
    it('uses one repeatable-read snapshot across later component replacement and leaves the records untouched', async () => {
      const c = await getSystemClient();
      let pending: Promise<AppointmentReportData> | undefined;
      try {
        const before = (
          await c.query(
            "SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY id)) AS hash FROM medication_entries x WHERE user_id=$1",
            [owner]
          )
        ).rows[0].hash;
        await c.query('BEGIN');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid;
        await c.query('LOCK TABLE injection_entries IN ACCESS EXCLUSIVE MODE');
        await c.query(
          "UPDATE medications SET name='Replaced current name' WHERE id=$1",
          [med]
        );
        await c.query(
          'UPDATE injection_entries SET dose_mg=2 WHERE user_id=$1',
          [owner]
        );
        pending = getAppointmentReportData(owner, range);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (
            (
              await c.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
                [pid]
              )
            ).rows[0].blocked
          ) {
            blocked = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(blocked).toBe(true);
        await c.query('COMMIT');
        const coherent = await pending;
        expect(coherent.currentMedications[0]?.name).toBe('Current synthetic');
        expect(
          coherent.doseLog
            .filter((d) => d.sourceKind === 'injection')
            .some((d) => d.deliveredMassMg === '2')
        ).toBe(false);
        const fresh = await getAppointmentReportData(owner, range);
        expect(fresh.currentMedications[0]?.name).toBe('Replaced current name');
        expect(
          fresh.doseLog
            .filter((d) => d.sourceKind === 'injection')
            .every((d) => d.deliveredMassMg === '2')
        ).toBe(true);
        expect(
          (
            await c.query(
              "SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY id)) AS hash FROM medication_entries x WHERE user_id=$1",
              [owner]
            )
          ).rows[0].hash
        ).toBe(before);
        await expect(
          dbContextStorage.run({ authenticatedUserId: other }, () =>
            getAppointmentReportData(owner, range)
          )
        ).rejects.toMatchObject({ statusCode: 403 });
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (pending) await pending.catch(() => {});
      }
    });
  }
);
