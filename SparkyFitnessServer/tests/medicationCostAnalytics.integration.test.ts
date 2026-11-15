import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import { getMedicationCostAnalytics } from '../models/medicationCostAnalyticsRepository.js';
import type { MedicationPurchaseView } from '@workspace/shared';

describe.runIf(process.env.COST_ANALYTICS_INTEGRATION === '1')(
  'owner product-cost report PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const now = new Date('2026-11-15T12:00:00Z');
    const read = (window: '3' | '6' | '12' | 'all' = '12') =>
      getMedicationCostAnalytics(owner, window, now);
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `analytics-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone) VALUES($1,'Pacific/Kiritimati') ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone",
          [owner]
        );
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
    const fixture = async (
      price: string,
      label: string | null = '10',
      ordered = '2026-11-15',
      currency = 'AUD'
    ) => {
      const c = await getSystemClient();
      let med: string, vial: string;
      try {
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic product-cost medication','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        vial = (
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind,label_mass_mg,concentration_mg_ml,volume_ml,dose_mg) VALUES($1,$2,'vial',$3,100,1,99) RETURNING id",
            [owner, med, label]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const invoice = await purchases.createPurchase(owner, {
        expected_owner_id: owner,
        operation_id: randomUUID(),
        ordered_date: ordered,
        currency,
        items: [
          {
            kind: 'medication',
            medication_id: med,
            quantity: 1,
            unit_cost: price,
            vial_ids: [vial],
          },
        ],
      });
      return { med, vial, invoice };
    };
    const log = async (
      med: string,
      vial: string | null,
      mass: string | null,
      day = '2026-11-15',
      volume: string | null = '0.1',
      unit: string | null = 'ml'
    ) => {
      const c = await getSystemClient();
      try {
        return (
          await c.query(
            'INSERT INTO injection_entries(user_id,medication_id,pen_id,entry_date,dose_mg,volume_ml,dose_input_unit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [owner, med, vial, day, mass, volume, unit]
          )
        ).rows[0].id as string;
      } finally {
        c.release();
      }
    };
    const edit = (invoice: MedicationPurchaseView, price: string) =>
      purchases.updatePurchase(owner, invoice.id, {
        ...invoice,
        expected_owner_id: owner,
        expected_revision: invoice.revision,
        items: invoice.items.map((item) => ({
          ...item,
          category: item.category ?? undefined,
          unit_cost: price,
        })),
      });
    it('uses owner-local today and recorded tracking days with old-invoice current usage and no output of private invoice fields', async () => {
      const { med, vial } = await fixture('40', '10', '2020-01-01', 'GBP');
      await log(med, vial, '1', '2026-11-16');
      await log(med, vial, '3', '2026-11-17');
      const result = await read('3');
      expect(result.window).toEqual({
        key: '3',
        from_date: '2026-08-16',
        to_date: '2026-11-16',
      });
      expect(
        result.rows.find((row) => row.medication_id === med)
      ).toMatchObject({
        spend: null,
        spend_present: false,
        cost_per_dose: '4',
        cost_per_mg: '4',
        usage_currency: 'GBP',
        costed_doses: 1,
        uncosted_doses: 0,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /reference|notes|invoice_id|dose_mg|pen_id/
      );
      await expect(
        dbContextStorage.run({ authenticatedUserId: other }, () => read())
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('distinguishes a linked zero-priced unknown label from known-zero delivered costs without modifying existing vial-cost semantics', async () => {
      const { med, vial } = await fixture('0', null);
      await log(med, vial, '0', '2026-11-15', '0', 'ml');
      await log(med, vial, '0', '2026-11-15', null, null);
      expect(
        (await purchases.getVialCosts(owner)).find((row) => row.pen_id === vial)
      ).toMatchObject({ is_costed: true, landed_unit: '0' });
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
      ).toMatchObject({
        spend: '0.00',
        cost_per_dose: null,
        costed_doses: 0,
        uncosted_doses: 2,
      });
      const c = await getSystemClient();
      try {
        await c.query(
          'UPDATE medication_pens SET label_mass_mg=10 WHERE id=$1',
          [vial]
        );
      } finally {
        c.release();
      }
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
      ).toMatchObject({
        cost_per_dose: '0',
        cost_per_mg: null,
        costed_doses: 1,
        uncosted_doses: 1,
      });
    });
    it('recomputes current invoice and independent label rates retrospectively, leaving deleted invoice and unlinked history unknown', async () => {
      const { med, vial, invoice } = await fixture('40');
      await log(med, vial, '1');
      await log(med, null, '2');
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
      ).toMatchObject({ cost_per_dose: '4', uncosted_doses: 1 });
      const updated = await edit(invoice, '60');
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
          ?.cost_per_dose
      ).toBe('6');
      const c = await getSystemClient();
      try {
        await c.query(
          'UPDATE medication_pens SET label_mass_mg=20 WHERE id=$1',
          [vial]
        );
      } finally {
        c.release();
      }
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
          ?.cost_per_dose
      ).toBe('3');
      await purchases.deletePurchase(owner, invoice.id, {
        expected_owner_id: owner,
        expected_revision: updated.revision,
      });
      expect(
        (await read()).rows.find((row) => row.medication_id === med)
      ).toMatchObject({
        spend: null,
        cost_per_dose: null,
        costed_doses: 0,
        uncosted_doses: 2,
      });
    });
    it('suppresses only each mixed metric using actual old invoice currencies, including zero-cost contributors', async () => {
      const first = await fixture('0', '10', '2026-11-15', 'AUD');
      const c = await getSystemClient();
      let second: string;
      try {
        second = (
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind,label_mass_mg) VALUES($1,$2,'vial',10) RETURNING id",
            [owner, first.med]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      await purchases.createPurchase(owner, {
        expected_owner_id: owner,
        operation_id: randomUUID(),
        ordered_date: '2020-01-01',
        currency: 'GBP',
        items: [
          {
            kind: 'medication',
            medication_id: first.med,
            quantity: 1,
            unit_cost: '40',
            vial_ids: [second],
          },
        ],
      });
      await log(first.med, second, '1');
      expect(
        (await read()).rows.find((row) => row.medication_id === first.med)
      ).toMatchObject({
        spend_currency: 'AUD',
        spend_mixed_currency: false,
        usage_currency: 'GBP',
        cost_per_dose: '4',
      });
      await log(first.med, first.vial, '0', '2026-11-15', '0', 'ml');
      expect(
        (await read()).rows.find((row) => row.medication_id === first.med)
      ).toMatchObject({
        spend: '0.00',
        usage_currency: null,
        usage_mixed_currency: true,
        cost_per_dose: null,
        cost_per_mg: null,
        costed_doses: 2,
      });
    });
    it('holds one snapshot across header, line, independent label and delivered history replacement without mutating data', async () => {
      const { med, vial, invoice } = await fixture('40');
      const entry = await log(med, vial, '1');
      const c = await getSystemClient();
      let pending: ReturnType<typeof read> | undefined;
      try {
        await c.query('BEGIN');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid as number;
        await c.query(
          'LOCK TABLE medication_purchase_items IN ACCESS EXCLUSIVE MODE'
        );
        await c.query(
          "UPDATE medication_purchases SET currency='GBP',revision=revision+1 WHERE id=$1",
          [invoice.id]
        );
        await c.query(
          'UPDATE medication_purchase_items SET unit_cost=80 WHERE purchase_id=$1',
          [invoice.id]
        );
        await c.query(
          'UPDATE medication_pens SET label_mass_mg=20 WHERE id=$1',
          [vial]
        );
        await c.query('UPDATE injection_entries SET dose_mg=2 WHERE id=$1', [
          entry,
        ]);
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
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await c.query('COMMIT');
        expect(
          (await pending).rows.find((row) => row.medication_id === med)
        ).toMatchObject({
          spend: '40.00',
          spend_currency: 'AUD',
          cost_per_dose: '4',
          usage_currency: 'AUD',
        });
        const checksum = async () =>
          (
            await c.query(
              "SELECT (SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY id)) FROM medication_purchases x WHERE user_id=$1) AS invoices,(SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY id)) FROM medication_pens x WHERE user_id=$1) AS stock,(SELECT md5(string_agg(to_jsonb(x)::text,',' ORDER BY id)) FROM injection_entries x WHERE user_id=$1) AS doses",
              [owner]
            )
          ).rows[0] as Record<string, string>;
        const before = await checksum();
        expect(
          (await read()).rows.find((row) => row.medication_id === med)
        ).toMatchObject({
          spend: '80.00',
          spend_currency: 'GBP',
          cost_per_dose: '8',
          cost_per_mg: '4',
          usage_currency: 'GBP',
        });
        expect(await checksum()).toEqual(before);
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (pending) await pending.catch(() => {});
      }
    });
  }
);
