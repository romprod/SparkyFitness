import { describe, expect, it } from 'vitest';
import {
  buildMedicationCostAnalytics,
  medicationPrescriptionCreateSchema,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionSchema,
  medicationPrescriptionVialCostsQuerySchema,
  medicationPrescriptionCostAnalyticsQuerySchema,
  medicationPrescriptionVialCostSchema,
  medicationPrescriptionVialCostsSchema,
  medicationPrescriptionCostAnalyticsSchema,
  medicationPrescriptionAccountedBucketSchema,
} from '@workspace/shared';

const id = '50000000-0000-4000-8000-000000000001';
const med = '50000000-0000-4000-8000-000000000002';
const price = () => ({
  pen_id: id,
  is_costed: true,
  cost_source: 'prescription',
  unit_cost: '0',
  currency: 'GBP',
  purchase_id: null,
  purchase_item_id: null,
  prescription_id: id,
  estimate_basis: 'per_vial',
  prescription_date_written: null,
});
const bucket = () => ({
  currency: 'GBP',
  invoice_cash: '0.00',
  prescription_estimate: '12.34',
  accounted_total: '12.34',
  estimated_vials: 1,
  undated_vials: 1,
});
const analytics = () => ({
  ...buildMedicationCostAnalytics({
    today: '2026-11-17',
    medications: [],
    invoices: [],
    vials: [],
    doses: [],
  }),
  cost_basis: 'with_prescription_estimates',
  accounted: [bucket()],
});

