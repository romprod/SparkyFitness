import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  medicationPrescriptionCreateSchema,
  type MedicationPrescriptionCreate,
  type MedicationPrescriptionUpdate,
} from '@workspace/shared';
import {
  dbContextStorage,
  endPool,
  getClient,
  getSystemClient,
} from '../db/poolManager.js';
import * as rx from '../models/medicationPrescriptionRepository.js';
import * as pens from '../models/medicationPenRepository.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import {
  getMedicationCostAnalytics,
  getMedicationPrescriptionVialCosts,
  loadMedicationPrescriptionFinancialSnapshot,
} from '../models/medicationCostAnalyticsRepository.js';
import { createMedicationCourse } from '../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

// Release alone executes this bounded fixture in its fresh isolated PostgreSQL gate.
describe.runIf(
  process.env.MEDICATION_PRESCRIPTION_COST_ESTIMATES_INTEGRATION === '1'
)('explicit prescription per-vial cost provenance PostgreSQL', () => {
  const owner = randomUUID(),
    other = randomUUID(),
    delegate = randomUUID(),
    now = new Date('2026-11-17T12:00:00Z');
  const actor = <T>(who: string, fn: () => Promise<T>) =>
    dbContextStorage.run({ authenticatedUserId: who }, fn);
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
      for (const id of [owner, other, delegate])
        await c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [id, `synthetic-rx-cost-${id}@example.test`]
        );
      await c.query(
        "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_manage_medications\":true}'::jsonb,$3,'active')",
        [owner, delegate, `synthetic-${delegate}@example.test`]
      );
    });
  });
  afterAll(async () => {
    await admin((c) =>
      c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
        [owner, other, delegate],
      ])
    );
    await endPool();
  });
  const medication = async (who = owner) =>
    admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            "INSERT INTO medications(user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,'Synthetic cost basis medication','injection','subcutaneous',1,'mg',false) RETURNING id",
            [who]
          )
        ).rows[0]!.id
    );
  const input = (
    medication_id: string,
    patch: Partial<MedicationPrescriptionCreate> = {}
  ) =>
    medicationPrescriptionCreateSchema.parse({
      medication_id,
      operation_id: randomUUID(),
      ...patch,
    });
  const create = (
    med: string,
    patch: Partial<MedicationPrescriptionCreate> = {}
  ) => rx.createMedicationPrescription(owner, input(med, patch));
  const edit = async (
    id: string,
    patch: Omit<
      MedicationPrescriptionUpdate,
      'operation_id' | 'expected_version'
    >
  ) =>
    rx.updateMedicationPrescription(owner, id, {
      ...patch,
      operation_id: randomUUID(),
      expected_version: (await rx.getMedicationPrescription(owner, id)).version,
    });
  const stock = (med: string, prescription_id?: string | null) =>
    pens.createPen(owner, med, {
      kind: 'vial',
      label: 'Synthetic cost stock',
      label_mass_mg: '10',
      concentration_mg_ml: 1,
      volume_ml: 10,
      ...(prescription_id === undefined ? {} : { prescription_id }),
    });
  const basis = async (id: string) =>
    admin(
      async (c) =>
        (
          await c.query<{ cost_basis: string | null }>(
            'SELECT cost_basis FROM medication_prescriptions WHERE id=$1',
            [id]
          )
        ).rows[0]!.cost_basis
    );
  const rawRows = async (table: string) =>
    admin(
      async (c) =>
        (
          await c.query(
            `SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY to_jsonb(t)::text`,
            [owner]
          )
        ).rows
    );
  const unchangedFacts = async () => {
    const out: Record<string, unknown> = {};
    for (const t of [
      'medications',
      'medication_prescriptions',
      'medication_pens',
      'medication_preparations',
      'injection_entries',
      'medication_entries',
      'medication_purchases',
      'medication_purchase_items',
      'medication_purchase_vials',
      'medication_courses',
      'medication_course_revisions',
    ])
      out[t] = await rawRows(t);
    return out;
  };
  const strippedPhysical = async () =>
    admin(
      async (c) =>
        (
          await c.query(
            "SELECT to_jsonb(t)-'prescription_id'-'updated_at' AS row FROM medication_pens t WHERE user_id=$1 ORDER BY id",
            [owner]
          )
        ).rows
    );
  const financialRead = async () => {
    const c = await getClient(owner);
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await loadMedicationPrescriptionFinancialSnapshot(
        c,
        owner
      );
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  };
  const analytics = () =>
    getMedicationCostAnalytics(
      owner,
      'all',
      now,
      'with_prescription_estimates'
    );
  const prices = () => getMedicationPrescriptionVialCosts(owner);

  it('replays nullable basis DDL without backfill or changes to old Rx, physical and invoice facts', async () => {
    const med = await medication(),
      legacy = await create(med, { cost: '17.50', quantity: 2 });
    await stock(med, legacy.id);
    const beforeRx = await rawRows('medication_prescriptions'),
      before = await unchangedFacts(),
      migration = await readFile(
        new URL(
          '../db/migrations/20261117140000_medication_prescription_cost_basis.sql',
          import.meta.url
        ),
        'utf8'
      );
    await admin(async (c) => {
      await c.query(migration);
      await c.query(migration);
    });
    expect(await rawRows('medication_prescriptions')).toEqual(beforeRx);
    expect(await unchangedFacts()).toEqual(before);
    expect(await basis(legacy.id)).toBeNull();
    expect(
      await rx.getMedicationPrescription(owner, legacy.id)
    ).not.toHaveProperty('cost_basis');
  });
  it('confirms only explicit known per-vial cost and preserves semantic old omissions while changed or cleared money invalidates provenance', async () => {
    const med = await medication(),
      record = await create(med, { cost: '10', currency: 'GBP' });
    await edit(record.id, { pharmacy: 'Synthetic unrelated edit' });
    expect(await basis(record.id)).toBeNull();
    await edit(record.id, { cost: '10.00', cost_basis: 'per_vial' });
    expect(await basis(record.id)).toBe('per_vial');
    await edit(record.id, { cost: '10.000', currency: ' GBP ', quantity: 2 });
    expect(await basis(record.id)).toBe('per_vial');
    await edit(record.id, { cost: '11' });
    expect(await basis(record.id)).toBeNull();
    await edit(record.id, { cost: '11', cost_basis: 'per_vial' });
    await edit(record.id, { currency: 'EUR' });
    expect(await basis(record.id)).toBeNull();
    await edit(record.id, { cost: '11', cost_basis: 'per_vial' });
    await edit(record.id, { cost: null });
    expect(await basis(record.id)).toBeNull();
    expect(
      (await rx.getMedicationPrescription(owner, record.id)).cost
    ).toBeNull();
    await edit(record.id, { cost: '0', cost_basis: 'per_vial' });
    expect(await rx.getMedicationPrescription(owner, record.id)).toMatchObject({
      cost: '0',
      cost_basis: 'per_vial',
    });
    const zeroVial = await stock(med, record.id);
    expect(
      (await prices()).vials.find((v) => v.pen_id === zeroVial.id)
    ).toMatchObject({
      is_costed: true,
      cost_source: 'prescription',
      unit_cost: '0',
    });
    await edit(record.id, { cost_basis: null });
    expect(await basis(record.id)).toBeNull();
    expect(
      (await prices()).vials.find((v) => v.pen_id === zeroVial.id)
    ).toMatchObject({ is_costed: false, cost_source: null, unit_cost: null });
    expect((await rx.getMedicationPrescription(owner, record.id)).cost).toBe(
      '0'
    );
  });
  it('keeps cost-basis intent in idempotency receipts and rejects stale confirmation without changing the saved cost', async () => {
    const med = await medication(),
      request = input(med, { cost: '0', cost_basis: 'per_vial' }),
      results = await Promise.all([
        rx.createMedicationPrescription(owner, request),
        rx.createMedicationPrescription(owner, request),
      ]);
    expect(results[1]).toEqual(results[0]);
    await expect(
      rx.createMedicationPrescription(owner, { ...request, cost_basis: null })
    ).rejects.toMatchObject({ statusCode: 409 });
    const id = results[0]!.id,
      patch = {
        operation_id: randomUUID(),
        expected_version: 1,
        cost: '2',
        cost_basis: 'per_vial' as const,
      },
      saved = await rx.updateMedicationPrescription(owner, id, patch);
    expect(await rx.updateMedicationPrescription(owner, id, patch)).toEqual(
      saved
    );
    await expect(
      rx.updateMedicationPrescription(owner, id, {
        operation_id: randomUUID(),
        expected_version: 1,
        cost: '3',
        cost_basis: 'per_vial',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await rx.getMedicationPrescription(owner, id)).toMatchObject({
      cost: '2',
      cost_basis: 'per_vial',
      version: 2,
    });
  });
  it('loads only linked same-owner medication financial facts in one supplied-client read-only RR snapshot and rejects delegated financial reads', async () => {
    const med = await medication(),
      record = await create(med, {
        cost: '10',
        cost_basis: 'per_vial',
        source: 'Synthetic clinical source',
        prescriber: 'Synthetic private prescriber',
        pharmacy: 'Synthetic private pharmacy',
        dose_instructions: 'Synthetic private instructions',
      }),
      pen = await stock(med, record.id),
      courseOnly = await create(med, { cost: '90', cost_basis: 'per_vial' });
    await createMedicationCourse(
      owner,
      {
        ...medicationCoursePlanFixture(),
        medication_id: med,
        prescription_id: courseOnly.id,
        expected_version: 0,
        operation_id: randomUUID(),
        native_reminder_limitation_acknowledged: false,
      },
      now
    );
    const foreignMed = await medication(other),
      foreign = await actor(other, () =>
        rx.createMedicationPrescription(
          other,
          input(foreignMed, { cost: '900', cost_basis: 'per_vial' })
        )
      );
    await actor(other, () =>
      pens.createPen(other, foreignMed, {
        kind: 'vial',
        label_mass_mg: '10',
        prescription_id: foreign.id,
      })
    );
    const before = await unchangedFacts(),
      c = await getClient(owner);
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const first = await loadMedicationPrescriptionFinancialSnapshot(c, owner);
      const selected = first.prescriptions.find((r) => r.id === record.id)!;
      expect(Object.keys(selected).sort()).toEqual(
        [
          'id',
          'medication_id',
          'cost',
          'currency',
          'date_written',
          'cost_basis',
        ].sort()
      );
      expect(selected).toMatchObject({
        medication_id: med,
        cost: '10',
        cost_basis: 'per_vial',
      });
      expect(
        first.prescriptions.some(
          (r) => r.id === courseOnly.id || r.id === foreign.id
        )
      ).toBe(false);
      expect(JSON.stringify(first)).not.toContain('Synthetic private');
      expect(await unchangedFacts()).toEqual(before);
      await edit(record.id, { cost: '20', cost_basis: 'per_vial' });
      await pens.updatePen(owner, pen.id, { prescription_id: null });
      expect(
        await loadMedicationPrescriptionFinancialSnapshot(c, owner)
      ).toEqual(first);
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const fresh = await financialRead();
    expect(
      fresh.vials.find((v) => v.id === pen.id)?.prescription_id
    ).toBeNull();
    expect(fresh.prescriptions.some((r) => r.id === record.id)).toBe(false);
    await expect(
      actor(delegate, () =>
        getMedicationCostAnalytics(
          owner,
          'all',
          now,
          'with_prescription_estimates'
        )
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(actor(delegate, () => prices())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it('preserves default invoice-only JSON while opt-in echoes its mode and resolves invoice zero before confirmed stock Rx provenance', async () => {
    const med = await medication(),
      record = await create(med, {
        cost: '40',
        currency: 'GBP',
        quantity: 2,
        date_written: '2026-11-01',
        cost_basis: 'per_vial',
      }),
      estimated = await stock(med, record.id),
      invoiced = await stock(med, record.id),
      unlinked = await stock(med);
    await purchases.createPurchase(owner, {
      operation_id: randomUUID(),
      expected_owner_id: owner,
      ordered_date: '2026-11-02',
      currency: 'GBP',
      items: [
        {
          kind: 'medication',
          medication_id: med,
          quantity: 1,
          unit_cost: '0',
          vial_ids: [invoiced.id],
        },
      ],
    });
    const oldAnalytics = await getMedicationCostAnalytics(owner, 'all', now),
      oldVials = await purchases.getVialCosts(owner),
      before = await unchangedFacts();
    const selected = await prices();
    expect(selected.cost_basis).toBe('with_prescription_estimates');
    expect(selected.vials.find((v) => v.pen_id === estimated.id)).toMatchObject(
      {
        is_costed: true,
        cost_source: 'prescription',
        unit_cost: '40',
        currency: 'GBP',
        prescription_id: record.id,
        estimate_basis: 'per_vial',
        purchase_id: null,
        purchase_item_id: null,
      }
    );
    expect(selected.vials.find((v) => v.pen_id === invoiced.id)).toMatchObject({
      is_costed: true,
      cost_source: 'invoice',
      unit_cost: '0',
      prescription_id: null,
      estimate_basis: null,
    });
    expect(selected.vials.find((v) => v.pen_id === unlinked.id)).toMatchObject({
      is_costed: false,
      cost_source: null,
      unit_cost: null,
      prescription_id: null,
    });
    const report = await analytics();
    expect(report.cost_basis).toBe('with_prescription_estimates');
    expect(report.monthly_spend).toEqual(oldAnalytics.monthly_spend);
    expect(report.consumables).toEqual(oldAnalytics.consumables);
    expect(
      report.rows.find((row) => row.medication_id === med)?.accounted
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'GBP',
          invoice_cash: '0.00',
          prescription_estimate: '40.00',
          accounted_total: '40.00',
          estimated_vials: 1,
        }),
      ])
    );
    expect(await getMedicationCostAnalytics(owner, 'all', now)).toEqual(
      oldAnalytics
    );
    expect(await purchases.getVialCosts(owner)).toEqual(oldVials);
    expect(oldAnalytics).not.toHaveProperty('cost_basis');
    expect(await unchangedFacts()).toEqual(before);
  });
  it('reprices current derived estimates after Rx edits, rebinding and deletion without rewriting physical, actual or cash ledger facts', async () => {
    const med = await medication(),
      first = await create(med, {
        cost: '10',
        currency: 'GBP',
        cost_basis: 'per_vial',
      }),
      second = await create(med, {
        cost: '3',
        currency: 'EUR',
        cost_basis: 'per_vial',
      }),
      pen = await stock(med, first.id);
    await admin((c) =>
      c.query(
        "INSERT INTO injection_entries(user_id,medication_id,pen_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,1,'2026-11-17','2026-11-17T08:00:00Z')",
        [owner, med, pen.id]
      )
    );
    const physical = await strippedPhysical(),
      doses = await rawRows('injection_entries'),
      ledger = await rawRows('medication_purchases'),
      lines = await rawRows('medication_purchase_items');
    const price = async () =>
      (await prices()).vials.find((v) => v.pen_id === pen.id)!;
    expect(await price()).toMatchObject({
      cost_source: 'prescription',
      unit_cost: '10',
      currency: 'GBP',
    });
    await edit(first.id, { cost: '12', cost_basis: 'per_vial' });
    expect(await price()).toMatchObject({
      unit_cost: '12',
      prescription_id: first.id,
    });
    await pens.updatePen(owner, pen.id, { prescription_id: second.id });
    expect(await price()).toMatchObject({
      unit_cost: '3',
      currency: 'EUR',
      prescription_id: second.id,
    });
    await rx.deleteMedicationPrescription(owner, second.id, {
      operation_id: randomUUID(),
      expected_version: 1,
    });
    expect(await price()).toMatchObject({
      is_costed: false,
      cost_source: null,
      unit_cost: null,
    });
    expect(await strippedPhysical()).toEqual(physical);
    expect(await rawRows('injection_entries')).toEqual(doses);
    expect(await rawRows('medication_purchases')).toEqual(ledger);
    expect(await rawRows('medication_purchase_items')).toEqual(lines);
  });
});
