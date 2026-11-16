import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppointmentReportData } from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { getAppointmentReportData } from '../services/appointmentReportService.js';

describe.runIf(process.env.APPOINTMENT_REPORT_PARITY_INTEGRATION === '1')(
  'appointment PDF saved hydration and recorded timing PostgreSQL',
  () => {
    const owner = randomUUID();
    const now = new Date('2026-11-16T01:00:00Z');
    const query = {
      from: '2026-03-29',
      to: '2026-03-30',
      timezone: 'Europe/London',
    };
    const read = () => getAppointmentReportData(owner, query, now);
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          'INSERT INTO public."user"(id,email,name,email_verified) VALUES($1,$2,$3,true)',
          [owner, `synthetic-${owner}@example.test`, 'Synthetic PDF parity']
        );
        await c.query(
          "INSERT INTO water_intake_entries(user_id,entry_date,water_ml) VALUES($1,'2026-03-29',0),($1,'2026-03-30',1000)",
          [owner]
        );
        for (const [name, status, actual, scheduled] of [
          [
            'late',
            'taken',
            '2026-03-29T03:12:00+01:00',
            '2026-03-29T02:00:00Z',
          ],
          ['early', 'taken', '2026-03-29T09:55:00Z', '2026-03-29T10:00:00Z'],
          [
            'on time',
            'prn_taken',
            '2026-03-29T10:00:00Z',
            '2026-03-29T10:00:00Z',
          ],
          [
            'skipped',
            'skipped',
            '2026-03-29T10:12:00Z',
            '2026-03-29T10:00:00Z',
          ],
          ['unscheduled', 'taken', '2026-03-29T10:12:00Z', null],
        ])
          await c.query(
            'INSERT INTO medication_entries(user_id,entry_date,med_name_snapshot,status,taken_at,scheduled_for) VALUES($1,$2,$3,$4,$5,$6)',
            [owner, '2026-03-29', name, status, actual, scheduled]
          );
        await c.query(
          "INSERT INTO injection_entries(user_id,entry_date,injected_at,dose_mg) VALUES($1,'2026-03-29','2026-03-29T10:12:00Z',1)",
          [owner]
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=$1', [owner]);
      } finally {
        c.release();
        await endPool();
      }
    });
    it('has no invented default and keeps observed zero distinct from unlogged days', async () => {
      const data = await read();
      expect(data.wellness.hydrationTargetMl).toBeNull();
      expect(data.wellness.water).toEqual([
        { day: '2026-03-29', millilitres: 0 },
        { day: '2026-03-30', millilitres: 1000 },
      ]);
    });
    it('resolves saved current explicit, active weekday preset and carried goals at generation day, not report dates', async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          "INSERT INTO user_goals(user_id,goal_date,water_goal_ml) VALUES($1,'2026-01-01',1500)",
          [owner]
        );
        expect((await read()).wellness.hydrationTargetMl).toBe(1500);
        const preset = (
          await c.query(
            "INSERT INTO goal_presets(user_id,preset_name,water_goal) VALUES($1,'Synthetic Monday',2000) RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await c.query(
          "INSERT INTO weekly_goal_plans(user_id,plan_name,start_date,is_active,monday_preset_id) VALUES($1,'Synthetic weekly','2026-11-01',true,$2)",
          [owner, preset]
        );
        expect((await read()).wellness.hydrationTargetMl).toBe(2000);
        await c.query(
          "INSERT INTO user_goals(user_id,goal_date,water_goal_ml) VALUES($1,'2026-11-16',2500)",
          [owner]
        );
        expect((await read()).wellness.hydrationTargetMl).toBe(2500);
        await c.query(
          "UPDATE user_goals SET water_goal_ml=0 WHERE user_id=$1 AND goal_date='2026-11-16'",
          [owner]
        );
        expect((await read()).wellness.hydrationTargetMl).toBeNull();
        await c.query(
          "UPDATE user_goals SET water_goal_ml=2500 WHERE user_id=$1 AND goal_date='2026-11-16'",
          [owner]
        );
      } finally {
        c.release();
      }
    });
    it('uses signed stored instants across DST and never calculates skipped or unscheduled injection timing', async () => {
      const data = await read();
      const named = new Map(data.doseLog.map((d) => [d.name, d]));
      expect(named.get('late')?.timingDeltaMinutes).toBe(12);
      expect(named.get('early')?.timingDeltaMinutes).toBe(-5);
      expect(named.get('on time')?.timingDeltaMinutes).toBe(0);
      expect(named.get('skipped')?.timingDeltaMinutes).toBeNull();
      expect(named.get('unscheduled')?.timingDeltaMinutes).toBeNull();
      expect(
        data.doseLog.find((d) => d.sourceKind === 'injection')
      ).toMatchObject({ scheduledFor: null, timingDeltaMinutes: null });
    });
    it('keeps saved target and dose timing coherent in the read-only export snapshot', async () => {
      const c = await getSystemClient();
      let pending: Promise<AppointmentReportData> | undefined;
      try {
        await c.query('BEGIN');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid;
        await c.query('LOCK TABLE medication_entries IN ACCESS EXCLUSIVE MODE');
        await c.query(
          "UPDATE user_goals SET water_goal_ml=3000 WHERE user_id=$1 AND goal_date='2026-11-16'",
          [owner]
        );
        await c.query(
          "UPDATE medication_entries SET taken_at=scheduled_for+interval '20 minutes' WHERE user_id=$1 AND med_name_snapshot='late'",
          [owner]
        );
        pending = read();
        let blocked = false;
        for (let n = 0; n < 100; n++) {
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
        const data = await pending;
        expect(data.wellness.hydrationTargetMl).toBe(2500);
        expect(
          data.doseLog.find((d) => d.name === 'late')?.timingDeltaMinutes
        ).toBe(12);
        const fresh = await read();
        expect(fresh.wellness.hydrationTargetMl).toBe(3000);
        expect(
          fresh.doseLog.find((d) => d.name === 'late')?.timingDeltaMinutes
        ).toBe(20);
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (pending) await pending.catch(() => {});
      }
    });
  }
);
