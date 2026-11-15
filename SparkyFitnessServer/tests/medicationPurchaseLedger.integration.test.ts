import { randomUUID } from 'node:crypto';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import stock from '../models/medicationPenRepository.js';
import { medicationPreparationInputSchema } from '@workspace/shared';
import type {
  MedicationPurchaseCreateInput,
  MedicationPurchaseView,
  MedicationPurchaseUpdateInput,
} from '@workspace/shared';
describe.runIf(process.env.PURCHASE_LEDGER_INTEGRATION === '1')(
  'owner invoice ledger PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    let med: string, otherMed: string, vial: string;
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
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `invoice-${id}@example.test`]
          );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic invoice medication','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        otherMed = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic foreign medication','injection') RETURNING id",
            [other]
          )
        ).rows[0].id;
        vial = (
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind,label,concentration_mg_ml,volume_ml,status) VALUES($1,$2,'vial','Synthetic stock',1,1,'discarded') RETURNING id",
            [owner, med]
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
    it('keeps exact invoice data, encryption, per-currency totals and source overmatch warning semantics', async () => {
      const c = await getSystemClient();
      let before: unknown;
      let secondVial: string;
      try {
        secondVial = (
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind,status) VALUES($1,$2,'vial','finished') RETURNING id",
            [owner, med]
          )
        ).rows[0].id;
        before = (
          await c.query(
            'SELECT to_jsonb(p) AS snapshot FROM medication_pens p WHERE id=$1',
            [vial]
          )
        ).rows[0].snapshot;
      } finally {
        c.release();
      }
      const invoice = await purchases.createPurchase(
        owner,
        create(
          [
            {
              kind: 'medication',
              medication_id: med,
              description: 'Synthetic vial line',
              quantity: 1,
              unit_cost: '0.123456789123456789',
              vial_ids: [vial, secondVial],
            },
          ],
          {
            reference: 'Synthetic private reference',
            notes: 'Synthetic private note',
            currency: 'custom units',
            shipping_cost: '0.005',
          }
        )
      );
      expect(invoice.items[0]?.unit_cost).toBe('0.123456789123456789');
      expect(invoice).toMatchObject({ vials_expected: 1, vials_linked: 2 });
      expect(invoice.reference).toBe('Synthetic private reference');
      expect(invoice.currency).toBe('custom units');
      const sys = await getSystemClient();
      try {
        const raw = (
          await sys.query(
            'SELECT reference_encrypted,notes_encrypted FROM medication_purchases WHERE id=$1',
            [invoice.id]
          )
        ).rows[0];
        expect(JSON.stringify(raw)).not.toContain('Synthetic private');
        expect(
          (
            await sys.query(
              'SELECT to_jsonb(p) AS snapshot FROM medication_pens p WHERE id=$1',
              [vial]
            )
          ).rows[0].snapshot
        ).toEqual(before);
      } finally {
        sys.release();
      }
      expect(
        (await purchases.getVialCosts(owner)).find(
          (item) => item.pen_id === vial
        )
      ).toMatchObject({ is_costed: true, currency: 'custom units' });
      await purchases.deletePurchase(owner, invoice.id, {
        expected_owner_id: owner,
        expected_revision: invoice.revision,
      });
      expect(
        (await purchases.getVialCosts(owner)).find(
          (item) => item.pen_id === vial
        )
      ).toEqual({ pen_id: vial, is_costed: false });
    });
    it('rejects a populated blank-description consumable without dropping lines or partly updating the invoice', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create([
          {
            kind: 'consumable',
            description: 'Synthetic complete line',
            quantity: 1,
            unit_cost: '5',
          },
        ])
      );
      await expect(
        purchases.updatePurchase(
          owner,
          invoice.id,
          update(invoice, {
            shipping_cost: '20',
            items: [
              {
                id: invoice.items[0]!.id,
                kind: 'consumable',
                description: ' ',
                quantity: 2,
                unit_cost: '12.50',
              },
            ],
          })
        )
      ).rejects.toThrow();
      const retained = (await purchases.getPurchase(owner, invoice.id))!;
      expect(retained.revision).toBe(1);
      expect(retained.shipping_cost).toBe('0');
      expect(retained.items).toHaveLength(1);
      expect(retained.items[0]).toMatchObject({
        description: 'Synthetic complete line',
        quantity: 1,
        unit_cost: '5',
      });
    });
    it('binds creates to owner and rejects cross-owner medications without writes', async () => {
      await expect(
        purchases.createPurchase(
          owner,
          create(
            [
              {
                kind: 'medication',
                medication_id: med,
                quantity: 1,
                unit_cost: '1',
              },
            ],
            { expected_owner_id: other }
          )
        )
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        purchases.createPurchase(
          owner,
          create([
            {
              kind: 'medication',
              medication_id: otherMed,
              quantity: 1,
              unit_cost: '1',
            },
          ])
        )
      ).rejects.toThrow('Medication not found');
      await expect(
        dbContextStorage.run({ authenticatedUserId: other }, () =>
          purchases.listPurchases(owner)
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    it('replays creates once, rejects conflicting operation payloads and leaves a deletion tombstone', async () => {
      const draft = create([
        {
          kind: 'consumable',
          description: 'Synthetic needles',
          quantity: 1,
          unit_cost: '0',
        },
      ]);
      const invoice = await purchases.createPurchase(owner, draft);
      expect((await purchases.createPurchase(owner, draft)).id).toBe(
        invoice.id
      );
      await expect(
        purchases.createPurchase(owner, { ...draft, currency: 'GBP' })
      ).rejects.toMatchObject({ statusCode: 409 });
      await purchases.deletePurchase(owner, invoice.id, {
        expected_owner_id: owner,
        expected_revision: 1,
      });
      await expect(
        purchases.createPurchase(owner, draft)
      ).rejects.toMatchObject({ statusCode: 410 });
    });
    it('preserves line IDs and rejects stale revisions, duplicate line IDs and fake orphan conversion atomically', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create([
          {
            kind: 'consumable',
            description: 'Synthetic swabs',
            quantity: 3,
            unit_cost: '0.335',
          },
        ])
      );
      const changed = await purchases.updatePurchase(
        owner,
        invoice.id,
        update(invoice, { shipping_cost: '1' })
      );
      expect(changed.items[0]?.id).toBe(invoice.items[0]?.id);
      expect(changed.revision).toBe(2);
      await expect(
        purchases.updatePurchase(owner, invoice.id, update(invoice))
      ).rejects.toMatchObject({ statusCode: 409 });
      const line = changed.items[0]!;
      await expect(
        purchases.updatePurchase(
          owner,
          invoice.id,
          update(changed, {
            items: [
              {
                ...line,
                category: undefined,
                kind: 'medication',
                medication_id: null,
              },
            ],
          })
        )
      ).rejects.toThrow('Choose a medication');
      await expect(
        purchases.updatePurchase(
          owner,
          invoice.id,
          update(changed, {
            items: [
              { ...line, category: undefined },
              { ...line, category: undefined },
            ],
          })
        )
      ).rejects.toThrow('same invoice line');
      expect((await purchases.getPurchase(owner, invoice.id))?.revision).toBe(
        2
      );
    });
    it('retains orphan invoice history and permits financial corrections after medication and vial deletion', async () => {
      const c = await getSystemClient();
      let orphanMed: string;
      let orphanVial: string;
      try {
        orphanMed = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic orphan medication','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        orphanVial = (
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind) VALUES($1,$2,'vial') RETURNING id",
            [owner, orphanMed]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const invoice = await purchases.createPurchase(
        owner,
        create([
          {
            kind: 'medication',
            medication_id: orphanMed,
            description: 'Synthetic retained purchase description',
            quantity: 2,
            unit_cost: '5',
            vial_ids: [orphanVial],
          },
        ])
      );
      const sys = await getSystemClient();
      try {
        await sys.query('DELETE FROM medications WHERE id=$1', [orphanMed]);
      } finally {
        sys.release();
      }
      const orphan = (await purchases.getPurchase(owner, invoice.id))!;
      expect(orphan.items[0]).toMatchObject({
        medication_id: null,
        description: 'Synthetic retained purchase description',
        quantity: 2,
        unit_cost: '5',
        vial_ids: [],
      });
      const edited = await purchases.updatePurchase(
        owner,
        invoice.id,
        update(orphan, { shipping_cost: '3' })
      );
      expect(edited.totals.total).toBe('13.00');
      expect(edited.items[0]?.medication_id).toBeNull();
    });
    it('reads header, lines and cost context from one snapshot during a concurrent invoice replacement', async () => {
      const invoice = await purchases.createPurchase(
        owner,
        create(
          [
            {
              kind: 'consumable',
              description: 'Synthetic snapshot line',
              quantity: 1,
              unit_cost: '2',
            },
          ],
          { shipping_cost: '1' }
        )
      );
      const c = await getSystemClient();
      let pending: ReturnType<typeof purchases.getPurchase> | undefined;
      try {
        await c.query('BEGIN');
        const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid as number;
        await c.query(
          'LOCK TABLE medication_purchase_items IN ACCESS EXCLUSIVE MODE'
        );
        await c.query(
          "UPDATE medication_purchases SET currency='GBP',shipping_cost=10,revision=revision+1 WHERE id=$1",
          [invoice.id]
        );
        await c.query(
          'UPDATE medication_purchase_items SET unit_cost=20 WHERE purchase_id=$1',
          [invoice.id]
        );
        pending = purchases.getPurchase(owner, invoice.id);
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
        const read = await pending;
        expect(read).toMatchObject({
          currency: 'AUD',
          shipping_cost: '1',
          revision: 1,
          items: [{ unit_cost: '2' }],
        });
        expect(read?.totals.total).toBe('3.00');
        expect(
          (await purchases.getPurchase(owner, invoice.id))?.totals.total
        ).toBe('30.00');
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (pending) await pending.catch(() => {});
      }
    });
    it('projects exact prepared content and leaves unknown legacy totals null without using dose/count/concentration hints', async () => {
      const base = {
        kind: 'vial' as const,
        label: 'Synthetic identical vial',
        lot_number: 'SAME',
        dose_mg: 99,
        status: 'sealed' as const,
      };
      const known: { id: string }[] = [];
      for (const mass of ['10.123456789123456789', '20']) {
        known.push(
          await stock.createPen(owner, med, {
            ...base,
            preparation: medicationPreparationInputSchema.parse({
              mode: 'reconstituted',
              mass_value: mass,
              mass_unit: 'mg',
              final_volume_ml: '1',
              prepared_date: '2026-11-15',
            }),
          })
        );
      }
      const unknown = await stock.createPen(owner, med, {
        ...base,
        concentration_mg_ml: 2,
        volume_ml: 8,
        doses_total: 40,
      });
      const editor = await purchases.getEditorData(owner);
      expect(
        editor.vials.find((v) => v.id === known[0]!.id)?.prepared_mass_mg
      ).toBe('10.123456789123456789');
      expect(
        editor.vials.find((v) => v.id === known[1]!.id)?.prepared_mass_mg
      ).toBe('20');
      expect(
        editor.vials.find((v) => v.id === unknown.id)?.prepared_mass_mg
      ).toBeNull();
    });
    it('binds purchase scope guards to intended tables and contexts before any parent reads', async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          'CREATE TEMP TABLE purchase_guard_probe(user_id UUID,medication_id UUID,purchase_id UUID,purchase_item_id UUID,pen_id UUID)'
        );
        for (const guard of [
          'check_medication_purchase_item_scope',
          'check_medication_purchase_vial_scope',
          'check_medication_purchase_owner',
        ]) {
          await c.query(
            `CREATE TRIGGER wrong_binding BEFORE INSERT ON purchase_guard_probe FOR EACH ROW EXECUTE FUNCTION public.${guard}()`
          );
          await expect(
            c.query('INSERT INTO purchase_guard_probe(user_id) VALUES($1)', [
              owner,
            ])
          ).rejects.toThrow('guard binding');
          await c.query('DROP TRIGGER wrong_binding ON purchase_guard_probe');
        }
      } finally {
        await c.query('DROP TABLE IF EXISTS purchase_guard_probe');
        c.release();
      }
    });
  }
);
