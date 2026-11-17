import type {
  MedicationForecastProjection,
  MedicationForecastCycleAssumption,
  MedicationForecastPlannedCoverage,
} from '@workspace/shared';
import { courseIds } from './medicationCourses';
import { forecastCoverage } from './medicationInventoryForecast';
export const projectionFixture = (
  patch: Partial<MedicationForecastProjection> = {}
): MedicationForecastProjection => ({
  provisional_slots: 3,
  projection_starts_on: '2026-12-13',
  first_unserved_day: '2027-01-24',
  first_unserved_kind: 'projected_restart',
  claim_basis: 'projected_restart',
  ...patch,
});
export const cycleAssumptionFixture = (
  patch: Partial<MedicationForecastCycleAssumption> = {}
): MedicationForecastCycleAssumption => ({
  course_id: courseIds.course,
  revision_id: courseIds.revision,
  plan_name: 'Example cycle Alpha',
  timezone: 'America/New_York',
  anchor_date: '2026-11-01',
  committed_end_date: '2026-11-07',
  on_weeks: 1,
  off_weeks: 1,
  next_restart_date: '2026-11-15',
  projection_starts_on: '2026-12-13',
  overdue: true,
  manual_restart_required: true,
  ...patch,
});
export const projectedCoverageFixture = (
  patch: Partial<MedicationForecastPlannedCoverage> = {}
): MedicationForecastPlannedCoverage =>
  forecastCoverage({
    status: 'ok',
    basis: 'depleted',
    coverage_through: '2027-01-10',
    depletion_date: '2027-01-10',
    reorder_by: '2027-01-10',
    days_left: 55,
    served_slots: 2,
    expected_slots: 3,
    projection: projectionFixture(),
    ...patch,
  });
