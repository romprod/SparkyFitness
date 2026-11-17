import { z } from 'zod';
import { medicationCourseDaySchema } from './MedicationCourses.api.zod.ts';
import {
  medicationForecastCoverageSchema,
  medicationForecastContainerSchema,
  medicationForecastLimitationSchema,
  medicationInventoryForecastSchema,
  medicationInventoryForecastResponseSchema,
} from './MedicationInventoryForecast.api.zod.ts';
import { medicationInventoryDashboardResponseSchema } from './MedicationInventoryDashboard.api.zod.ts';

/** Omission preserves the committed forecast understood by existing clients. */
export const medicationInventoryForecastQuerySchema = z
  .object({
    expected_owner_id: z.string().uuid().optional(),
    forecast_mode: z.enum(['committed', 'planned_cycles']).optional(),
  })
  .strict();

/** Planned-only uncertainty; existing committed contracts remain unchanged. */
export const medicationForecastPlannedLimitationSchema = z.union([
  medicationForecastLimitationSchema,
  z.literal('unknown_projection_date'),
]);
const plannedLimitations = z.array(medicationForecastPlannedLimitationSchema);
const withoutProjectionDateReason = <T extends { limitations: string[] }>(
  coverage: T
) => ({
  ...coverage,
  limitations: coverage.limitations.filter(
    (reason) => reason !== 'unknown_projection_date'
  ),
});

export const medicationForecastProjectionSchema = z
  .object({
    provisional_slots: z.number().int().nonnegative(),
    projection_starts_on: medicationCourseDaySchema.nullable(),
    first_unserved_day: medicationCourseDaySchema.nullable(),
    first_unserved_kind: z.enum(['committed', 'projected_restart']).nullable(),
    claim_basis: z.enum([
      'committed',
      'projected_restart',
      'projected_coverage',
      'unknown',
    ]),
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      (projection.provisional_slots === 0 &&
        projection.projection_starts_on !== null) ||
      (projection.provisional_slots > 0 &&
        projection.projection_starts_on === null &&
        projection.claim_basis !== 'unknown')
    )
      context.addIssue({
        code: 'custom',
        message: 'Provisional demand must identify its first retained slot',
      });
    if (
      (projection.first_unserved_day === null) !==
      (projection.first_unserved_kind === null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Unserved demand requires both its day and provenance',
      });
    if (
      (projection.claim_basis === 'projected_restart' &&
        projection.first_unserved_kind !== 'projected_restart') ||
      (projection.claim_basis === 'committed' &&
        projection.first_unserved_kind === 'projected_restart') ||
      (projection.claim_basis === 'projected_coverage' &&
        projection.first_unserved_kind === 'projected_restart')
    )
      context.addIssue({
        code: 'custom',
        message: 'The claim must preserve the failed slot provenance',
      });
    if (
      ['projected_restart', 'projected_coverage'].includes(
        projection.claim_basis
      ) &&
      projection.provisional_slots === 0
    )
      context.addIssue({
        code: 'custom',
        message: 'A conditional claim requires provisional demand',
      });
  });

/** Server-computed calendar facts; they do not start or reopen a course. */
export const medicationForecastCycleAssumptionSchema = z
  .object({
    course_id: z.string().uuid(),
    revision_id: z.string().uuid(),
    plan_name: z.string(),
    /** Anchor, committed end and theoretical restart use this captured zone. */
    timezone: z.string().min(1),
    anchor_date: medicationCourseDaySchema,
    committed_end_date: medicationCourseDaySchema,
    on_weeks: z.number().int().min(1).max(104),
    off_weeks: z.number().int().min(1).max(104),
    next_restart_date: medicationCourseDaySchema,
    /** Retained scheduled demand day in the forecast response timezone. */
    projection_starts_on: medicationCourseDaySchema.nullable(),
    overdue: z.boolean(),
    manual_restart_required: z.literal(true),
  })
  .strict();

