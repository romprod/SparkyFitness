import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
  medicationCourseCycleWeekSchema,
  medicationCourseMutationResultSchema,
  medicationCourseStatusSchema,
} from './MedicationCourses.api.zod.ts';

const uuid = z.string().uuid();
const day = medicationCourseDaySchema;
const nullableDay = day.nullable();
const eligibility = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
});
export const medicationCourseCycleActionSchema = z.enum(['end', 'start']);
export const medicationCourseCycleStateSchema = z.object({
  course_id: uuid,
  revision_id: uuid,
  version: z.number().int().positive(),
  timezone: z.string().min(1),
  today: day,
  original_start_date: day,
  on_weeks: medicationCourseCycleWeekSchema.nullable(),
  off_weeks: medicationCourseCycleWeekSchema.nullable(),
  anchor_date: nullableDay,
  phase: z.enum(['none', 'scheduled', 'on', 'off', 'ended', 'restart_due']),
  planned_stop_date: nullableDay,
  next_restart_date: nullableDay,
  end_cycle: eligibility,
  start_next_cycle: eligibility,
  advisory: z.literal(true),
});
export const medicationCourseCycleReviewInputSchema = z
  .object({
    action: medicationCourseCycleActionSchema,
    expected_version: z.number().int().positive(),
  })
  .strict();
export const medicationCourseCycleActionInputSchema = z
  .object({
    operation_id: uuid,
    expected_version: z.number().int().positive(),
    review_fingerprint: z.string().min(1),
  })
  .strict();
export const medicationCourseCycleReviewSchema = z.object({
  action: medicationCourseCycleActionSchema,
  cycle: medicationCourseCycleStateSchema,
  effective_day: day,
  candidate_end_date: nullableDay,
  new_start_date: nullableDay,
  new_end_date: nullableDay,
  first_due: z
    .object({
      scheduled_day: day,
      scheduled_for: medicationCourseInstantSchema.nullable(),
      time_of_day: z.string().nullable(),
    })
    .nullable(),
  phase_continuity: z.enum(['retained', 'not_applicable', 'unknown']),
  can_commit: z.boolean(),
  conflicts: z.array(z.object({ code: z.string(), message: z.string() })),
  review_fingerprint: z.string().min(1),
});
const boundarySnapshot = z.object({
  revision_id: uuid,
  status: medicationCourseStatusSchema,
  start_date: day,
  end_date: nullableDay,
  weekly_anchor_date: nullableDay,
});
export const medicationCourseCycleMutationResultSchema =
  medicationCourseMutationResultSchema.extend({
    action: medicationCourseCycleActionSchema,
    effective_day: day,
    activated_at: medicationCourseInstantSchema.nullable(),
    boundary_audit: z.object({
      at: medicationCourseInstantSchema,
      timezone: z.string().min(1),
      before: boundarySnapshot,
      after: boundarySnapshot,
    }),
  });
export type MedicationCourseCycleAction = z.infer<
  typeof medicationCourseCycleActionSchema
>;
export type MedicationCourseCycleState = z.infer<
  typeof medicationCourseCycleStateSchema
>;
export type MedicationCourseCycleReviewInput = z.infer<
  typeof medicationCourseCycleReviewInputSchema
>;
export type MedicationCourseCycleActionInput = z.infer<
  typeof medicationCourseCycleActionInputSchema
>;
export type MedicationCourseCycleReview = z.infer<
  typeof medicationCourseCycleReviewSchema
>;
export type MedicationCourseCycleMutationResult = z.infer<
  typeof medicationCourseCycleMutationResultSchema
>;