describe('confirmed prescription cost read contracts', () => {
  it('does not infer per-vial basis from a legacy cost or unrelated update', () => {
    expect(
      medicationPrescriptionCreateSchema.parse({
        operation_id: id,
        medication_id: med,
        cost: '50',
      })
    ).not.toHaveProperty('cost_basis');
    expect(
      medicationPrescriptionUpdateSchema.parse({
        operation_id: id,
        expected_version: 1,
        pharmacy: 'Saved pharmacy',
      })
    ).not.toHaveProperty('cost_basis');
  });

  it('requires an explicit nonnull cost for confirmation while preserving known zero', () => {
    for (const cost of [undefined, null, '']) {
      expect(
        medicationPrescriptionCreateSchema.safeParse({
          operation_id: id,
          medication_id: med,
          cost,
          cost_basis: 'per_vial',
        }).success
      ).toBe(false);
      expect(
        medicationPrescriptionUpdateSchema.safeParse({
          operation_id: id,
          expected_version: 1,
          cost,
          cost_basis: 'per_vial',
        }).success
      ).toBe(false);
    }
    expect(
      medicationPrescriptionCreateSchema.parse({
        operation_id: id,
        medication_id: med,
        cost: '0',
        cost_basis: 'per_vial',
      })
    ).toMatchObject({ cost: '0', cost_basis: 'per_vial' });
    expect(
      medicationPrescriptionUpdateSchema.parse({
        operation_id: id,
        expected_version: 1,
        cost_basis: null,
      }).cost_basis
    ).toBeNull();
  });

  it('keeps old strict prescription rows compatible when the unknown marker is omitted', () => {
    const { operation_id: _operation, ...fields } =
      medicationPrescriptionCreateSchema.parse({
        operation_id: id,
        medication_id: med,
        cost: '2',
      });
    const row = {
      ...fields,
      id,
      user_id: id,
      medication_name: 'Synthetic',
      version: 1,
      created_at: '2026-11-17T12:00:00Z',
      updated_at: '2026-11-17T12:00:00Z',
    };
    const old = medicationPrescriptionSchema
      .omit({ cost_basis: true })
      .strict();
    expect(old.safeParse(row).success).toBe(true);
    expect(old.safeParse({ ...row, cost_basis: 'per_vial' }).success).toBe(
      false
    );
    expect(
      medicationPrescriptionSchema.safeParse({ ...row, cost_basis: 'per_vial' })
        .success
    ).toBe(true);
  });

  it('keeps opt-in omitted by default and rejects unrelated financial request fields', () => {
    expect(medicationPrescriptionVialCostsQuerySchema.parse({})).toEqual({});
    expect(
      medicationPrescriptionCostAnalyticsQuerySchema.parse({})
    ).not.toHaveProperty('cost_basis');
    expect(
      medicationPrescriptionVialCostsQuerySchema.safeParse({
        cost_basis: 'with_prescription_estimates',
        expected_owner_id: id,
      }).success
    ).toBe(true);
    expect(
      medicationPrescriptionVialCostsQuerySchema.safeParse({
        prescription_id: id,
      }).success
    ).toBe(false);
  });

  it('requires a new-mode echo before treating an old response as estimate-aware', () => {
    expect(
      medicationPrescriptionVialCostsSchema.safeParse({ vials: [] }).success
    ).toBe(false);
    expect(
      medicationPrescriptionCostAnalyticsSchema.safeParse(
        buildMedicationCostAnalytics({
          today: '2026-11-17',
          medications: [],
          invoices: [],
          vials: [],
          doses: [],
        })
      ).success
    ).toBe(false);
    expect(
      medicationPrescriptionCostAnalyticsSchema.safeParse(analytics()).success
    ).toBe(true);
  });

  it('keeps confirmed zero distinct from missing and invoice credits valid', () => {
    expect(medicationPrescriptionVialCostSchema.parse(price()).unit_cost).toBe(
      '0'
    );
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...price(),
        unit_cost: null,
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...price(),
        unit_cost: '-1',
      }).success
    ).toBe(false);
    const invoice = {
      ...price(),
      cost_source: 'invoice',
      unit_cost: '-2.50',
      purchase_id: id,
      purchase_item_id: id,
      prescription_id: null,
      estimate_basis: null,
    };
    expect(
      medicationPrescriptionVialCostSchema.safeParse(invoice).success
    ).toBe(true);
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...invoice,
        currency: null,
      }).success
    ).toBe(true);
  });

  it('does not mix selected invoice and prescription provenance or invent missing prices', () => {
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...price(),
        purchase_id: id,
      }).success
    ).toBe(false);
    const unknown = {
      ...price(),
      is_costed: false,
      cost_source: null,
      unit_cost: null,
      currency: null,
      prescription_id: null,
      estimate_basis: null,
    };
    expect(
      medicationPrescriptionVialCostSchema.safeParse(unknown).success
    ).toBe(true);
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...unknown,
        unit_cost: '0',
      }).success
    ).toBe(false);
    for (const unit_cost of ['NaN', 'Infinity', 'not money'])
      expect(
        medicationPrescriptionVialCostSchema.safeParse({
          ...price(),
          unit_cost,
        }).success
      ).toBe(false);
  });

  it('keeps estimated and recorded currency amounts separate and qualifies undated vials', () => {
    const value = analytics();
    value.accounted.push({
      ...bucket(),
      currency: 'AUD',
      invoice_cash: '-5.00',
      prescription_estimate: '0.00',
      accounted_total: '-5.00',
      estimated_vials: 0,
      undated_vials: 0,
    });
    expect(
      medicationPrescriptionCostAnalyticsSchema
        .parse(value)
        .accounted.map((entry) => entry.currency)
    ).toEqual(['GBP', 'AUD']);
    expect(
      medicationPrescriptionAccountedBucketSchema.safeParse({
        ...bucket(),
        undated_vials: 2,
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionAccountedBucketSchema.safeParse({
        ...bucket(),
        prescription_estimate: '-1',
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionAccountedBucketSchema.safeParse({
        ...bucket(),
        prescription_estimate: 'not money',
      }).success
    ).toBe(false);
  });

  it('accounts for each costed usage source exactly once', () => {
    const value = {
      ...analytics(),
      rows: [
        {
          medication_id: med,
          medication_name: 'Synthetic',
          spend: null,
          spend_currency: null,
          spend_present: false,
          spend_mixed_currency: false,
          cost_per_dose: '2',
          cost_per_mg: '1',
          usage_currency: 'GBP',
          usage_mixed_currency: false,
          costed_doses: 2,
          uncosted_doses: 0,
          accounted: [bucket()],
          usage_sources: { invoice: 1, prescription: 1 },
        },
      ],
    };
    expect(
      medicationPrescriptionCostAnalyticsSchema.safeParse(value).success
    ).toBe(true);
    value.rows[0]!.usage_sources.prescription = 2;
    expect(
      medicationPrescriptionCostAnalyticsSchema.safeParse(value).success
    ).toBe(false);
  });
});
