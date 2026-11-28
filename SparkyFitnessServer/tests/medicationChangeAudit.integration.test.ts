import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  MedicationPurchaseCreateInput,
  MedicationPurchaseUpdateInput,
  MedicationPurchaseView,
} from '@workspace/shared';
import { endPool, getClient } from '../db/poolManager.js';
import { decrypt, ENCRYPTION_KEY } from '../security/encryption.js';
import medications from '../models/medicationRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import * as rx from '../models/medicationPrescriptionRepository.js';
import {
  commitPreparationCorrection,
  reviewPreparationCorrection,
} from '../models/medicationPreparationCorrectionRepository.js';
import * as legacy from './fixtures/legacy/medicationPrescriptionRepository.legacy.js';
import { prescriptionCoverageHarness } from './fixtures/prescriptionCoverageHarness.js';

// The triggers run below every writer, so these tests call the real repository
// functions against a real database. Explicit opt-in, isolated synthetic database
// only, never production.
const MIGRATION = fileURLToPath(
  new URL(
    '../db/migrations/20261128120000_medication_change_audit.sql',
    import.meta.url
  )
);

// Every medication_pens column is either audited (it can write a vial row) or bookkeeping
// (dose saves and the lifecycle move it). A new column must be added to one of the two lists
// here, and to the migration (the trigger's UPDATE OF list, or the snapshot's blocklist).
const VIAL_AUDITED = [
  'medication_id',
  'kind',
  'label',
  'dose_mg',
  'concentration_mg_ml',
  'volume_ml',
  'doses_total',
  'expiry_date',
  'bud_date',
  'bud_mode',
  'bud_interval_days',
  'bud_base_date',
  'bud_source',
  'reorder_threshold',
  'notes',
  'source',
  'lot_number',
  'storage_location',
  'label_mass_mg',
  'prescription_id',
];
const VIAL_BOOKKEEPING = [
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'custom_fields',
  'doses_used',
  'status',
  'opened_at',
  'reorder_flag',
  'finished_at',
];

// Six writer triggers (the vial's insert/delete and its edit are two) and two guards.
const WRITER_TRIGGERS = [
  'medication_change_audit_prescription',
  'medication_change_audit_prescription_medicine',
  'medication_change_audit_purchase',
  'medication_change_audit_purchase_item',
  'medication_change_audit_vial_edit',
  'medication_change_audit_vial_write',
];
const GUARD_TRIGGERS = [
  'medication_change_audit_immutable',
  'medication_change_audit_insert_guard',
];

type AuditRow = {
  action: string;
  actor_user_id: string | null;
  user_id: string;
  entity_kind: string;
  entity_id: string;
  parent_id: string | null;
  medication_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  tx_id: string;
};
type Envelope = { encryptedText: string; iv: string; tag: string };

