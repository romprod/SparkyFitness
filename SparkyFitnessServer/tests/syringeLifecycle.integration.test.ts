import type { MedicationPen, InjectionEntry } from '@workspace/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import * as devices from '../models/medicationSyringeRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';

describe.runIf(process.env.SYRINGE_INTEGRATION === '1')(
  'syringe and explicit stock lifecycle PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    let med: string;
    const syringe = {
      name: 'Synthetic syringe',
      graduation_type: 'units' as const,
      units_per_ml: 100,
      capacity_ml: '1',
      capacity_units: 100,
      increment: '1',
    };
    const prep = {
      mode: 'reconstituted' as const,
      mass_value: 3,
      mass_unit: 'mg' as const,
      final_volume_ml: 3,
      prepared_date: '2026-11-15',
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `syringe-${id}@example.test`]
          );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic syringe fixture','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
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
    it('scopes reusable devices/default and preserves snapshots when used device deleted', async () => {
      const device = await devices.saveSyringe(owner, syringe);
      await devices.setDefaultSyringe(owner, device.id);
      expect((await devices.listSyringes(owner)).default_syringe_id).toBe(
        device.id
      );
      expect(
        (await devices.listSyringes(other)).syringes.some(
          (s) => s.id === device.id
        )
      ).toBe(false);
      await expect(devices.setDefaultSyringe(other, device.id)).rejects.toThrow(
        'Syringe not found'
      );
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const input = {
        syringe_id: device.id,
        dose: { value: '0.001', unit: 'mg' as const },
      };
      const preview = await devices.previewDraw(owner, vial.id, input);
      expect(preview.deliveredMassMcg).toBe('0');
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: input,
      });
      expect(logged.dose_mg).toBe(0);
      expect(logged.volume_ml).toBe('0');
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )?.stock
      ).toMatchObject({ remainingMg: 3 });
      await devices.deleteSyringe(owner, device.id);
      expect((await devices.listSyringes(owner)).default_syringe_id).toBeNull();
      const row = (
        await injections.listInjections(owner, { medicationId: med })
      ).find((i: InjectionEntry) => i.id === logged.id);
      expect(row.syringe_id).toBeNull();
      expect(row.volume_ml).toBe('0');
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )?.stock
      ).not.toBeNull();
    });
    it('server recomputes and blocks exact source hard constraints', async () => {
      const device = await devices.saveSyringe(owner, {
        ...syringe,
        capacity_ml: '0.1',
      });
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      await expect(
        injections.createInjection(owner, {
          medication_id: med,
          pen_id: vial.id,
          deduct_pen: true,
          calculated_draw: {
            syringe_id: device.id,
            dose: { value: '0.101', unit: 'ml' },
          },
        })
      ).rejects.toThrow('holds');
      await expect(
        devices.previewDraw(other, vial.id, {
          syringe_id: device.id,
          dose: { value: '1', unit: 'mg' },
        })
      ).rejects.toThrow('Vial not found');
    });
    it('retires explicitly, preserves amounts/history and reopens only with intent', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const retired = await stock.updatePen(owner, vial.id, {
        status: 'discarded',
        lifecycle_intent: true,
      });
      expect(retired.finished_at).not.toBeNull();
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )
      ).toMatchObject({ status: 'discarded', stock: { remainingMg: 3 } });
      await expect(
        stock.updatePen(owner, vial.id, { status: 'in_use' })
      ).rejects.toThrow('explicit lifecycle');
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        dose_mg: 1,
      });
      expect(logged.pen.status).toBe('discarded');
      await injections.deleteInjection(owner, logged.id);
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )?.status
      ).toBe('discarded');
      const reopened = await stock.updatePen(owner, vial.id, {
        status: 'in_use',
        lifecycle_intent: true,
      });
      expect(reopened.finished_at).toBeNull();
      const c = await getSystemClient();
      try {
        expect(
          (
            await c.query(
              'SELECT count(*)::int AS count FROM medication_stock_status_audit WHERE pen_id=$1',
              [vial.id]
            )
          ).rows[0].count
        ).toBe(2);
        await expect(
          c.query(
            "INSERT INTO medication_stock_status_audit(user_id,pen_id,old_status,new_status) VALUES($1,$2,'in_use','finished')",
            [other, vial.id]
          )
        ).rejects.toThrow();
      } finally {
        c.release();
      }
    });
    it('credits the old calculated draw for preview and amount correction', async () => {
      const device = await devices.saveSyringe(owner, syringe);
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: { ...prep, mass_value: 1, final_volume_ml: 1 },
      });
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: {
          syringe_id: device.id,
          dose: { value: '0.8', unit: 'mg' },
        },
      });
      const preview = await devices.previewDraw(owner, vial.id, {
        syringe_id: device.id,
        dose: { value: '0.9', unit: 'mg' },
        editing_injection_id: logged.id,
      });
      expect(preview.warnings.some((w) => w.severity === 'block')).toBe(false);
      const amended = await injections.updateInjection(owner, logged.id, {
        dose_mg: 0.9,
      });
      expect(amended.dose_mg).toBe(0.9);
      expect(amended.volume_ml).toBe('0.9');
      expect(amended.dose_input_unit).toBe('mg');
      await devices.deleteSyringe(owner, device.id);
      await expect(
        injections.updateInjection(owner, logged.id, { dose_mg: 0.7 })
      ).rejects.toThrow('Original syringe is missing');
      const metadata = await injections.updateInjection(owner, logged.id, {
        dose_mg: 0.9,
        notes: 'Synthetic metadata correction',
      });
      expect(metadata.volume_ml).toBe('0.9');
      expect(metadata.notes).toBe('Synthetic metadata correction');
    });
    it('preserves a concurrent recalculation when metadata echoes an old mass', async () => {
      const device = await devices.saveSyringe(owner, syringe);
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: { ...prep, mass_value: 1, final_volume_ml: 1 },
      });
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: {
          syringe_id: device.id,
          dose: { value: '0.8', unit: 'mg' },
        },
      });
      const c = await getSystemClient();
      let pending: ReturnType<typeof injections.updateInjection> | undefined;
      try {
        await c.query('BEGIN');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid as number;
        await c.query(
          'UPDATE injection_entries SET dose_mg=0.9,volume_ml=0.9,syringe_units=90 WHERE id=$1',
          [logged.id]
        );
        pending = injections.updateInjection(owner, logged.id, {
          dose_mg: 0.8,
          notes: 'Synthetic concurrent metadata',
        });
        let blocked = false;
        for (let n = 0; n < 100; n++) {
          const result = await c.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
            [pid]
          );
          if (result.rows[0].blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await c.query('COMMIT');
        const saved = await pending;
        expect(saved.dose_mg).toBe(0.9);
        expect(saved.volume_ml).toBe('0.9');
        expect(saved.notes).toBe('Synthetic concurrent metadata');
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (pending) await pending.catch(() => {});
      }
    });
    it('amount correction and deletion use a consistent vial-first lock order', async () => {
      const device = await devices.saveSyringe(owner, syringe);
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: { ...prep, mass_value: 1, final_volume_ml: 1 },
      });
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: {
          syringe_id: device.id,
          dose: { value: '0.3', unit: 'mg' },
        },
      });
      const results = await Promise.allSettled([
        injections.updateInjection(owner, logged.id, { dose_mg: 0.4 }),
        injections.deleteInjection(owner, logged.id),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )?.stock
      ).toMatchObject({ remainingMg: 1 });
    });
    it('retains status audit history after unused vial removal', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      await stock.updatePen(owner, vial.id, {
        status: 'finished',
        lifecycle_intent: true,
      });
      expect(await stock.deletePen(owner, vial.id)).toBe(true);
      const c = await getSystemClient();
      try {
        const rows = await c.query(
          'SELECT user_id,pen_id,new_status FROM medication_stock_status_audit WHERE pen_id=$1',
          [vial.id]
        );
        expect(rows.rows).toEqual([
          { user_id: owner, pen_id: vial.id, new_status: 'finished' },
        ]);
        await expect(
          c.query(
            'UPDATE medication_stock_status_audit SET user_id=$1 WHERE pen_id=$2',
            [other, vial.id]
          )
        ).rejects.toThrow('identity is immutable');
      } finally {
        c.release();
      }
    });
    it('serialises concurrent calculated draws against fresh balance', async () => {
      const device = await devices.saveSyringe(owner, syringe);
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: { ...prep, mass_value: 1, final_volume_ml: 1 },
      });
      const request = {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: {
          syringe_id: device.id,
          dose: { value: '0.6', unit: 'ml' as const },
        },
      };
      const results = await Promise.allSettled([
        injections.createInjection(owner, request),
        injections.createInjection(owner, request),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });
  }
);
