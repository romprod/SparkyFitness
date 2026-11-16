import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
  medicationCourseDoseSchema,
} from './MedicationCourses.api.zod.ts';

export const MEDICATION_FORECAST_HORIZON_DAYS = 365;
export const MEDICATION_FORECAST_MAX_SLOTS = 800;
export const DEFAULT_MEDICATION_REORDER_LEAD_DAYS = 14;
export const DEFAULT_MEDICATION_REORDER_BUFFER_DAYS = 3;
/** PostgreSQL INTEGER storage limit, not a regimen or purchasing recommendation. */
const reorderDays = z.number().int().min(0).max(2147483647);
export const medicationReorderDefaultsSchema = z
  .object({
    lead_days: reorderDays,
    buffer_days: reorderDays,
  })
  .strict();
export const medicationReorderDefaultsInputSchema =
  medicationReorderDefaultsSchema;
export const medicationForecastStatusSchema = z.enum([
  'unknown',
  'covered',
  'ok',
  'reorder_now',
]);
export const medicationForecastBasisSchema = z.enum([
  'unknown',
  'course_end',
  'horizon',
  'slot_cap',
  'depleted',
]);
export const medicationForecastLimitationSchema = z.enum([
  'no_managed_plan',
  'no_forecast_slots',
  'unmodelled_legacy_demand',
  'unknown_dose',
  'unsupported_unit',
  'missing_device',
  'incompatible_device',
  'unknown_stock',
  'unknown_bud',
  'sealed_stock_excluded',
  'unsupported_route',
  'blocked_draw',
  'preferred_device_basis',
  'date_out_of_range',
]);
/** Dates and urgency are unavailable for an unknown coverage calculation. */
export const medicationForecastCoverageSchema = z
  .object({
    status: medicationForecastStatusSchema,
    basis: medicationForecastBasisSchema,
    coverage_through: medicationCourseDaySchema.nullable(),
    depletion_date: medicationCourseDaySchema.nullable(),
    reorder_by: medicationCourseDaySchema.nullable(),
    days_left: z.number().int().nonnegative().nullable(),
    served_slots: z.number().int().nonnegative(),
    expected_slots: z.number().int().nonnegative(),
    lead_days: reorderDays,
    buffer_days: reorderDays,
    limitations: z.array(medicationForecastLimitationSchema),
  })
  .superRefine((coverage, context) => {
    if (
      coverage.limitations.includes('unmodelled_legacy_demand') &&
      coverage.status !== 'unknown'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Unmodelled demand cannot establish stock coverage or purchase urgency',
      });
    }
    if (
      coverage.status === 'unknown' &&
      (coverage.basis !== 'unknown' ||
        coverage.coverage_through !== null ||
        coverage.depletion_date !== null ||
        coverage.reorder_by !== null ||
        coverage.days_left !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Unknown stock coverage cannot assert coverage dates or purchase urgency',
      });
    }
    if (
      coverage.status === 'covered' &&
      (coverage.basis === 'unknown' ||
        coverage.basis === 'depleted' ||
        coverage.coverage_through === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Bounded coverage requires its actual walked bound',
      });
    }
    if (
      (coverage.status === 'ok' || coverage.status === 'reorder_now') &&
      (coverage.basis !== 'depleted' ||
        coverage.coverage_through === null ||
        coverage.depletion_date === null ||
        coverage.reorder_by === null ||
        coverage.days_left === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A depletion forecast requires known scoped dates',
      });
    }
    if (
      coverage.status === 'covered' &&
      (coverage.depletion_date !== null ||
        coverage.reorder_by !== null ||
        coverage.days_left !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Bounded coverage does not establish a depletion date or purchase urgency',
      });
    }
  });
export const medicationForecastDeviceBasisSchema = z.object({
  plan_id: z.string().uuid(),
  plan_kind: z.enum(['course_revision', 'legacy_schedule']),
  device_id: z.string().uuid().nullable(),
  device_name: z.string().nullable(),
  source: z.enum(['plan', 'preferred', 'missing', 'incompatible']),
});
export const medicationForecastContainerSchema = z.object({
  container_id: z.string().uuid(),
  coverage: medicationForecastCoverageSchema,
  remaining_doses: z.number().int().nonnegative().nullable(),
  current_dose: z
    .object({
      value: medicationCourseDoseSchema,
      unit: z.string(),
      device_id: z.string().uuid(),
    })
    .nullable(),
});
export const medicationInventoryForecastSchema =
  medicationForecastCoverageSchema.safeExtend({
    medication_id: z.string().uuid(),
    name: z.string(),
    route: z.enum(['injection', 'nasal']).nullable(),
    /** Prepared-only scope never establishes whole-medication purchase urgency. */
    prepared_only: medicationForecastCoverageSchema,
    containers: z.array(medicationForecastContainerSchema),
    device_basis: z.array(medicationForecastDeviceBasisSchema),
  });
export const medicationInventoryForecastResponseSchema = z.object({
  as_of: medicationCourseInstantSchema,
  today: medicationCourseDaySchema,
  timezone: z.string().min(1),
  horizon_days: z.literal(MEDICATION_FORECAST_HORIZON_DAYS),
  max_slots: z.literal(MEDICATION_FORECAST_MAX_SLOTS),
  defaults: medicationReorderDefaultsSchema,
  medications: z.array(medicationInventoryForecastSchema),
});
export type MedicationReorderDefaults = z.infer<
  typeof medicationReorderDefaultsSchema
>;
export type MedicationReorderDefaultsInput = z.infer<
  typeof medicationReorderDefaultsInputSchema
>;
export type MedicationForecastStatus = z.infer<
  typeof medicationForecastStatusSchema
>;
export type MedicationForecastBasis = z.infer<
  typeof medicationForecastBasisSchema
>;
export type MedicationForecastLimitation = z.infer<
  typeof medicationForecastLimitationSchema
>;
export type MedicationForecastCoverage = z.infer<
  typeof medicationForecastCoverageSchema
>;
export type MedicationForecastDeviceBasis = z.infer<
  typeof medicationForecastDeviceBasisSchema
>;
export type MedicationForecastContainer = z.infer<
  typeof medicationForecastContainerSchema
>;
export type MedicationInventoryForecast = z.infer<
  typeof medicationInventoryForecastSchema
>;
export type MedicationInventoryForecastResponse = z.infer<
  typeof medicationInventoryForecastResponseSchema
>;
