import { describe, expect, it } from 'vitest';
import {
  medicationInventoryForecastQuerySchema,
  medicationForecastPlannedCoverageSchema,
  medicationInventoryPlannedForecastResponseSchema,
  medicationInventoryPlannedDashboardResponseSchema,
} from '../../shared/src/schemas/api/MedicationInventoryProjection.api.zod.ts';
import {
  medicationInventoryForecastResponseSchema,
  medicationForecastCoverageSchema,
} from '../../shared/src/schemas/api/MedicationInventoryForecast.api.zod.ts';

const med = '10000000-0000-4000-8000-000000000001';
const assumption = {
  course_id: '10000000-0000-4000-8000-000000000002',
  revision_id: '10000000-0000-4000-8000-000000000003',
  plan_name: 'Synthetic cycle',
  timezone: 'Pacific/Auckland',
  anchor_date: '2026-11-01',
  committed_end_date: '2026-11-07',
  on_weeks: 1,
  off_weeks: 2,
  next_restart_date: '2026-11-22',
  projection_starts_on: '2026-11-23',
  overdue: false,
  manual_restart_required: true,
};
const unknown = {
  status: 'unknown',
  basis: 'unknown',
  coverage_through: null,
  depletion_date: null,
  reorder_by: null,
  days_left: null,
  served_slots: 0,
  expected_slots: 4,
  lead_days: 14,
  buffer_days: 3,
  limitations: ['unknown_stock'],
};
const projection = {
  provisional_slots: 2,
  projection_starts_on: '2026-11-23',
  first_unserved_day: null,
  first_unserved_kind: null,
  claim_basis: 'unknown',
};
const shortage = {
  ...unknown,
  status: 'ok',
  basis: 'depleted',
  coverage_through: '2026-11-30',
  depletion_date: '2026-11-30',
  reorder_by: '2026-11-24',
  days_left: 13,
  served_slots: 2,
  limitations: [],
  projection: {
    ...projection,
    first_unserved_day: '2026-12-08',
    first_unserved_kind: 'projected_restart',
    claim_basis: 'projected_restart',
  },
};
const response = () => ({
  as_of: '2026-11-17T10:00:00Z',
  today: '2026-11-17',
  timezone: 'Europe/London',
  horizon_days: 365,
  max_slots: 800,
  defaults: { lead_days: 14, buffer_days: 3 },
  forecast_mode: 'planned_cycles',
  medications: [
    {
      ...unknown,
      medication_id: med,
      name: 'Synthetic stock',
      route: 'injection',
      projection,
      prepared_only: { ...unknown, projection },
      containers: [],
      device_basis: [],
      cycle_assumptions: [assumption],
    },
  ],
});

