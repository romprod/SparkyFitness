import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { MedicationPurchaseView } from '@workspace/shared';
import { getSystemClient, getClient, endPool } from '../db/poolManager.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import stock from '../models/medicationPenRepository.js';

// The repository refuses a medicine that is in use, so tests of what the database does
// when one goes (cascades, SET NULL, retained history) delete it directly.
async function rawDeleteMedication(id: string) {
  const client = await getSystemClient();
  try {
    const result = await client.query('DELETE FROM medications WHERE id=$1', [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

describe.runIf(process.env.PURCHASE_CONCURRENCY_INTEGRATION === '1')(
  'private invoice concurrency PostgreSQL',
  () => {
    const owner = randomUUID(),
      delegate = randomUUID();
    let med: string;
    const values = (medicationId = med, vial_ids: string[] = []) => ({
      expected_owner_id: owner,
      vendor: 'Synthetic vendor',
      ordered_date: '2026-11-15',
      currency: 'AUD',
      shipping_cost: '2',
      tax_cost: '0',
      other_fees: '0',
      discount: '0',
      allocation_method: 'value' as const,
      items: [
        {
          kind: 'medication' as const,
          medication_id: medicationId,
          description: 'Synthetic medication',
          quantity: 1,
          unit_cost: '10',
          vial_ids,
        },
      ],
    });
    const create = (vials: string[] = []) =>
      purchases.createPurchase(owner, {
        ...values(med, vials),
        operation_id: randomUUID(),
      });
    const edit = (purchase: MedicationPurchaseView, vials: string[] = []) => ({
      ...values(med, vials),
      expected_revision: purchase.revision,
      items: [{ ...values(med, vials).items[0], id: purchase.items[0].id }],
    });
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, delegate])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `purchase-race-${id}@example.test`]
          );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic invoice race','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status) VALUES($1,$2,$3,$4::jsonb,true,'active')",
          [
            owner,
            delegate,
            `purchase-race-${delegate}@example.test`,
            JSON.stringify({ can_manage_medications: true }),
          ]
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, delegate],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });
    it('serializes competing invoice claims without changing stock', async () => {
      const vial = await stock.createPen(owner, med, { kind: 'vial' });
      const results = await Promise.allSettled([
        create([vial.id]),
        create([vial.id]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { statusCode: 409 },
      });
      const c = await getSystemClient();
      try {
        expect(
          (
            await c.query(
              'SELECT doses_used,(SELECT COUNT(*) FROM injection_entries WHERE pen_id=$1) AS draws FROM medication_pens WHERE id=$1',
              [vial.id]
            )
          ).rows[0]
        ).toMatchObject({ doses_used: 0, draws: '0' });
        expect(
          (
            await c.query(
              'SELECT COUNT(*) AS count FROM medication_purchase_vials WHERE pen_id=$1',
              [vial.id]
            )
          ).rows[0].count
        ).toBe('1');
      } finally {
        c.release();
      }
    });
    it('rechecks cross-invoice unlink/claim updates and never steals a link', async () => {
      const vial = await stock.createPen(owner, med, { kind: 'vial' });
      const a = await create([vial.id]),
        b = await create();
      const results = await Promise.allSettled([
        purchases.updatePurchase(owner, a.id, edit(a)),
        purchases.updatePurchase(owner, b.id, edit(b, [vial.id])),
      ]);
      expect(results[0].status).toBe('fulfilled');
      if (results[1].status === 'rejected')
        expect(results[1].reason).toMatchObject({ statusCode: 409 });
      expect(
        (await purchases.getPurchase(owner, a.id))?.items[0].vial_ids
      ).toEqual([]);
      const cost = (await purchases.getVialCosts(owner)).find(
        (v) => v.pen_id === vial.id
      );
      if (results[1].status === 'fulfilled')
        expect(cost?.purchase_id).toBe(b.id);
      else expect(cost?.is_costed).toBe(false);
    });
    it('CAS edit/delete has one winner and create receipts cannot resurrect deleted invoices', async () => {
      const original = { ...values(), operation_id: randomUUID() };
      const purchase = await purchases.createPurchase(owner, original);
      const outcomes = await Promise.allSettled([
        purchases.updatePurchase(owner, purchase.id, edit(purchase)),
        purchases.deletePurchase(owner, purchase.id, {
          expected_owner_id: owner,
          expected_revision: purchase.revision,
        }),
      ]);
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const remaining = await purchases.getPurchase(owner, purchase.id);
      if (remaining)
        await purchases.deletePurchase(owner, purchase.id, {
          expected_owner_id: owner,
          expected_revision: remaining.revision,
        });
      await expect(
        purchases.createPurchase(owner, original)
      ).rejects.toMatchObject({ statusCode: 410 });
      expect(await purchases.getPurchase(owner, purchase.id)).toBeNull();
    });
    it('preserves invoice history across parent deletion racing invoice edit', async () => {
      const c = await getSystemClient();
      let temporaryMed: string;
      try {
        temporaryMed = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic deleted parent','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const vial = await stock.createPen(owner, temporaryMed, { kind: 'vial' });
      const purchase = await purchases.createPurchase(owner, {
        ...values(temporaryMed, [vial.id]),
        operation_id: randomUUID(),
      });
      const outcomes = await Promise.allSettled([
        rawDeleteMedication(temporaryMed),
        purchases.updatePurchase(owner, purchase.id, {
          ...values(temporaryMed, [vial.id]),
          expected_revision: purchase.revision,
          items: [
            {
              ...values(temporaryMed, [vial.id]).items[0],
              id: purchase.items[0].id,
            },
          ],
        }),
      ]);
      expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: true });
      if (outcomes[1].status === 'rejected')
        expect([400, 404, 409]).toContain(outcomes[1].reason.statusCode);
      const saved = await purchases.getPurchase(owner, purchase.id);
      expect(saved?.items[0]).toMatchObject({
        medication_id: null,
        quantity: 1,
        unit_cost: '10',
        vial_ids: [],
      });
    });
    it('orders account deletion before new financial foreign-key writes without deadlock', async () => {
      const account = randomUUID();
      const setup = await getSystemClient();
      let medicationId: string;
      try {
        await setup.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [account, `purchase-delete-${account}@example.test`]
        );
        medicationId = (
          await setup.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic account deletion','injection') RETURNING id",
            [account]
          )
        ).rows[0].id;
      } finally {
        setup.release();
      }
      const deleting = await getSystemClient();
      try {
        const results = await Promise.allSettled([
          purchases.createPurchase(account, {
            ...values(medicationId),
            expected_owner_id: account,
            operation_id: randomUUID(),
          }),
          deleting.query('DELETE FROM public."user" WHERE id=$1', [account]),
        ]);
        expect(results[1].status).toBe('fulfilled');
        if (results[0].status === 'rejected')
          expect([400, 403, 404, 409]).toContain(results[0].reason.statusCode);
        expect(
          (
            await deleting.query(
              'SELECT COUNT(*) AS count FROM medication_purchases WHERE user_id=$1',
              [account]
            )
          ).rows[0].count
        ).toBe('0');
      } finally {
        await deleting.query('DELETE FROM public."user" WHERE id=$1', [
          account,
        ]);
        deleting.release();
      }
    });
    it('owner-only financial RLS denies medication delegation and preserves immutable receipts', async () => {
      const purchase = await create();
      const c = await getClient(owner, delegate);
      try {
        expect(
          (
            await c.query(
              'SELECT COUNT(*) AS count FROM medications WHERE id=$1',
              [med]
            )
          ).rows[0].count
        ).toBe('1');
        for (const table of [
          'medication_purchases',
          'medication_purchase_items',
          'medication_purchase_vials',
          'medication_purchase_operations',
        ])
          expect(
            (
              await c.query(
                `SELECT COUNT(*) AS count FROM public.${table} WHERE user_id=$1`,
                [owner]
              )
            ).rows[0].count
          ).toBe('0');
        await expect(
          c.query(
            "INSERT INTO medication_purchases(user_id,ordered_date) VALUES($1,'2026-11-15')",
            [owner]
          )
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        c.release();
      }
      const own = await getClient(owner);
      try {
        expect(
          (
            await own.query(
              'DELETE FROM medication_purchase_operations WHERE user_id=$1',
              [owner]
            )
          ).rowCount
        ).toBe(0);
        expect(
          (
            await own.query(
              'SELECT COUNT(*) AS count FROM medication_purchase_operations WHERE purchase_id=$1',
              [purchase.id]
            )
          ).rows[0].count
        ).toBe('1');
      } finally {
        own.release();
      }
    });
  }
);
