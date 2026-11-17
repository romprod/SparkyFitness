import type {
  MedicationForecastPlannedCoverage,
  MedicationForecastProjection,
} from '@workspace/shared';

/** Claim wording follows the failed slot's server provenance, never a date comparison. */
export const isNextCycleShortage = (
  coverage: MedicationForecastPlannedCoverage
) =>
  coverage.status !== 'unknown' &&
  coverage.projection.claim_basis === 'projected_restart' &&
  coverage.projection.first_unserved_kind === 'projected_restart';
export const isConditionalCoverage = (
  projection: MedicationForecastProjection
) =>
  projection.claim_basis === 'projected_restart' ||
  projection.claim_basis === 'projected_coverage';
