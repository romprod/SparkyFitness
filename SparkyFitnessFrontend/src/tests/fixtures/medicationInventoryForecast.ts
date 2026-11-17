import type {
  MedicationForecastPlannedCoverage,
  MedicationInventoryPlannedForecastResponse,
} from '@workspace/shared';
import { courseIds } from './medicationCourses';
export const forecastCoverage = (
  patch: Partial<MedicationForecastPlannedCoverage> = {}
): MedicationForecastPlannedCoverage => ({
  status: 'covered',
  basis: 'course_end',
  coverage_through: '2026-12-01',
  depletion_date: null,
  reorder_by: null,
  days_left: null,
  served_slots: 3,
  expected_slots: 3,
  lead_days: 14,
  buffer_days: 3,
  limitations: [],
  projection: {
    provisional_slots: 0,
    projection_starts_on: null,
    // Explicit synthetic committed demand for legacy shortage test cases. I07
    // scenarios override the projection with their own server-provided facts.
    first_unserved_day:
      patch.status === 'ok' || patch.status === 'reorder_now'
        ? '2026-12-02'
        : null,
    first_unserved_kind:
      patch.status === 'ok' || patch.status === 'reorder_now'
        ? 'committed'
        : null,
    claim_basis: patch.status === 'unknown' ? 'unknown' : 'committed',
  },
  ...patch,
});
export const inventoryForecastFixture =
  (): MedicationInventoryPlannedForecastResponse => ({
    forecast_mode: 'planned_cycles',
    as_of: '2026-11-16T12:00:00Z',
    today: '2026-11-16',
    timezone: 'Europe/London',
    horizon_days: 365,
    max_slots: 800,
    defaults: { lead_days: 14, buffer_days: 3 },
    medications: [
      {
        ...forecastCoverage(),
        medication_id: courseIds.med,
        name: 'Example prepared medication',
        route: 'injection',
        cycle_assumptions: [],
        prepared_only: forecastCoverage(),
        containers: [],
        device_basis: [
          {
            plan_id: courseIds.revision,
            plan_kind: 'course_revision',
            device_id: courseIds.rule,
            device_name: 'Saved example device',
            source: 'preferred',
          },
        ],
      },
    ],
  });