describe.runIf(process.env.MEDICATION_CHANGE_AUDIT_INTEGRATION === '1')(
  'medication change audit log in isolated PostgreSQL',
  () => {
    const h = prescriptionCoverageHarness('change-audit');
    const { owner, delegate: caregiver, admin, medication } = h;
    const reportsOnly = randomUUID();
    const doomed = [randomUUID(), randomUUID()];
    const extraUsers = [reportsOnly, ...doomed];

    const asApp = async <T>(
      userId: string,
      authenticatedUserId: string | undefined,
      work: (client: PoolClient) => Promise<T>
    ) => {
      const client = await getClient(userId, authenticatedUserId);
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const COLS =
      'action, actor_user_id, user_id, entity_kind, entity_id, parent_id, medication_id, old_values, new_values, tx_id::text AS tx_id';
    const auditOf = async (entityId: string) =>
      (
        await admin((c) =>
          c.query(
            `SELECT ${COLS} FROM medication_change_audit WHERE entity_id=$1 ORDER BY changed_at, id`,
            [entityId]
          )
        )
      ).rows as AuditRow[];
    const allRows = async (userId = owner) =>
      (
        await admin((c) =>
          c.query(
            `SELECT ${COLS} FROM medication_change_audit WHERE user_id=$1 ORDER BY changed_at, id`,
            [userId]
          )
        )
      ).rows as AuditRow[];
    /** The rows written since `before` (an earlier allRows length). The table is append-only. */
    const since = async (before: number, userId = owner) =>
      (await allRows(userId)).slice(before);
    const mark = async (userId = owner) => (await allRows(userId)).length;
    const kinds = (rows: AuditRow[]) =>
      rows.map((r) => `${r.entity_kind}:${r.action}`).sort();
    const penRow = async (id: string) =>
      (
        await admin((c) =>
          c.query(
            'SELECT doses_used, status, opened_at, reorder_flag FROM medication_pens WHERE id=$1',
            [id]
          )
        )
      ).rows[0];
    const count = async (sql: string, params: unknown[] = []) =>
      (await admin((c) => c.query(sql, params))).rows[0].n as number;
    const preparation = {
      mode: 'reconstituted' as const,
      mass_value: 10,
      mass_unit: 'mg' as const,
      final_volume_ml: 2,
      prepared_date: '2026-11-15',
    };
    const vial = (med: string, patch: Record<string, unknown> = {}) =>
      stock.createPen(owner, med, {
        kind: 'vial',
        label: 'Synthetic audit vial',
        ...patch,
      } as never);

    // -- invoices -------------------------------------------------------------
    const create = (
      items: MedicationPurchaseCreateInput['items'],
      patch: Partial<MedicationPurchaseCreateInput> = {}
    ): MedicationPurchaseCreateInput => ({
      expected_owner_id: owner,
      operation_id: randomUUID(),
      ordered_date: '2026-11-15',
      currency: 'AUD',
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
    const line = (med: string, description: string, extra = {}) => ({
      kind: 'medication' as const,
      medication_id: med,
      description,
      quantity: 2,
      unit_cost: '10',
      ...extra,
    });
    const consumable = (description: string) => ({
      kind: 'consumable' as const,
      category: 'needle' as const,
      description,
      quantity: 1,
      unit_cost: '3',
    });

    // -- prescriptions --------------------------------------------------------
    const deleteRx = async (id: string) =>
      rx.deleteMedicationPrescription(owner, id, {
        operation_id: randomUUID(),
        expected_version: await h.version(id),
      });

    // -- one injected failure for the whole file ------------------------------
    const forceFailure = (on: boolean) =>
      admin((c) =>
        c.query(
          on
            ? 'ALTER TABLE public.medication_change_audit ADD CONSTRAINT zz_force_audit_failure CHECK (false) NOT VALID'
            : 'ALTER TABLE public.medication_change_audit DROP CONSTRAINT IF EXISTS zz_force_audit_failure'
        )
      );

    /**
     * Runs `work` with the writer function swapped for one that only records which trigger
     * fired, then puts the real function back. Proves which statements fire which trigger.
     */
    async function fires(work: () => Promise<unknown>) {
      await admin(async (c) => {
        await c.query(
          'CREATE TABLE IF NOT EXISTS public.zz_change_audit_fires (tg_name text, tg_op text, tbl text)'
        );
        await c.query('TRUNCATE public.zz_change_audit_fires');
        await c.query(`CREATE OR REPLACE FUNCTION public.record_medication_change_audit()
          RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
          BEGIN INSERT INTO public.zz_change_audit_fires VALUES (TG_NAME, TG_OP, TG_TABLE_NAME); RETURN NULL; END $f$`);
      });
      try {
        await work();
        return (
          await admin((c) =>
            c.query(
              'SELECT tg_name, tg_op, tbl FROM public.zz_change_audit_fires'
            )
          )
        ).rows as Array<{ tg_name: string; tg_op: string; tbl: string }>;
      } finally {
        await admin(async (c) => {
          await c.query(readFileSync(MIGRATION, 'utf8'));
          await c.query('DROP TABLE IF EXISTS public.zz_change_audit_fires');
        });
      }
    }

    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await h.setup();
      await admin(async (c) => {
        for (const id of extraUsers)
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `change-audit-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'UTC',14,3)",
          [owner]
        );
        await c.query(
          `INSERT INTO public.family_access (owner_user_id,family_user_id,family_email,access_permissions,is_active,status)
           VALUES ($1,$2,$3,'{"can_view_reports":true}'::jsonb,true,'active')`,
          [owner, reportsOnly, `change-audit-fam-${reportsOnly}@example.test`]
        );
      });
    });
    afterAll(async () => {
      await admin(async (c) => {
        await c.query(
          'ALTER TABLE public.medication_change_audit DROP CONSTRAINT IF EXISTS zz_force_audit_failure'
        );
        await c.query(
          'ALTER TABLE public.medication_pens ENABLE TRIGGER medication_change_audit_vial_write'
        );
        await c.query('DROP TABLE IF EXISTS public.zz_change_audit_fires');
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          extraUsers,
        ]);
      });
      await h.teardown();
      await endPool();
    });

    it('1. applying the migration again leaves one of each function, the six writer triggers, two guards and the indexes', async () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      await admin(async (c) => {
        await c.query(sql);
        await c.query(sql);
        const fns = await c.query(
          `SELECT proname, count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace
            AND proname IN ('record_medication_change_audit','protect_medication_change_audit','medication_change_audit_snapshot','medication_change_audit_text')
            GROUP BY proname ORDER BY proname`
        );
        expect(fns.rows).toEqual([
          { proname: 'medication_change_audit_snapshot', n: 1 },
          { proname: 'medication_change_audit_text', n: 1 },
          { proname: 'protect_medication_change_audit', n: 1 },
          { proname: 'record_medication_change_audit', n: 1 },
        ]);
        const triggers = await c.query(
          `SELECT tgname, tgenabled, tgrelid::regclass::text AS tbl,
                  (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM unnest(t.tgattr::int2[]) k
                    JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k) AS cols
             FROM pg_trigger t WHERE NOT tgisinternal AND tgname LIKE 'medication_change_audit_%' ORDER BY tgname`
        );
        expect(triggers.rows.map((r) => r.tgname)).toEqual(
          [...GUARD_TRIGGERS, ...WRITER_TRIGGERS].sort()
        );
        expect(triggers.rows.every((r) => r.tgenabled === 'O')).toBe(true);
        // the vial edit trigger is declared UPDATE OF exactly the audited columns
        const edit = triggers.rows.find(
          (r) => r.tgname === 'medication_change_audit_vial_edit'
        );
        expect(edit.tbl).toBe('medication_pens');
        expect(edit.cols.split(',')).toEqual([...VIAL_AUDITED].sort());
        const indexes = await c.query(
          "SELECT indexname FROM pg_indexes WHERE tablename='medication_change_audit' ORDER BY indexname"
        );
        expect(indexes.rows.map((r) => r.indexname)).toEqual([
          'medication_change_audit_entity',
          'medication_change_audit_pkey',
          'medication_change_audit_recent',
        ]);
        const rls = await c.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.medication_change_audit'::regclass"
        );
        expect(rls.rows[0].relrowsecurity).toBe(true);
        // the deployed dose audit is untouched by this migration
        const dose = await c.query(
          "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'medication_dose_audit_%' ORDER BY tgname"
        );
        expect(dose.rows.map((r) => r.tgname)).toEqual([
          'medication_dose_audit_entry',
          'medication_dose_audit_immutable',
          'medication_dose_audit_injection',
          'medication_dose_audit_insert_guard',
        ]);
      });
    });

    it('2. a vial: create (with and without lot or BUD fields), an edit by hand and the delete of an unused one', async () => {
      const med = await medication('Synthetic vial audit');
      // no lot, storage or BUD field: one create row
      const plain = await vial(med, { label_mass_mg: '10', preparation });
      let rows = await auditOf(plain.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'create',
        actor_user_id: owner,
        user_id: owner,
        entity_kind: 'vial',
        entity_id: plain.id,
        parent_id: null,
        medication_id: med,
        old_values: null,
      });
      expect(rows[0].tx_id).toMatch(/^\d+$/);
      const created = rows[0].new_values!;
      expect(created).toMatchObject({
        kind: 'vial',
        label: 'Synthetic audit vial',
        // numbers are written as text
        label_mass_mg: expect.stringMatching(/^10(\.0+)?$/),
        medication_id: med,
      });
      for (const key of VIAL_BOOKKEEPING)
        expect(created).not.toHaveProperty(key);
      expect(typeof created.volume_ml).toBe('string');

      // lot and storage set: the create and the follow-up edit share one transaction
      const full = await vial(med, {
        label: 'Synthetic lot vial',
        lot_number: 'LOT-001',
        storage_location: 'Fridge shelf 2',
        notes: 'Synthetic vial note',
      });
      rows = await auditOf(full.id);
      expect(rows.map((r) => r.action)).toEqual(['create', 'edit']);
      expect(rows[1].tx_id).toBe(rows[0].tx_id);
      expect(rows[0].new_values).toMatchObject({
        notes: 'Synthetic vial note',
        lot_number: null,
      });
      expect(rows[1].old_values).toMatchObject({
        lot_number: null,
        storage_location: null,
      });
      expect(rows[1].new_values).toMatchObject({
        lot_number: 'LOT-001',
        storage_location: 'Fridge shelf 2',
      });
      // a second vial is another transaction
      const other = await vial(med, { lot_number: 'LOT-002' });
      expect((await auditOf(other.id))[0].tx_id).not.toBe(rows[0].tx_id);

      // an edit by hand writes only the changed keys
      await stock.updatePen(owner, full.id, {
        label: 'Renamed vial',
        notes: 'Changed note',
        expiry_date: '2027-01-31',
      });
      rows = await auditOf(full.id);
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({
        action: 'edit',
        actor_user_id: owner,
        old_values: {
          label: 'Synthetic lot vial',
          notes: 'Synthetic vial note',
          expiry_date: null,
        },
        new_values: {
          label: 'Renamed vial',
          notes: 'Changed note',
          expiry_date: '2027-01-31',
        },
      });
      // the same values again, and bookkeeping only: nothing to record
      await stock.updatePen(owner, full.id, { label: 'Renamed vial' });
      await stock.updatePen(owner, full.id, {
        reorder_flag: true,
        custom_fields: { synthetic: 'value' },
      });
      expect(await auditOf(full.id)).toHaveLength(3);

      // an unused vial can be deleted: one delete row holding the whole vial
      expect(await stock.deletePen(owner, full.id)).toBe(true);
      rows = await auditOf(full.id);
      expect(rows.map((r) => r.action)).toEqual([
        'create',
        'edit',
        'edit',
        'delete',
      ]);
      expect(rows[3].new_values).toBeNull();
      expect(rows[3].old_values).toMatchObject({
        label: 'Renamed vial',
        lot_number: 'LOT-001',
        notes: 'Changed note',
      });
      expect(await stock.deletePen(owner, full.id)).toBe(false);
      expect(await auditOf(full.id)).toHaveLength(4);
    });

    it('3. a dose create, edit and delete write no vial row and never fire the vial UPDATE trigger; every vial column is classified', async () => {
      // a new column in medication_pens fails here until it is audited or listed as bookkeeping
      const columns = (
        await admin((c) =>
          c.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='medication_pens'"
          )
        )
      ).rows.map((r) => r.column_name as string);
      expect([...columns].sort()).toEqual(
        [...VIAL_AUDITED, ...VIAL_BOOKKEEPING].sort()
      );
      expect(VIAL_AUDITED.filter((c) => VIAL_BOOKKEEPING.includes(c))).toEqual(
        []
      );

      const med = (
        await medications.createMedication(owner, {
          name: 'Synthetic dose-path medicine',
          type_id: 'injection',
        })
      ).id;
      const doseVial = await vial(med, {
        doses_total: 5,
        reorder_threshold: 5,
      });
      const before = await mark();
      let injectionId = '';
      const log = await fires(async () => {
        const dose = await injections.createInjection(owner, {
          medication_id: med,
          pen_id: doseVial.id,
          deduct_pen: true,
          dose_mg: 0.1,
          site: 'Synthetic site A',
        } as never);
        injectionId = dose.id;
        await injections.updateInjection(owner, injectionId, {
          site: 'Synthetic site B',
        });
        await injections.deleteInjection(owner, injectionId);
      });
      // the counters and status moved ...
      expect(await penRow(doseVial.id)).toMatchObject({
        doses_used: 0,
        status: 'in_use',
        reorder_flag: true,
      });
      expect((await penRow(doseVial.id)).opened_at).not.toBeNull();
      // ... but no statement of the dose path fired a trigger on medication_pens
      expect(log.filter((f) => f.tbl === 'medication_pens')).toEqual([]);
      // and, with the real function back, no vial row exists for it
      expect(
        (await since(before)).filter((r) => r.entity_kind === 'vial')
      ).toEqual([]);

      // the counter and status updates themselves, by name, never fire the edit trigger
      const names = await fires(async () => {
        await admin((c) =>
          c.query(
            "UPDATE medication_pens SET doses_used=3,status='in_use',opened_at=CURRENT_DATE,reorder_flag=true,finished_at=NULL,updated_at=NOW() WHERE id=$1",
            [doseVial.id]
          )
        );
        // a retire through the repository sets status and finished_at only
        await stock.updatePen(owner, doseVial.id, {
          status: 'discarded',
          lifecycle_intent: true,
        });
        // positive control: a hand edit does fire it
        await stock.updatePen(owner, doseVial.id, { label: 'Fire check' });
      });
      expect(names).toEqual([
        {
          tg_name: 'medication_change_audit_vial_edit',
          tg_op: 'UPDATE',
          tbl: 'medication_pens',
        },
      ]);
    });

    it('4. a preparation correction writes a vial edit; a status change through updatePen with intent writes only the ledger row', async () => {
      const med = await medication('Synthetic correction medicine');
      const prepared = await vial(med, { label_mass_mg: '10', preparation });
      const input = {
        expected_revision: 0,
        preparation: {
          mode: 'reconstituted' as const,
          mass_value: '8',
          mass_unit: 'mg' as const,
          final_volume_ml: '2',
          prepared_date: '2026-11-15',
        },
      };
      const review = await reviewPreparationCorrection(
        owner,
        prepared.id,
        input
      );
      const before = await mark();
      await commitPreparationCorrection(owner, prepared.id, {
        ...input,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      const rows = (await since(before)).filter(
        (r) => r.entity_kind === 'vial'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'edit',
        entity_id: prepared.id,
        actor_user_id: owner,
      });
      expect(Number(rows[0].old_values!.concentration_mg_ml)).toBe(5);
      expect(Number(rows[0].new_values!.concentration_mg_ml)).toBe(4);
      for (const key of VIAL_BOOKKEEPING) {
        expect(rows[0].old_values).not.toHaveProperty(key);
        expect(rows[0].new_values).not.toHaveProperty(key);
      }

      // status with a deliberate intent: the existing ledger row, no vial row
      const ledger = () =>
        count(
          'SELECT count(*)::int n FROM medication_stock_status_audit WHERE pen_id=$1',
          [prepared.id]
        );
      const rowsBefore = (await auditOf(prepared.id)).length;
      expect(await ledger()).toBe(0);
      await stock.updatePen(owner, prepared.id, {
        status: 'discarded',
        lifecycle_intent: true,
      });
      expect(await ledger()).toBe(1);
      expect((await penRow(prepared.id)).status).toBe('discarded');
      expect(await auditOf(prepared.id)).toHaveLength(rowsBefore);
    });

    it('5. an invoice: create, edit (a changed line, an unchanged line, a removed line), reorder, delete', async () => {
      const med = await medication('Synthetic invoice audit');
      const linked = await vial(med, { label: 'Synthetic linked vial' });
      let before = await mark();
      const invoice = await purchases.createPurchase(
        owner,
        create(
          [
            line(med, 'Synthetic line one', { vial_ids: [linked.id] }),
            line(med, 'Synthetic line two'),
            consumable('Synthetic needles'),
          ],
          { vendor: 'Synthetic vendor', shipping_cost: '4.50' }
        )
      );
      let rows = await since(before);
      expect(kinds(rows)).toEqual([
        'purchase:create',
        'purchase_item:create',
        'purchase_item:create',
        'purchase_item:create',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      const header = rows.find((r) => r.entity_kind === 'purchase')!;
      expect(header).toMatchObject({
        entity_id: invoice.id,
        parent_id: null,
        medication_id: null,
        actor_user_id: owner,
      });
      expect(header.new_values).toMatchObject({
        vendor: 'Synthetic vendor',
        currency: 'AUD',
        shipping_cost: expect.stringMatching(/^4\.5/),
      });
      for (const key of ['id', 'user_id', 'created_at', 'revision'])
        expect(header.new_values).not.toHaveProperty(key);
      const lines = rows.filter((r) => r.entity_kind === 'purchase_item');
      expect(lines.every((r) => r.parent_id === invoice.id)).toBe(true);
      expect(lines.map((r) => r.entity_id).sort()).toEqual(
        invoice.items.map((i) => i.id).sort()
      );
      expect(
        lines.find((r) => r.entity_id === invoice.items[0]!.id)!.medication_id
      ).toBe(med);
      expect(
        lines.find((r) => r.entity_id === invoice.items[2]!.id)!.medication_id
      ).toBeNull();
      for (const l of lines) {
        expect(l.new_values).not.toHaveProperty('sort_index');
        expect(l.new_values).not.toHaveProperty('id');
        expect(typeof l.new_values!.unit_cost).toBe('string');
      }
      // the vial link is not audited
      expect(rows.some((r) => JSON.stringify(r).includes(linked.id))).toBe(
        false
      );

      // line one changes, line two is re-sent unchanged, the needles are removed
      before = await mark();
      const [one, two, needles] = invoice.items;
      const edited = await purchases.updatePurchase(
        owner,
        invoice.id,
        update(invoice, {
          shipping_cost: '5',
          items: [
            { ...one!, category: undefined, quantity: 5 },
            { ...two!, category: undefined },
          ],
        })
      );
      rows = await since(before);
      expect(kinds(rows)).toEqual([
        'purchase:edit',
        'purchase_item:delete',
        'purchase_item:edit',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      const headerEdit = rows.find((r) => r.entity_kind === 'purchase')!;
      expect(Object.keys(headerEdit.new_values!)).toEqual(['shipping_cost']);
      expect(Number(headerEdit.old_values!.shipping_cost)).toBe(4.5);
      expect(Number(headerEdit.new_values!.shipping_cost)).toBe(5);
      const lineEdit = rows.find(
        (r) => r.action === 'edit' && r.entity_kind === 'purchase_item'
      )!;
      expect(lineEdit.entity_id).toBe(one!.id);
      expect(lineEdit.parent_id).toBe(invoice.id);
      expect(Number(lineEdit.old_values!.quantity)).toBe(2);
      expect(Number(lineEdit.new_values!.quantity)).toBe(5);
      expect(Object.keys(lineEdit.new_values!)).toEqual(['quantity']);
      const removed = rows.find((r) => r.action === 'delete')!;
      expect(removed.entity_id).toBe(needles!.id);
      expect(removed.old_values).toMatchObject({
        description: 'Synthetic needles',
      });
      expect(removed.new_values).toBeNull();
      expect(rows.some((r) => r.entity_id === two!.id)).toBe(false);

      // links removed, lines reordered, nothing else changed: the revision and sort order are bookkeeping
      before = await mark();
      const reordered = await purchases.updatePurchase(
        owner,
        invoice.id,
        update(edited, {
          items: [
            { ...edited.items[1]!, category: undefined },
            { ...edited.items[0]!, category: undefined, vial_ids: [] },
          ],
        })
      );
      expect(reordered.revision).toBe(edited.revision + 1);
      expect(reordered.items.map((i) => i.id)).toEqual([
        edited.items[1]!.id,
        edited.items[0]!.id,
      ]);
      expect(await since(before)).toEqual([]);

      // delete: the invoice and every line, with their old values
      before = await mark();
      await purchases.deletePurchase(owner, invoice.id, {
        expected_owner_id: owner,
        expected_revision: reordered.revision,
      });
      rows = await since(before);
      expect(kinds(rows)).toEqual([
        'purchase:delete',
        'purchase_item:delete',
        'purchase_item:delete',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      expect(
        rows.find((r) => r.entity_kind === 'purchase')!.old_values
      ).toMatchObject({ vendor: 'Synthetic vendor' });
      // the vial stays
      expect(
        await count('SELECT count(*)::int n FROM medication_pens WHERE id=$1', [
          linked.id,
        ])
      ).toBe(1);
    });

    it('6. a prescription: create (1 + n rows), edit, add and remove coverage, reorder (no row), delete with its coverage and vial unlink', async () => {
      const a = await medication('Synthetic Rx audit A');
      const b = await medication('Synthetic Rx audit B');
      const c = await medication('Synthetic Rx audit C');
      let before = await mark();
      const made = await h.create([a, b], { cost: '30', status: 'active' });
      let rows = await since(before);
      expect(kinds(rows)).toEqual([
        'prescription:create',
        'prescription_medicine:create',
        'prescription_medicine:create',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      const head = rows.find((r) => r.entity_kind === 'prescription')!;
      expect(head).toMatchObject({
        entity_id: made.id,
        parent_id: null,
        // the mirror of the first covered medicine
        medication_id: a,
        actor_user_id: owner,
      });
      for (const key of ['version', 'medication_id', 'created_at', 'id'])
        expect(head.new_values).not.toHaveProperty(key);
      expect(head.new_values).toMatchObject({
        cost: expect.stringMatching(/^30/),
        currency: 'AUD',
        status: 'active',
      });
      expect(head.new_values).toHaveProperty('cost_basis');
      const covers = rows.filter(
        (r) => r.entity_kind === 'prescription_medicine'
      );
      expect(covers.every((r) => r.parent_id === made.id)).toBe(true);
      expect(covers.map((r) => r.medication_id).sort()).toEqual([a, b].sort());
      expect(covers[0]!.new_values).toHaveProperty('medication_name_snapshot');
      expect(covers[0]!.new_values).not.toHaveProperty('position');

      // an edit of one public field
      before = await mark();
      await h.edit(made.id, { refills_remaining: 3 });
      rows = await since(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'edit',
        entity_kind: 'prescription',
        old_values: { refills_remaining: null },
        new_values: { refills_remaining: '3' },
      });

      // add C: one coverage create (the position fix-up after it writes nothing)
      before = await mark();
      await h.edit(made.id, { medication_ids: [a, b, c] });
      rows = await since(before);
      expect(kinds(rows)).toEqual(['prescription_medicine:create']);
      expect(rows[0]).toMatchObject({ parent_id: made.id, medication_id: c });

      // reorder, which also moves the primary medicine and so the mirror: no row at all
      before = await mark();
      await h.edit(made.id, { medication_ids: [c, a, b] });
      expect(await h.mirror(made.id)).toBe(c);
      expect(await since(before)).toEqual([]);

      // remove B: one coverage delete
      before = await mark();
      await h.edit(made.id, { medication_ids: [c, a] });
      rows = await since(before);
      expect(kinds(rows)).toEqual(['prescription_medicine:delete']);
      expect(rows[0]).toMatchObject({ medication_id: b, parent_id: made.id });
      expect(rows[0].old_values).toHaveProperty('medication_name_snapshot');

      // delete: the prescription, each coverage row, and the linked vial's unlink
      const linked = await h.stock(c, made.id);
      expect((await auditOf(linked.id))[0].new_values).toMatchObject({
        prescription_id: made.id,
      });
      before = await mark();
      await deleteRx(made.id);
      rows = await since(before);
      expect(kinds(rows)).toEqual([
        'prescription:delete',
        'prescription_medicine:delete',
        'prescription_medicine:delete',
        'vial:edit',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      const unlink = rows.find((r) => r.entity_kind === 'vial')!;
      expect(unlink).toMatchObject({
        entity_id: linked.id,
        old_values: { prescription_id: made.id },
        new_values: { prescription_id: null },
      });
      expect(
        rows.find((r) => r.entity_kind === 'prescription')!.new_values
      ).toBeNull();
    });

    it('7. coverage sync writes no row, and an old-server insert writes its one coverage row at commit', async () => {
      const a = await medication('Synthetic sync A');
      const b = await medication('Synthetic sync B');
      const made = await h.create([a, b]);
      // the sync trigger moved the mirror; the audit saw only the three real inserts
      expect(await h.mirror(made.id)).toBe(a);
      expect(
        (await auditOf(made.id)).concat(await auditOf(a), await auditOf(b))
      ).toHaveLength(1);
      expect(
        (await allRows()).filter(
          (r) =>
            r.entity_kind === 'prescription_medicine' && r.parent_id === made.id
        )
      ).toHaveLength(2);

      // a raw reorder of the coverage rows writes nothing either
      let before = await mark();
      await h.sql((client) =>
        client.query(
          'UPDATE medication_prescription_medications SET position=position+10 WHERE prescription_id=$1',
          [made.id]
        )
      );
      expect(await since(before)).toEqual([]);
      // a reorder through the repository moves the primary medicine, so the sync trigger rewrites the mirror
      before = await mark();
      await h.edit(made.id, { medication_ids: [b, a] });
      expect(await h.mirror(made.id)).toBe(b);
      expect(await since(before)).toEqual([]);

      // an older server inserts only the prescription; the deferred repair trigger adds the coverage at commit
      const solo = await medication('Synthetic old server');
      before = await mark();
      const old = await h.actor(owner, () =>
        legacy.createMedicationPrescription(owner, {
          medication_id: solo,
          operation_id: randomUUID(),
          currency: 'AUD',
          cost: '4',
        } as never)
      );
      const rows = await since(before);
      expect(kinds(rows)).toEqual([
        'prescription:create',
        'prescription_medicine:create',
      ]);
      expect(new Set(rows.map((r) => r.tx_id)).size).toBe(1);
      expect(
        rows.find((r) => r.entity_kind === 'prescription_medicine')
      ).toMatchObject({ parent_id: old.id, medication_id: solo });
    });

    it('8. a re-save of identical private text lists the encrypted fields as changed; the old envelope decrypts with the app key', async () => {
      const med = await medication('Synthetic private text');
      const made = await h.create([med], {
        prescriber: 'Dr Synthetic Prescriber',
        pharmacy: 'Synthetic Pharmacy',
      });
      const createRow = (await auditOf(made.id))[0];
      const first = createRow.new_values!.prescriber_encrypted as Envelope;
      expect(JSON.stringify(createRow)).not.toContain('Synthetic Prescriber');
      expect(createRow.new_values).toHaveProperty('source_encrypted', null);

      const before = await mark();
      await h.edit(made.id, {
        prescriber: 'Dr Synthetic Prescriber',
        pharmacy: 'Synthetic Pharmacy',
      });
      const rows = await since(before);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].new_values!).sort()).toEqual([
        'pharmacy_encrypted',
        'prescriber_encrypted',
      ]);
      const oldEnvelope = rows[0].old_values!.prescriber_encrypted as Envelope;
      const newEnvelope = rows[0].new_values!.prescriber_encrypted as Envelope;
      expect(oldEnvelope).toEqual(first);
      // a random IV: same text, different bytes
      expect(newEnvelope.iv).not.toBe(oldEnvelope.iv);
      expect(newEnvelope.encryptedText).not.toBe(oldEnvelope.encryptedText);
      const plain = async (e: Envelope) =>
        decrypt(e.encryptedText, e.iv, e.tag, ENCRYPTION_KEY);
      expect(await plain(oldEnvelope)).toBe('Dr Synthetic Prescriber');
      expect(await plain(newEnvelope)).toBe('Dr Synthetic Prescriber');
      expect(
        await plain(rows[0].old_values!.pharmacy_encrypted as Envelope)
      ).toBe('Synthetic Pharmacy');
      // a save that does not send the private fields does not list them
      const quiet = await mark();
      await h.edit(made.id, { refills_remaining: 1 });
      const quietRows = await since(quiet);
      expect(quietRows).toHaveLength(1);
      expect(Object.keys(quietRows[0].new_values!)).toEqual([
        'refills_remaining',
      ]);

      // invoices: with a reference or note the header lists them on every save, without them it writes nothing
      const withText = await purchases.createPurchase(
        owner,
        create([consumable('Synthetic text line')], {
          reference: 'Synthetic private reference',
          notes: 'Synthetic private note',
        })
      );
      const created = (await auditOf(withText.id))[0];
      expect(JSON.stringify(created)).not.toContain('Synthetic private');
      const mark2 = await mark();
      await purchases.updatePurchase(owner, withText.id, update(withText));
      const headerRows = (await since(mark2)).filter(
        (r) => r.entity_kind === 'purchase'
      );
      expect(headerRows).toHaveLength(1);
      expect(Object.keys(headerRows[0].new_values!).sort()).toEqual([
        'notes_encrypted',
        'reference_encrypted',
      ]);
      const oldRef = headerRows[0].old_values!.reference_encrypted as Envelope;
      expect(await plain(oldRef)).toBe('Synthetic private reference');
      expect(
        await plain(headerRows[0].old_values!.notes_encrypted as Envelope)
      ).toBe('Synthetic private note');
      const bare = await purchases.createPurchase(
        owner,
        create([consumable('Synthetic bare line')])
      );
      const mark3 = await mark();
      await purchases.updatePurchase(owner, bare.id, update(bare));
      expect(await since(mark3)).toEqual([]);
    });

    it('9. the actor is the owner, the caregiver acting for them, or NULL on the owner pool', async () => {
      const med = await medication('Synthetic actor medicine');
      const insert = (c: PoolClient) =>
        c.query(
          "INSERT INTO medication_pens(user_id,medication_id,kind,label) VALUES($1,$2,'vial','Synthetic actor vial') RETURNING id",
          [owner, med]
        );
      const own = await h.sql(insert);
      const forOwner = await asApp(owner, caregiver, insert);
      const system = await admin(insert);
      const actors = async (id: string) =>
        (await auditOf(id)).map((r) => r.actor_user_id);
      expect(await actors(own.rows[0].id)).toEqual([owner]);
      expect(await actors(forOwner.rows[0].id)).toEqual([caregiver]);
      expect(await actors(system.rows[0].id)).toEqual([null]);
      // user_id is still the owner for the caregiver's row
      expect((await auditOf(forOwner.rows[0].id))[0].user_id).toBe(owner);
      await asApp(owner, caregiver, async (c) => {
        await c.query(
          "UPDATE medication_pens SET label='by caregiver' WHERE id=$1",
          [forOwner.rows[0].id]
        );
        await c.query('DELETE FROM medication_pens WHERE id=$1', [
          forOwner.rows[0].id,
        ]);
      });
      expect(await actors(forOwner.rows[0].id)).toEqual([
        caregiver,
        caregiver,
        caregiver,
      ]);
    });

    it('10. a failing audit insert rolls the invoice, prescription and vial saves back whole and leaves no receipt', async () => {
      const med = await medication('Synthetic fail-closed medicine');
      const existing = await purchases.createPurchase(
        owner,
        create([line(med, 'Synthetic kept line')])
      );
      const penToEdit = await vial(med, { label: 'Synthetic kept vial' });
      const prescription = await h.create([med]);
      const purchaseOp = randomUUID();
      const rxOp = randomUUID();
      const receipts = () =>
        count(
          `SELECT (SELECT count(*) FROM medication_purchase_operations WHERE operation_id=$1)::int
                + (SELECT count(*) FROM medication_prescription_operations WHERE operation_id=$2)::int AS n`,
          [purchaseOp, rxOp]
        );
      const counts = () =>
        admin(
          async (c) =>
            (
              await c.query(
                `SELECT (SELECT count(*) FROM medication_purchases WHERE user_id=$1)::int purchases,
                      (SELECT count(*) FROM medication_purchase_items WHERE user_id=$1)::int items,
                      (SELECT count(*) FROM medication_prescriptions WHERE user_id=$1)::int prescriptions,
                      (SELECT count(*) FROM medication_prescription_medications WHERE user_id=$1)::int coverage,
                      (SELECT count(*) FROM medication_pens WHERE user_id=$1)::int pens`,
                [owner]
              )
            ).rows[0]
        );
      const baseline = await counts();
      const auditBefore = await mark();
      const newInvoice = {
        ...create([line(med, 'Synthetic failing line')], {
          vendor: 'Synthetic failing vendor',
        }),
        operation_id: purchaseOp,
      };
      const newPrescription = h.input([med], { operation_id: rxOp, cost: '9' });
      await forceFailure(true);
      try {
        await expect(
          purchases.createPurchase(owner, newInvoice)
        ).rejects.toThrow(/zz_force_audit_failure/);
        await expect(
          purchases.updatePurchase(
            owner,
            existing.id,
            update(existing, { vendor: 'Synthetic changed vendor' })
          )
        ).rejects.toThrow(/zz_force_audit_failure/);
        await expect(
          rx.createMedicationPrescription(owner, newPrescription)
        ).rejects.toThrow(/zz_force_audit_failure/);
        await expect(
          h.edit(prescription.id, { refills_remaining: 9 })
        ).rejects.toThrow(/zz_force_audit_failure/);
        await expect(
          vial(med, { label: 'Synthetic failing vial' })
        ).rejects.toThrow(/zz_force_audit_failure/);
        await expect(
          stock.updatePen(owner, penToEdit.id, { label: 'Synthetic changed' })
        ).rejects.toThrow(/zz_force_audit_failure/);
      } finally {
        await forceFailure(false);
      }
      // nothing of any save is left: no rows, no receipt, no changed value, no audit row
      expect(await counts()).toEqual(baseline);
      expect(await receipts()).toBe(0);
      expect(
        (await purchases.getPurchase(owner, existing.id))!.vendor
      ).not.toBe('Synthetic changed vendor');
      expect(
        await count(
          'SELECT count(*)::int n FROM medication_pens WHERE id=$1 AND label=$2',
          [penToEdit.id, 'Synthetic kept vial']
        )
      ).toBe(1);
      expect((await h.read(prescription.id)).refills_remaining).not.toBe(9);
      expect(await since(auditBefore)).toEqual([]);

      // the same requests work now, because no receipt was kept
      const retried = await purchases.createPurchase(owner, newInvoice);
      expect(retried.vendor).toBe('Synthetic failing vendor');
      await rx.createMedicationPrescription(owner, newPrescription);
      expect(await receipts()).toBe(2);
      expect((await since(auditBefore)).length).toBeGreaterThan(0);
    });

    it('11. nobody can write, change or remove audit rows directly; only the owner reads them', async () => {
      const med = await medication('Synthetic append-only medicine');
      const made = await vial(med);
      const [row] = await auditOf(made.id);
      expect(row).toBeDefined();
      const rowId = (
        await admin((c) =>
          c.query('SELECT id FROM medication_change_audit WHERE entity_id=$1', [
            made.id,
          ])
        )
      ).rows[0].id;
      const attempt = async (
        actor: string | undefined,
        sql: string,
        params: unknown[]
      ) =>
        asApp(owner, actor, async (c) => {
          await c.query('BEGIN');
          try {
            const res = await c.query(sql, params);
            return { ok: true, rowCount: res.rowCount ?? 0 };
          } catch (error) {
            return { ok: false, message: (error as Error).message };
          } finally {
            await c.query('ROLLBACK');
          }
        });
      const insert =
        "INSERT INTO medication_change_audit (user_id,entity_kind,entity_id,action,new_values) VALUES ($1,'vial',$2,'create','{}'::jsonb)";
      for (const actor of [undefined, caregiver, reportsOnly]) {
        expect(
          await attempt(actor, insert, [owner, randomUUID()])
        ).toMatchObject({
          ok: false,
          message: expect.stringMatching(/written by the database only/),
        });
      }
      // the owner reaches the immutability guard on UPDATE and DELETE
      for (const sql of [
        "UPDATE medication_change_audit SET action='delete' WHERE id=$1",
        "UPDATE medication_change_audit SET new_values='{}'::jsonb WHERE id=$1",
        'DELETE FROM medication_change_audit WHERE id=$1',
      ])
        expect(await attempt(undefined, sql, [rowId])).toMatchObject({
          ok: false,
          message: expect.stringMatching(/immutable/),
        });
      // a caregiver, even one who may manage medications, cannot see the row, so changes touch nothing
      for (const actor of [caregiver, reportsOnly]) {
        expect(
          await attempt(
            actor,
            "UPDATE medication_change_audit SET action='delete' WHERE id=$1",
            [rowId]
          )
        ).toEqual({ ok: true, rowCount: 0 });
        expect(
          await attempt(
            actor,
            'DELETE FROM medication_change_audit WHERE id=$1',
            [rowId]
          )
        ).toEqual({ ok: true, rowCount: 0 });
      }
      const read = (actor: string | undefined) =>
        asApp(
          owner,
          actor,
          async (c) =>
            (
              await c.query(
                'SELECT id FROM medication_change_audit WHERE id=$1',
                [rowId]
              )
            ).rowCount
        );
      expect(await read(undefined)).toBe(1);
      expect(await read(caregiver)).toBe(0);
      expect(await read(reportsOnly)).toBe(0);
      // nothing moved
      expect((await auditOf(made.id))[0]).toEqual(row);
    });

    it('12. deleting an account removes its vials, invoices, prescriptions and audit rows without error', async () => {
      const [first, second] = doomed;
      await admin(async (c) => {
        for (const user of doomed) {
          const med = (
            await c.query(
              "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic doomed','injection') RETURNING id",
              [user]
            )
          ).rows[0].id;
          await c.query(
            "INSERT INTO medication_pens(user_id,medication_id,kind,label) VALUES($1,$2,'vial','doomed')",
            [user, med]
          );
          await c.query(
            "UPDATE medication_pens SET label='edited' WHERE user_id=$1",
            [user]
          );
          const purchase = (
            await c.query(
              "INSERT INTO medication_purchases(user_id,ordered_date,currency) VALUES($1,'2026-11-15','AUD') RETURNING id",
              [user]
            )
          ).rows[0].id;
          await c.query(
            "INSERT INTO medication_purchase_items(user_id,purchase_id,kind,medication_id,description,quantity,unit_cost,sort_index) VALUES($1,$2,'medication',$3,'doomed line',1,5,0)",
            [user, purchase, med]
          );
          await c.query(
            "INSERT INTO medication_prescriptions(user_id,medication_id,medication_name_snapshot) VALUES($1,$2,'Synthetic doomed')",
            [user, med]
          );
        }
      });
      expect(await allRows(first)).not.toHaveLength(0);
      expect(new Set((await allRows(first)).map((r) => r.entity_kind))).toEqual(
        new Set([
          'vial',
          'purchase',
          'purchase_item',
          'prescription',
          'prescription_medicine',
        ])
      );
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [first])
      );
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [second])
      );
      const left = await admin((c) =>
        c.query(
          `SELECT (SELECT count(*) FROM medication_change_audit WHERE user_id=ANY($1::uuid[]))::int a,
                  (SELECT count(*) FROM medication_pens WHERE user_id=ANY($1::uuid[]))::int p,
                  (SELECT count(*) FROM medication_purchases WHERE user_id=ANY($1::uuid[]))::int u,
                  (SELECT count(*) FROM medication_prescriptions WHERE user_id=ANY($1::uuid[]))::int r`,
          [doomed]
        )
      );
      expect(left.rows[0]).toEqual({ a: 0, p: 0, u: 0, r: 0 });
    });

    it('13. deleting a medicine that only has invoice lines unassigns the line, and the line edit is recorded', async () => {
      const med = await medication('Synthetic invoice-only medicine');
      const invoice = await purchases.createPurchase(
        owner,
        create([line(med, 'Synthetic orphaned line')])
      );
      const before = await mark();
      expect(await medications.deleteMedication(owner, med)).toBe(true);
      const rows = await since(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'edit',
        entity_kind: 'purchase_item',
        entity_id: invoice.items[0]!.id,
        parent_id: invoice.id,
        actor_user_id: owner,
        old_values: { medication_id: med },
        new_values: { medication_id: null },
      });
      // the invoice and its line survive
      expect(
        (await purchases.getPurchase(owner, invoice.id))!.items[0]!.description
      ).toBe('Synthetic orphaned line');
    });

    it('14. two concurrent invoice saves: the winner is audited once, the loser leaves nothing', async () => {
      const med = await medication('Synthetic concurrent medicine');
      const invoice = await purchases.createPurchase(
        owner,
        create([line(med, 'Synthetic race line')])
      );
      const before = await mark();
      const results = await Promise.allSettled([
        purchases.updatePurchase(
          owner,
          invoice.id,
          update(invoice, { shipping_cost: '11' })
        ),
        purchases.updatePurchase(
          owner,
          invoice.id,
          update(invoice, { shipping_cost: '22' })
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { statusCode: 409 },
      });
      const rows = await since(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'edit',
        entity_kind: 'purchase',
      });
      const stored = (await purchases.getPurchase(owner, invoice.id))!;
      expect(Number(rows[0].new_values!.shipping_cost)).toBe(
        Number(stored.shipping_cost)
      );

      // two creates at once both succeed, each its own transaction
      const mid = await mark();
      const both = await Promise.all([
        purchases.createPurchase(
          owner,
          create([consumable('Synthetic race A')])
        ),
        purchases.createPurchase(
          owner,
          create([consumable('Synthetic race B')])
        ),
      ]);
      const created = await since(mid);
      expect(created).toHaveLength(4);
      expect(new Set(created.map((r) => r.tx_id)).size).toBe(2);
      for (const p of both)
        expect(
          created.filter((r) => r.entity_id === p.id || r.parent_id === p.id)
        ).toHaveLength(2);
    });

    it('15. timing smoke: 1,000 vial inserts with and without the trigger (printed, not a gate)', async () => {
      const med = await medication('Synthetic timing medicine');
      const run = async () =>
        admin(async (c) => {
          const started = performance.now();
          await c.query(
            `INSERT INTO medication_pens (user_id,medication_id,kind,label)
             SELECT $1,$2,'vial','timing '||g FROM generate_series(1,1000) g`,
            [owner, med]
          );
          return performance.now() - started;
        });
      let without: number;
      await admin((c) =>
        c.query(
          'ALTER TABLE public.medication_pens DISABLE TRIGGER medication_change_audit_vial_write'
        )
      );
      try {
        without = await run();
      } finally {
        await admin((c) =>
          c.query(
            'ALTER TABLE public.medication_pens ENABLE TRIGGER medication_change_audit_vial_write'
          )
        );
      }
      const withTrigger = await run();
      const audited = await count(
        "SELECT count(*)::int n FROM medication_change_audit WHERE user_id=$1 AND new_values->>'label' LIKE 'timing %'",
        [owner]
      );
      // only the second batch was audited
      expect(audited).toBe(1000);
      console.log(
        `change audit timing: 1000 vial inserts without trigger ${without.toFixed(0)} ms, with trigger ${withTrigger.toFixed(0)} ms, ratio ${(withTrigger / without).toFixed(2)}`
      );
    }, 60_000);
  }
);