describe('planned cycle inventory contracts', () => {
  it('keeps mode omitted and accepts only explicit known opt-ins', () => {
    expect(medicationInventoryForecastQuerySchema.parse({})).toEqual({});
    expect(
      medicationInventoryForecastQuerySchema.parse({
        forecast_mode: 'committed',
      })
    ).toEqual({ forecast_mode: 'committed' });
    expect(
      medicationInventoryForecastQuerySchema.safeParse({
        forecast_mode: 'planned_cycles',
        as_of: '2026-11-01',
      }).success
    ).toBe(false);
  });

  it('requires the mode echo and required provisional metadata', () => {
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse(response())
        .success
    ).toBe(true);
    const { forecast_mode: _mode, ...old } = response();
    expect(
      medicationInventoryForecastResponseSchema.safeParse(old).success
    ).toBe(true);
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse(old).success
    ).toBe(false);
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse({
        ...response(),
        forecast_mode: 'committed',
      }).success
    ).toBe(false);
  });

  it('demonstrates why an additive marker alone cannot protect old clients', () => {
    const parsed = medicationInventoryForecastResponseSchema.parse(response());
    expect(parsed).not.toHaveProperty('forecast_mode');
    expect(parsed.medications[0]).not.toHaveProperty('projection');
  });

  it('preserves the first unserved projected day independently of coverage prefix', () => {
    const parsed = medicationForecastPlannedCoverageSchema.parse(shortage);
    expect(parsed.projection.first_unserved_day).toBe('2026-12-08');
    expect(parsed.depletion_date).toBe('2026-11-30');
  });

  it('represents a committed failure after provisional consumption as conditional coverage', () => {
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...shortage,
        projection: {
          ...shortage.projection,
          first_unserved_kind: 'committed',
          claim_basis: 'projected_coverage',
        },
      }).success
    ).toBe(true);
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...shortage,
        projection: {
          ...shortage.projection,
          first_unserved_kind: 'committed',
        },
      }).success
    ).toBe(false);
  });

  it('allows committed shortage before any future provisional stock influence', () => {
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...shortage,
        projection: {
          ...shortage.projection,
          first_unserved_day: '2026-11-18',
          first_unserved_kind: 'committed',
          claim_basis: 'committed',
        },
      }).success
    ).toBe(true);
  });

  it('does not hide a provisional assumption on bounded covered demand', () => {
    const covered = {
      ...unknown,
      status: 'covered',
      basis: 'horizon',
      coverage_through: '2027-11-16',
      limitations: [],
      projection: { ...projection, claim_basis: 'projected_coverage' },
    };
    expect(
      medicationForecastPlannedCoverageSchema.safeParse(covered).success
    ).toBe(true);
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...covered,
        projection: { ...projection, claim_basis: 'committed' },
      }).success
    ).toBe(false);
  });

  it('keeps unknown coverage dates and first-unserved claims unavailable', () => {
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...unknown,
        projection,
      }).success
    ).toBe(true);
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...unknown,
        projection: shortage.projection,
      }).success
    ).toBe(false);
  });

  it('requires consistent provisional counts, actual first slot and failure provenance', () => {
    for (const bad of [
      { ...projection, provisional_slots: 0 },
      { ...projection, projection_starts_on: null },
      { ...projection, first_unserved_day: '2026-12-08' },
    ])
      expect(
        medicationForecastPlannedCoverageSchema.safeParse({
          ...unknown,
          projection: bad,
        }).success
      ).toBe(false);
  });

  it('requires explicit manual canonical assumptions without extra calendar controls', () => {
    for (const bad of [
      { ...assumption, manual_restart_required: false },
      { ...assumption, off_weeks: 0 },
      { ...assumption, automatic_restart: true },
    ]) {
      const value = response();
      expect(
        medicationInventoryPlannedForecastResponseSchema.safeParse({
          ...value,
          medications: [{ ...value.medications[0], cycle_assumptions: [bad] }],
        }).success
      ).toBe(false);
    }
  });

  it('retains captured course calendar provenance independently from forecast timezone', () => {
    const parsed =
      medicationInventoryPlannedForecastResponseSchema.parse(response());
    expect(parsed.timezone).toBe('Europe/London');
    expect(parsed.medications[0]!.cycle_assumptions[0]).toMatchObject({
      plan_name: 'Synthetic cycle',
      timezone: 'Pacific/Auckland',
      anchor_date: '2026-11-01',
      projection_starts_on: '2026-11-23',
    });
    for (const key of ['plan_name', 'timezone']) {
      const missing: Record<string, unknown> = { ...assumption };
      delete missing[key];
      const value = response();
      expect(
        medicationInventoryPlannedForecastResponseSchema.safeParse({
          ...value,
          medications: [
            { ...value.medications[0], cycle_assumptions: [missing] },
          ],
        }).success
      ).toBe(false);
    }
  });

  it('requires assumption provenance on medication and nested container surfaces', () => {
    const value = response();
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse({
        ...value,
        medications: [{ ...value.medications[0], cycle_assumptions: [] }],
      }).success
    ).toBe(false);
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse({
        ...value,
        medications: [
          {
            ...value.medications[0],
            containers: [
              {
                container_id: med,
                coverage: unknown,
                remaining_doses: null,
                current_dose: null,
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('retains I08 authoritative selection cross-references and queue shape', () => {
    const dashboard = {
      forecast: response(),
      supply: { state: 'unavailable', medication_id: med },
      preparation_queue: [],
    };
    expect(
      medicationInventoryPlannedDashboardResponseSchema.safeParse(dashboard)
        .success
    ).toBe(true);
    expect(
      medicationInventoryPlannedDashboardResponseSchema.safeParse({
        ...dashboard,
        supply: { state: 'forecast', medication_id: med },
      }).success
    ).toBe(false);
  });

  it('retains ambiguous cross-zone demand only as qualified unknown planned coverage', () => {
    const ambiguous = {
      ...unknown,
      limitations: ['unknown_projection_date'],
      projection: { ...projection, projection_starts_on: null },
    };
    expect(
      medicationForecastPlannedCoverageSchema.safeParse(ambiguous).success
    ).toBe(true);
    expect(medicationForecastCoverageSchema.safeParse(ambiguous).success).toBe(
      false
    );
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...ambiguous,
        limitations: [],
      }).success
    ).toBe(false);
    expect(
      medicationForecastPlannedCoverageSchema.safeParse({
        ...shortage,
        limitations: ['unknown_projection_date'],
      }).success
    ).toBe(false);
    const value = response();
    const row = {
      ...value.medications[0],
      ...ambiguous,
      prepared_only: ambiguous,
      cycle_assumptions: [{ ...assumption, projection_starts_on: null }],
      containers: [
        {
          container_id: med,
          coverage: ambiguous,
          remaining_doses: null,
          current_dose: null,
        },
      ],
    };
    const dashboard = medicationInventoryPlannedDashboardResponseSchema.parse({
      forecast: { ...value, medications: [row] },
      supply: { state: 'unavailable', medication_id: med },
      preparation_queue: [],
    });
    expect(
      dashboard.forecast.medications[0]!.projection.provisional_slots
    ).toBe(2);
    expect(dashboard.forecast.medications[0]!.limitations).toEqual([
      'unknown_projection_date',
    ]);
    expect(
      dashboard.forecast.medications[0]!.cycle_assumptions[0]!.anchor_date
    ).toBe('2026-11-01');
    expect(
      dashboard.forecast.medications[0]!.projection.projection_starts_on
    ).toBeNull();
  });
});
