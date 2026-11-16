import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { getMedicationInventoryDashboard } from '../services/medicationInventoryDashboardService.js';
import { updatePen } from '../models/medicationPenRepository.js';
import type { MedicationPreparationInput } from '@workspace/shared';

describe.runIf(process.env.INVENTORY_DASHBOARD_LIFECYCLE_INTEGRATION === '1')(
  'queued preparation snapshot and guarded attach PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const now = new Date('2026-11-16T12:00:00Z');
    const admin = async <T>(fn: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `dashboard-lifecycle-${id}@example.test`]
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
    const create = async () =>
      admin(async (c) => {
        const med = (
          await c.query<{ id: string }>(
            "INSERT INTO medications(user_id,name,type_id,route_id,is_glp1) VALUES($1,'Synthetic queue peptide','injection','subcutaneous',false) RETURNING id",
            [owner]
          )
        ).rows[0]!.id;
        const stock = (
          await c.query<{ id: string }>(
            "INSERT INTO medication_pens(user_id,medication_id,kind,status,doses_used,dose_mg,doses_total,expiry_date,label_mass_mg) VALUES($1,$2,'vial','sealed',0,1,10,'2020-01-01',NULL) RETURNING id",
            [owner, med]
          )
        ).rows[0]!.id;
        return { med, stock };
      });
    const token = async (stock: string) =>
      (
        await getMedicationInventoryDashboard(owner, now)
      ).preparation_queue.find((row) => row.stock_id === stock)!
        .preparation_queue_state;
    const preparation: MedicationPreparationInput = {
      mode: 'reconstituted',
      mass_value: 2,
      mass_unit: 'mg',
      final_volume_ml: 2,
      prepared_date: '2026-11-16',
    };
    const attach = (stock: string, state: string) =>
      updatePen(owner, stock, {
        kind: 'vial',
        preparation,
        status: 'in_use',
        lifecycle_intent: true,
        expected_preparation_queue_state: state,
      });
    const stockValue = (stock: string) =>
      admin(
        async (c) =>
          (
            await c.query(
              'SELECT to_jsonb(v) AS value FROM medication_pens v WHERE id=$1',
              [stock]
            )
          ).rows[0]!.value
      );
    it('GET includes exact expired nominal-count sealed vial, writes nothing and omits other owners', async () => {
      const x = await create();
      const before = await stockValue(x.stock);
      const response = await getMedicationInventoryDashboard(owner, now);
      expect(response.forecast.as_of).toBe(now.toISOString());
      expect(
        response.preparation_queue.find((row) => row.stock_id === x.stock)
      ).toMatchObject({
        medication_id: x.med,
        label_mass_mg: null,
        raw_status: 'sealed',
        expired: true,
      });
      expect(response.supply).toEqual({
        state: 'no_demand',
        medication_id: null,
      });
      expect(await stockValue(x.stock)).toEqual(before);
      expect(
        (
          await getMedicationInventoryDashboard(other, now)
        ).preparation_queue.some((row) => row.stock_id === x.stock)
      ).toBe(false);
    });
    it('attaches to the same stable ID and rejects identical stale replay before metadata/lifecycle writes', async () => {
      const x = await create(),
        state = await token(x.stock);
      await attach(x.stock, state);
      const after = await stockValue(x.stock);
      expect(
        (
          await admin((c) =>
            c.query('SELECT id FROM medication_preparations WHERE pen_id=$1', [
              x.stock,
            ])
          )
        ).rows
      ).toHaveLength(1);
      await expect(
        updatePen(owner, x.stock, {
          preparation,
          label: 'Must not be written',
          expected_preparation_queue_state: state,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await stockValue(x.stock)).toEqual(after);
      expect(
        (
          await getMedicationInventoryDashboard(owner, now)
        ).preparation_queue.some((row) => row.stock_id === x.stock)
      ).toBe(false);
    });
    it('rejects new all-time linked unknown/zero-mass history even if legacy doses_used still zero', async () => {
      const x = await create(),
        state = await token(x.stock);
      await admin((c) =>
        c.query(
          "INSERT INTO injection_entries(user_id,medication_id,pen_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,0,'2020-01-01','2020-01-01T12:00:00Z')",
          [owner, x.med, x.stock]
        )
      );
      const before = await stockValue(x.stock);
      await expect(attach(x.stock, state)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(await stockValue(x.stock)).toEqual(before);
      expect(
        (
          await admin((c) =>
            c.query('SELECT 1 FROM medication_preparations WHERE pen_id=$1', [
              x.stock,
            ])
          )
        ).rows
      ).toHaveLength(0);
    });
    it('rejects stale closed/opened/physical/route facts before any preparation or metadata write', async () => {
      for (const change of ['closed', 'opened', 'physical', 'route']) {
        const x = await create(),
          state = await token(x.stock);
        await admin((c) =>
          change === 'route'
            ? c.query("UPDATE medications SET route_id='oral' WHERE id=$1", [
                x.med,
              ])
            : change === 'closed'
              ? c.query(
                  "UPDATE medication_pens SET status='finished',finished_at=NOW() WHERE id=$1",
                  [x.stock]
                )
              : change === 'opened'
                ? c.query(
                    "UPDATE medication_pens SET opened_at='2026-11-16' WHERE id=$1",
                    [x.stock]
                  )
                : c.query(
                    'UPDATE medication_pens SET concentration_mg_ml=0 WHERE id=$1',
                    [x.stock]
                  )
        );
        const before = await stockValue(x.stock);
        await expect(attach(x.stock, state)).rejects.toMatchObject({
          statusCode: 409,
        });
        expect(await stockValue(x.stock)).toEqual(before);
      }
    });
    it('serializes simultaneous attach attempts so exactly one creates a preparation', async () => {
      const x = await create(),
        state = await token(x.stock);
      const results = await Promise.allSettled([
        attach(x.stock, state),
        attach(x.stock, state),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { statusCode: 409 },
      });
      expect(
        (
          await admin((c) =>
            c.query('SELECT id FROM medication_preparations WHERE pen_id=$1', [
              x.stock,
            ])
          )
        ).rows
      ).toHaveLength(1);
    });
    it('holds the medication route stable before the selected stock lock and through attach', async () => {
      const x = await create(),
        state = await token(x.stock);
      const stockLock = await getSystemClient(),
        probe = await getSystemClient();
      let released = false;
      let attempt: ReturnType<typeof attach> | undefined;
      try {
        await stockLock.query('BEGIN');
        await stockLock.query(
          'SELECT id FROM medication_pens WHERE id=$1 FOR UPDATE',
          [x.stock]
        );
        attempt = attach(x.stock, state);
        // Wait for the attach transaction to reach the selected stock lock after its medication lock.
        let waiting = false;
        for (let count = 0; count < 100; count++) {
          const rows = await probe.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM medication_pens WHERE id = %'"
          );
          if (rows.rows.length) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await probe.query('BEGIN');
        await expect(
          probe.query(
            'SELECT id FROM medications WHERE id=$1 FOR UPDATE NOWAIT',
            [x.med]
          )
        ).rejects.toMatchObject({ code: '55P03' });
        await probe.query('ROLLBACK');
        await stockLock.query('COMMIT');
        released = true;
        await attempt;
        expect(
          (
            await admin((c) =>
              c.query(
                'SELECT id FROM medication_preparations WHERE pen_id=$1',
                [x.stock]
              )
            )
          ).rows
        ).toHaveLength(1);
      } finally {
        if (!released) await stockLock.query('ROLLBACK');
        if (attempt) await Promise.allSettled([attempt]);
        await probe.query('ROLLBACK');
        stockLock.release();
        probe.release();
      }
    });
  }
);
