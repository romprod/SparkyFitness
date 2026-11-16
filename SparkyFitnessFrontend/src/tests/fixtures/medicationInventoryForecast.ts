import type {
  MedicationForecastCoverage,
  MedicationInventoryForecastResponse,
} from '@workspace/shared';
import { courseIds } from './medicationCourses';
export const forecastCoverage = (
  patch: Partial<MedicationForecastCoverage> = {}
): MedicationForecastCoverage => ({
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
  ...patch,
});
export const inventoryForecastFixture =
  (): MedicationInventoryForecastResponse => ({
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
