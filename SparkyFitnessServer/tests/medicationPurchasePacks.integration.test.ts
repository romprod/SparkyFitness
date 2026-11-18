import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import type {
  MedicationPurchaseCreateInput,
  MedicationPurchaseUpdateInput,
  MedicationPurchaseView,
} from '@workspace/shared';

describe.runIf(process.env.PURCHASE_PACKS_INTEGRATION === '1')(
  'invoice links for tablet and capsule packs PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    let med: string, otherMed: string, secondMed: string;
    let packA: string, packB: string, packC: string, foreignPack: string;
    let otherMedPack: string;

    const admin = async <T>(work: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await work(c);
      } finally {
        c.release();
      }
    };
    const newPack = async (
      userId: string,
      medicationId: string,
      total: number,
      used = 0
    ) =>
      (
        await admin((c) =>
          c.query(
            "INSERT INTO medication_packs(user_id,medication_id,unit_label,units_total,units_used,status) VALUES($1,$2,'tablets',$3,$4,'sealed') RETURNING id",
            [userId, medicationId, total, used]
          )
        )
      ).rows[0].id as string;
    const line = (
      packs: string[],
      patch: Record<string, unknown> = {}
    ): MedicationPurchaseCreateInput['items'][number] => ({
      kind: 'medication',
      medication_id: med,
      description: 'Synthetic tablets',
      quantity: 2,
      unit_cost: '30',
      pack_ids: packs,
      ...patch,
    });
    const create = (
      items: MedicationPurchaseCreateInput['items'],
      patch: Partial<MedicationPurchaseCreateInput> = {}
    ): MedicationPurchaseCreateInput => ({
      expected_owner_id: owner,
      operation_id: randomUUID(),
      ordered_date: '2026-11-15',
      items,
      ...patch,
    });
    const update = (
      invoice: MedicationPurchaseView,
      patch: Partial<MedicationPurchaseUpdateInput> = {}
    ): MedicationPurchaseUpdateInput => ({
      ...invoice,
      expected_owner_id: owner,
      expected_revision: invoice.revision,
      items: invoice.items.map((item) => ({
        ...item,
        category: item.category ?? undefined,
      })),
      ...patch,
    });
    const packRow = async (id: string) =>
      (
        await admin((c) =>
          c.query(
            'SELECT to_jsonb(p) AS snapshot FROM medication_packs p WHERE id=$1',
            [id]
          )
        )
      ).rows[0]?.snapshot;

    beforeAll(async () => {
      await admin(async (c) => {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `pack-invoice-${id}@example.test`]
          );
        const insertMed = async (userId: string, name: string) =>
          (
            await c.query(
              "INSERT INTO medications(user_id,name,type_id,dose_amount,dose_unit) VALUES($1,$2,'tablet',2,'tablet') RETURNING id",
              [userId, name]
            )
          ).rows[0].id as string;
        med = await insertMed(owner, 'Synthetic pack medication');
        secondMed = await insertMed(owner, 'Synthetic second medication');
        otherMed = await insertMed(other, 'Synthetic foreign medication');
      });
      packA = await newPack(owner, med, 60, 12);
      packB = await newPack(owner, med, 90);
      packC = await newPack(owner, med, 30);
      otherMedPack = await newPack(owner, secondMed, 30);
      foreignPack = await newPack(other, otherMed, 30);
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });

    it('links packs to an invoice line and derives per-unit and consumed cost', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create([line([packA, packB])], { shipping_cost: '6', currency: 'GBP' })
      );
      expect(invoice).toMatchObject({ packs_linked: 2, vials_linked: 0 });
      expect(invoice.items[0]?.pack_ids.sort()).toEqual([packA, packB].sort());
      // 2 packs at 30 each plus 6 shipping spread by value: 33 landed per pack.
      expect(invoice.items[0]?.landed_unit).toBe('33');

      const costs = await purchases.getPackCosts(owner);
      const a = costs.find((cost) => cost.pack_id === packA)!;
      expect(a).toMatchObject({
        is_costed: true,
        currency: 'GBP',
        landed_pack: '33',
        landed_per_unit: '0.55',
        consumed: '6.6',
      });
      expect(costs.find((cost) => cost.pack_id === packB)).toMatchObject({
        landed_per_unit: '0.366667',
        consumed: '0',
      });
      expect(costs.find((cost) => cost.pack_id === packC)).toEqual({
        pack_id: packC,
        is_costed: false,
      });
      expect(costs.some((cost) => cost.pack_id === foreignPack)).toBe(false);
    });

    it('offers only free packs of the right medication, plus the ones already on this invoice', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create([line([packC], { quantity: 1 })])
      );
      const forNew = await purchases.getEditorData(owner);
      const ids = (rows: { id: string; purchase_item_id: string | null }[]) =>
        rows.filter((row) => row.purchase_item_id === null).map((r) => r.id);
      expect(ids(forNew.packs)).toContain(otherMedPack);
      expect(forNew.packs.map((p) => p.id)).not.toContain(foreignPack);
      expect(forNew.packs.map((p) => p.id)).not.toContain(packC);
      const forEdit = await purchases.getEditorData(owner, invoice.id);
      expect(forEdit.packs.find((p) => p.id === packC)?.purchase_item_id).toBe(
        invoice.items[0]?.id
      );
      expect(forEdit.packs.map((p) => p.id)).not.toContain(packA);
      await purchases.deletePurchase(owner, invoice.id, {
        expected_owner_id: owner,
        expected_revision: invoice.revision,
      });
    });

    it('rejects a pack for another medication, another account, a consumable line, or another invoice', async () => {
      await expect(
        purchases.createPurchase(owner, create([line([otherMedPack])]))
      ).rejects.toThrow(/different medication/);
      await expect(
        purchases.createPurchase(owner, create([line([foreignPack])]))
      ).rejects.toThrow(/different medication/);
      await expect(
        purchases.createPurchase(
          owner,
          create([
            {
              kind: 'consumable',
              description: 'Synthetic needles',
              quantity: 1,
              unit_cost: '5',
              pack_ids: [packC],
            },
          ])
        )
      ).rejects.toThrow(/Consumable lines/);
      await expect(
        purchases.createPurchase(
          owner,
          create([line([packC, packC], { quantity: 1 }), line([packC])])
        )
      ).rejects.toThrow(/more than one line/);
      // packA is already on the first invoice.
      await expect(
        purchases.createPurchase(
          owner,
          create([line([packA], { quantity: 1 })])
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('unlinking and deleting an invoice never changes the pack itself', async () => {
      const before = await packRow(packA);
      const invoice = (await purchases.listPurchases(owner)).find((inv) =>
        inv.items[0]?.pack_ids.includes(packA)
      )!;
      const unlinked = await purchases.updatePurchase(
        owner,
        invoice.id,
        update(invoice, {
          items: [
            { ...invoice.items[0]!, category: undefined, pack_ids: [packB] },
          ],
        })
      );
      expect(unlinked.packs_linked).toBe(1);
      expect(
        (await purchases.getPackCosts(owner)).find((c) => c.pack_id === packA)
      ).toEqual({ pack_id: packA, is_costed: false });
      await purchases.deletePurchase(owner, unlinked.id, {
        expected_owner_id: owner,
        expected_revision: unlinked.revision,
      });
      expect(
        (await purchases.getPackCosts(owner)).every((c) => !c.is_costed)
      ).toBe(true);
      expect(await packRow(packA)).toEqual(before);
      expect(await packRow(packB)).toBeTruthy();
    });

    it('guards the link table itself against a mismatched medication or owner', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create([line([], { quantity: 1 })])
      );
      const itemId = invoice.items[0]!.id;
      await expect(
        admin((c) =>
          c.query(
            'INSERT INTO medication_purchase_packs(user_id,pack_id,purchase_item_id) VALUES($1,$2,$3)',
            [owner, otherMedPack, itemId]
          )
        )
      ).rejects.toThrow(/does not match/);
      await expect(
        admin((c) =>
          c.query(
            'INSERT INTO medication_purchase_packs(user_id,pack_id,purchase_item_id) VALUES($1,$2,$3)',
            [other, foreignPack, itemId]
          )
        )
      ).rejects.toThrow();
    });
  }
);
