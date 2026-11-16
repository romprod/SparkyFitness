import { describe, expect, it } from 'vitest';
import {
  medicationForecastCoverageSchema,
  medicationForecastContainerSchema,
  medicationInventoryForecastSchema,
  medicationReorderDefaultsInputSchema,
} from '../../shared/src/schemas/api/MedicationInventoryForecast.api.zod.ts';
import {
  medicationCourseDeviceBindingSchema,
  medicationCoursePlanInputSchema,
} from '../../shared/src/schemas/api/MedicationCourses.api.zod.ts';

const unknown = {
  status: 'unknown',
  basis: 'unknown',
  coverage_through: null,
  depletion_date: null,
  reorder_by: null,
  days_left: null,
  served_slots: 0,
  expected_slots: 2,
  lead_days: 14,
  buffer_days: 3,
  limitations: ['sealed_stock_excluded'],
};

describe('bounded inventory forecast contracts', () => {
  it('retains zero and full integer storage range without string truncation or coercion', () => {
    expect(
      medicationReorderDefaultsInputSchema.parse({
        lead_days: 0,
        buffer_days: 0,
      })
    ).toEqual({ lead_days: 0, buffer_days: 0 });
    expect(
      medicationReorderDefaultsInputSchema.parse({
        lead_days: 2147483647,
        buffer_days: 3,
      }).lead_days
    ).toBe(2147483647);
    for (const lead_days of [
      '14',
      '14days',
      1.5,
      -1,
      2147483648,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        medicationReorderDefaultsInputSchema.safeParse({
          lead_days,
          buffer_days: 3,
        }).success
      ).toBe(false);
    }
  });

  it('does not allow unknown whole-stock scope to manufacture a depletion or reorder date', () => {
    expect(
      medicationForecastCoverageSchema.parse(unknown).reorder_by
    ).toBeNull();
    for (const field of ['coverage_through', 'depletion_date', 'reorder_by']) {
      expect(
        medicationForecastCoverageSchema.safeParse({
          ...unknown,
          [field]: '2026-11-17',
        }).success
      ).toBe(false);
    }
    expect(
      medicationForecastCoverageSchema.safeParse({ ...unknown, days_left: 0 })
        .success
    ).toBe(false);
  });

  it('requires known dates for a depletion result and a walked bound for covered', () => {
    expect(
      medicationForecastCoverageSchema.safeParse({
        ...unknown,
        status: 'ok',
        basis: 'depleted',
        limitations: [],
      }).success
    ).toBe(false);
    expect(
      medicationForecastCoverageSchema.safeParse({
        ...unknown,
        status: 'covered',
        basis: 'horizon',
        limitations: [],
      }).success
    ).toBe(false);
  });

  it('keeps a prepared-only urgent result distinct from unknown total stock', () => {
    const result = medicationInventoryForecastSchema.parse({
      ...unknown,
      medication_id: '20000000-0000-4000-8000-000000000001',
      name: 'Synthetic prepared medicine',
      route: 'injection',
      prepared_only: {
        ...unknown,
        status: 'reorder_now',
        basis: 'depleted',
        coverage_through: '2026-11-16',
        depletion_date: '2026-11-17',
        reorder_by: '2026-11-16',
        days_left: 1,
        served_slots: 1,
        limitations: [],
      },
      containers: [],
      device_basis: [],
    });
    expect(result.status).toBe('unknown');
    expect(result.reorder_by).toBeNull();
    expect(result.prepared_only.status).toBe('reorder_now');
  });

  it('reports finite bounded coverage without inventing a later depletion date', () => {
    expect(
      medicationForecastCoverageSchema.parse({
        ...unknown,
        status: 'covered',
        basis: 'course_end',
        coverage_through: '2026-12-01',
        served_slots: 2,
        limitations: [],
      }).coverage_through
    ).toBe('2026-12-01');
    expect(
      medicationForecastCoverageSchema.safeParse({
        ...unknown,
        status: 'covered',
        basis: 'horizon',
        reorder_by: '2026-11-16',
      }).success
    ).toBe(false);
  });

  it('allows bounded coverage with disclosed extra stock when known prepared stock covers all known demand', () => {
    const result = medicationForecastCoverageSchema.parse({
      ...unknown,
      status: 'covered',
      basis: 'horizon',
      coverage_through: '2027-11-15',
      served_slots: 2,
      limitations: ['sealed_stock_excluded'],
    });
    expect(result.status).toBe('covered');
    expect(result.reorder_by).toBeNull();
    expect(result.depletion_date).toBeNull();
    expect(result.limitations).toContain('sealed_stock_excluded');
    expect(
      medicationForecastCoverageSchema.safeParse({
        ...result,
        limitations: ['unmodelled_legacy_demand'],
      }).success
    ).toBe(false);
  });

  it('round-trips an exact authored current dose with a real device identifier', () => {
    const result = medicationForecastContainerSchema.parse({
      container_id: '20000000-0000-4000-8000-000000000002',
      coverage: unknown,
      remaining_doses: null,
      current_dose: {
        value: '0.10000000000000000001',
        unit: 'mg',
        device_id: '20000000-0000-4000-8000-000000000003',
      },
    });
    expect(result.current_dose?.value).toBe('0.10000000000000000001');
  });

  it('preserves omitted selection separately from an explicit preferred-device choice', () => {
    const plan = {
      name: 'Authored plan',
      start_date: '2026-11-16',
      dose_unit: 'mg',
      rules: [{ schedule_type_id: 'daily' }],
    };
    expect(medicationCoursePlanInputSchema.parse(plan)).not.toHaveProperty(
      'device_id'
    );
    expect(
      medicationCoursePlanInputSchema.parse({ ...plan, device_id: null })
        .device_id
    ).toBeNull();
    expect(
      medicationCoursePlanInputSchema.safeParse({
        ...plan,
        device_choice: 'preferred',
      }).success
    ).toBe(false);
  });

  it('represents a deleted explicit choice as missing without selecting a preferred device', () => {
    expect(
      medicationCourseDeviceBindingSchema.parse({
        choice: 'explicit',
        device_id: null,
        device_name: null,
        source: 'missing',
      })
    ).toEqual({
      choice: 'explicit',
      device_id: null,
      device_name: null,
      source: 'missing',
    });
    expect(
      medicationCourseDeviceBindingSchema.safeParse({
        choice: 'explicit',
        device_id: '20000000-0000-4000-8000-000000000003',
        device_name: 'Saved preferred',
        source: 'preferred',
      }).success
    ).toBe(false);
  });
});