export const medicationForecastPlannedCoverageSchema = z
  .object({
    ...medicationForecastCoverageSchema.shape,
    limitations: plannedLimitations,
    projection: medicationForecastProjectionSchema,
  })
  .superRefine((coverage, context) => {
    const committed = medicationForecastCoverageSchema.safeParse(
      withoutProjectionDateReason(coverage)
    );
    if (!committed.success)
      for (const issue of committed.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    const projection = coverage.projection;
    const unknownDate = coverage.limitations.includes(
      'unknown_projection_date'
    );
    if (
      (unknownDate &&
        (coverage.status !== 'unknown' ||
          projection.claim_basis !== 'unknown')) ||
      (projection.provisional_slots > 0 &&
        projection.projection_starts_on === null &&
        !unknownDate)
    )
      context.addIssue({
        code: 'custom',
        path: ['projection', 'projection_starts_on'],
        message:
          'An unavailable projected date requires qualified unknown coverage',
      });
    if (
      (coverage.status === 'unknown' &&
        (projection.claim_basis !== 'unknown' ||
          projection.first_unserved_day !== null)) ||
      (coverage.status !== 'unknown' && projection.claim_basis === 'unknown')
    )
      context.addIssue({
        code: 'custom',
        path: ['projection'],
        message: 'The projection must preserve unknown stock coverage',
      });
    if (
      coverage.status === 'covered' &&
      (projection.first_unserved_day !== null ||
        projection.claim_basis !==
          (projection.provisional_slots > 0
            ? 'projected_coverage'
            : 'committed'))
    )
      context.addIssue({
        code: 'custom',
        path: ['projection'],
        message: 'Bounded coverage must disclose provisional demand',
      });
    if (
      (coverage.status === 'ok' || coverage.status === 'reorder_now') &&
      projection.first_unserved_day === null
    )
      context.addIssue({
        code: 'custom',
        path: ['projection', 'first_unserved_day'],
        message: 'A known shortage requires the first unserved demand',
      });
  });

export const medicationInventoryPlannedForecastSchema = z
  .object({
    ...medicationInventoryForecastSchema.shape,
    limitations: plannedLimitations,
    projection: medicationForecastProjectionSchema,
    prepared_only: medicationForecastPlannedCoverageSchema,
    containers: z.array(
      medicationForecastContainerSchema.extend({
        coverage: medicationForecastPlannedCoverageSchema,
      })
    ),
    cycle_assumptions: z.array(medicationForecastCycleAssumptionSchema),
  })
  .superRefine((row, context) => {
    const coverage = medicationForecastPlannedCoverageSchema.safeParse(row);
    if (!coverage.success)
      for (const issue of coverage.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    const revisions = row.cycle_assumptions.map((item) => item.revision_id);
    if (new Set(revisions).size !== revisions.length)
      context.addIssue({
        code: 'custom',
        path: ['cycle_assumptions'],
        message: 'Each revision appears once in cycle assumptions',
      });
    if (
      [
        row,
        row.prepared_only,
        ...row.containers.map((item) => item.coverage),
      ].some((coverage) => coverage.projection.provisional_slots > 0) &&
      row.cycle_assumptions.length === 0
    )
      context.addIssue({
        code: 'custom',
        path: ['cycle_assumptions'],
        message: 'Provisional demand requires its course assumptions',
      });
  });

/** New clients require this echo rather than accepting an unqualified old response. */
export const medicationInventoryPlannedForecastResponseSchema =
  medicationInventoryForecastResponseSchema.extend({
    forecast_mode: z.literal('planned_cycles'),
    medications: z.array(medicationInventoryPlannedForecastSchema),
  });
export const medicationInventoryPlannedDashboardResponseSchema = z
  .object({
    ...medicationInventoryDashboardResponseSchema.shape,
    forecast: medicationInventoryPlannedForecastResponseSchema,
  })
  .superRefine((dashboard, context) => {
    // Reuse the existing authoritative selection/queue checks with only the
    // new-mode reason removed from its old-contract validation view.
    const compatible = medicationInventoryDashboardResponseSchema.safeParse({
      ...dashboard,
      forecast: {
        ...dashboard.forecast,
        medications: dashboard.forecast.medications.map((row) => ({
          ...withoutProjectionDateReason(row),
          prepared_only: withoutProjectionDateReason(row.prepared_only),
          containers: row.containers.map((container) => ({
            ...container,
            coverage: withoutProjectionDateReason(container.coverage),
          })),
        })),
      },
    });
    if (!compatible.success)
      for (const issue of compatible.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });

export type MedicationInventoryForecastQuery = z.infer<
  typeof medicationInventoryForecastQuerySchema
>;
export type MedicationForecastProjection = z.infer<
  typeof medicationForecastProjectionSchema
>;
export type MedicationForecastPlannedLimitation = z.infer<
  typeof medicationForecastPlannedLimitationSchema
>;
export type MedicationForecastCycleAssumption = z.infer<
  typeof medicationForecastCycleAssumptionSchema
>;
export type MedicationForecastPlannedCoverage = z.infer<
  typeof medicationForecastPlannedCoverageSchema
>;
export type MedicationInventoryPlannedForecast = z.infer<
  typeof medicationInventoryPlannedForecastSchema
>;
export type MedicationInventoryPlannedForecastResponse = z.infer<
  typeof medicationInventoryPlannedForecastResponseSchema
>;
export type MedicationInventoryPlannedDashboardResponse = z.infer<
  typeof medicationInventoryPlannedDashboardResponseSchema
>;
