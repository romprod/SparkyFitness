import { describe, expect, it } from 'vitest';
import {
  medicationInventoryDashboardResponseSchema,
  medicationInventorySupplySchema,
  medicationPreparationQueueItemSchema,
  medicationPreparationQueueStateSchema,
} from '../../shared/src/schemas/api/MedicationInventoryDashboard.api.zod.ts';

const medicationId = '30000000-0000-4000-8000-000000000001';
const stockId = '30000000-0000-4000-8000-000000000002';
const medication = {
  medication_id: medicationId,
  name: 'Synthetic medicine',
  route: 'injection',
  status: 'unknown',
  basis: 'unknown',
  coverage_through: null,
  depletion_date: null,
  reorder_by: null,
  days_left: null,
  served_slots: 0,
  expected_slots: 1,
  lead_days: 14,
  buffer_days: 3,
  limitations: ['unknown_stock'],
  prepared_only: {
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
    served_slots: 0,
    expected_slots: 1,
    lead_days: 14,
    buffer_days: 3,
    limitations: ['unknown_stock'],
  },
  containers: [],
  device_basis: [],
};
const forecast = {
  as_of: '2026-11-16T16:00:00Z',
  today: '2026-11-16',
  timezone: 'Europe/London',
  horizon_days: 365,
  max_slots: 800,
  defaults: { lead_days: 14, buffer_days: 3 },
  medications: [medication],
};
const queued = {
  stock_id: stockId,
  medication_id: medicationId,
  medication_name: 'Synthetic medicine',
  route: 'injection',
  label: null,
  label_mass_mg: null,
  raw_status: 'sealed',
  expiry_date: null,
  expired: false,
  preparation_queue_state: 'a'.repeat(64),
};

describe('authoritative inventory dashboard contracts', () => {
  it('retains the unchanged forecast and a named unknown supply selection', () => {
    const result = medicationInventoryDashboardResponseSchema.parse({
      forecast,
      supply: { state: 'unavailable', medication_id: medicationId },
      preparation_queue: [queued],
    });
    expect(result.forecast).toEqual(forecast);
    expect(result.supply).toEqual({
      state: 'unavailable',
      medication_id: medicationId,
    });
    expect(result.preparation_queue[0]?.label_mass_mg).toBeNull();
  });

  it('requires selected supply identity to belong to the same forecast snapshot', () => {
    expect(
      medicationInventoryDashboardResponseSchema.safeParse({
        forecast,
        supply: {
          state: 'unavailable',
          medication_id: '30000000-0000-4000-8000-000000000003',
        },
        preparation_queue: [],
      }).success
    ).toBe(false);
  });

  it('keeps known coverage and unknown availability distinct without a client selector', () => {
    const known = {
      ...medication,
      status: 'covered',
      basis: 'course_end',
      coverage_through: '2026-11-20',
      served_slots: 1,
      limitations: [],
      prepared_only: {
        ...medication.prepared_only,
        status: 'covered',
        basis: 'course_end',
        coverage_through: '2026-11-20',
        served_slots: 1,
        limitations: [],
      },
    };
    const body = {
      forecast: { ...forecast, medications: [known] },
      preparation_queue: [],
    };
    expect(
      medicationInventoryDashboardResponseSchema.safeParse({
        ...body,
        supply: { state: 'forecast', medication_id: medicationId },
      }).success
    ).toBe(true);
    expect(
      medicationInventoryDashboardResponseSchema.safeParse({
        ...body,
        supply: { state: 'unavailable', medication_id: medicationId },
      }).success
    ).toBe(false);
    expect(
      medicationInventoryDashboardResponseSchema.safeParse({
        forecast,
        preparation_queue: [],
        supply: { state: 'forecast', medication_id: medicationId },
      }).success
    ).toBe(false);
  });

  it('represents only authoritative no-demand as an empty selection, separate from unavailable', () => {
    expect(
      medicationInventorySupplySchema.parse({
        state: 'no_demand',
        medication_id: null,
      })
    ).toEqual({ state: 'no_demand', medication_id: null });
    expect(
      medicationInventorySupplySchema.parse({
        state: 'unavailable',
        medication_id: null,
      })
    ).toEqual({ state: 'unavailable', medication_id: null });
    expect(
      medicationInventorySupplySchema.safeParse({
        state: 'no_demand',
        medication_id: medicationId,
      }).success
    ).toBe(false);
  });

  it('keeps queue display facts minimal rather than reconstructing a writable pen', () => {
    const result = medicationPreparationQueueItemSchema.parse({
      ...queued,
      notes: 'Unrelated synthetic notes',
      concentration_mg_ml: null,
    });
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('concentration_mg_ml');
    expect(
      medicationPreparationQueueItemSchema.safeParse({
        ...queued,
        raw_status: 'in_use',
      }).success
    ).toBe(false);
  });

  it('allows expired eligible stock but requires an explicit recorded expiry for the annotation', () => {
    expect(
      medicationPreparationQueueItemSchema.parse({
        ...queued,
        expiry_date: '2026-11-15',
        expired: true,
      }).expired
    ).toBe(true);
    expect(
      medicationPreparationQueueItemSchema.safeParse({
        ...queued,
        expired: true,
      }).success
    ).toBe(false);
  });

  it('requires an opaque canonical state proof and one queue entry per stock identity', () => {
    expect(
      medicationPreparationQueueStateSchema.parse(
        queued.preparation_queue_state
      )
    ).toBe(queued.preparation_queue_state);
    for (const invalid of [
      '',
      'a'.repeat(63),
      'not-a-state-proof',
      'A'.repeat(64),
    ]) {
      expect(
        medicationPreparationQueueStateSchema.safeParse(invalid).success
      ).toBe(false);
    }
    expect(
      medicationInventoryDashboardResponseSchema.safeParse({
        forecast,
        supply: { state: 'unavailable', medication_id: medicationId },
        preparation_queue: [queued, queued],
      }).success
    ).toBe(false);
  });
});
