import { z } from 'zod';
import { medicationCourseDaySchema } from './MedicationCourses.api.zod.ts';

/** The recurrences a stack can carry. `weekly` is one `specific_days` day; monthly, PRN and taper are not offered. */
export const STACK_SCHEDULE_TYPES = [
  'daily',
  'specific_days',
  'every_n_days',
  'cyclic',
] as const;
export const stackScheduleTypeSchema = z.enum(STACK_SCHEDULE_TYPES, {
  error: 'Choose how often the stack is taken.',
});
export type StackScheduleType = z.infer<typeof stackScheduleTypeSchema>;

const uuid = z.string().uuid();
const time = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    'Use a 24-hour time such as 08:00.'
  );

/** `08:00:00` and `08:00` are one time; keep `HH:MM` unless seconds matter. */
export function normalizeStackTime(value: string | null | undefined) {
  if (!value) return null;
  return value.length === 8 && value.endsWith(':00')
    ? value.slice(0, 5)
    : value;
}

/**
 * The shared timing of a stack: pattern, time, and the anchor of an interval or
 * cycle. Irrelevant fields are normalised to null so the stored row always
 * satisfies the table's shape check.
 */
export const medicationStackScheduleInputSchema = z
  .object({
    schedule_type_id: stackScheduleTypeSchema,
    time_of_day: time.nullable().optional(),
    days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    interval_days: z.number().int().nullable().optional(),
    cycle_on_days: z.number().int().nullable().optional(),
    cycle_off_days: z.number().int().nullable().optional(),
    start_date: medicationCourseDaySchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const bad = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    const type = value.schedule_type_id;
    if (type === 'specific_days' && !value.days_of_week?.length)
      bad('days_of_week', 'Choose at least one weekday.');
    if (type === 'every_n_days') {
      if (!value.interval_days || value.interval_days < 2)
        bad('interval_days', 'Enter how many days between doses (2 or more).');
      if (!value.start_date)
        bad('start_date', 'Set a start date for interval / cycle schedules.');
    }
    if (type === 'cyclic') {
      if (
        !value.cycle_on_days ||
        value.cycle_on_days < 1 ||
        !value.cycle_off_days ||
        value.cycle_off_days < 1
      )
        bad('cycle_on_days', 'Enter days on and days off (1 or more each).');
      if (!value.start_date)
        bad('start_date', 'Set a start date for interval / cycle schedules.');
    }
  })
  .transform((value) => {
    const type = value.schedule_type_id;
    return {
      schedule_type_id: type,
      time_of_day: normalizeStackTime(value.time_of_day),
      days_of_week:
        type === 'specific_days'
          ? [...new Set(value.days_of_week ?? [])].sort((a, b) => a - b)
          : null,
      interval_days: type === 'every_n_days' ? value.interval_days! : null,
      cycle_on_days: type === 'cyclic' ? value.cycle_on_days! : null,
      cycle_off_days: type === 'cyclic' ? value.cycle_off_days! : null,
      start_date: value.start_date ?? null,
    };
  });
export type MedicationStackScheduleInput = z.infer<
  typeof medicationStackScheduleInputSchema
>;

export const medicationStackScheduleSchema = z.object({
  schedule_type_id: stackScheduleTypeSchema,
  time_of_day: z.string().nullable(),
  days_of_week: z.array(z.number().int().min(0).max(6)).nullable(),
  interval_days: z.number().int().nullable(),
  cycle_on_days: z.number().int().nullable(),
  cycle_off_days: z.number().int().nullable(),
  start_date: z.string().nullable(),
  version: z.number().int().positive(),
  updated_at: z.string(),
});
export type MedicationStackSchedule = z.infer<
  typeof medicationStackScheduleSchema
>;

/** A member's timing as read from its plan: any rule type, so older plans can be shown next to the new timing. */
export const stackTimingViewSchema = z.object({
  schedule_type_id: z.string(),
  time_of_day: z.string().nullable(),
  days_of_week: z.array(z.number().int()).nullable(),
  interval_days: z.number().int().nullable(),
  cycle_on_days: z.number().int().nullable(),
  cycle_off_days: z.number().int().nullable(),
  start_date: z.string().nullable(),
});
export type StackTimingView = z.infer<typeof stackTimingViewSchema>;

/** What the stack schedule does to one member. */
export const stackMemberActionSchema = z.enum([
  'unchanged',
  'edit',
  'revise',
  'blocked',
  'skipped',
  'pending',
]);
export type StackMemberAction = z.infer<typeof stackMemberActionSchema>;

/** Why a member is not following the schedule; the apps own the wording. */
export const stackNotFollowingReasonSchema = z.enum([
  'has_own_schedule',
  'paused',
  'follows_other_stack',
  'latest_not_applied',
  'only_as_needed',
  'not_bound',
]);
export type StackNotFollowingReason = z.infer<
  typeof stackNotFollowingReasonSchema
>;

export const stackMemberScheduleStatusSchema = z.enum([
  'following',
  'pending',
  'not_following',
  'no_schedule',
]);
export type StackMemberScheduleStatus = z.infer<
  typeof stackMemberScheduleStatusSchema
>;

export const medicationStackScheduleReviewInputSchema = z
  .object({
    schedule: medicationStackScheduleInputSchema,
    effective_from: medicationCourseDaySchema.optional(),
  })
  .strict();
export type MedicationStackScheduleReviewInput = z.infer<
  typeof medicationStackScheduleReviewInputSchema
>;

export const medicationStackScheduleReviewMemberSchema = z.object({
  medication_id: uuid,
  name: z.string(),
  action: stackMemberActionSchema,
  current_timing: z.array(stackTimingViewSchema).nullable(),
  new_timing: stackTimingViewSchema,
  reason: stackNotFollowingReasonSchema.nullable(),
  /** The other stack, when the reason is follows_other_stack. */
  reason_stack_name: z.string().nullable(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  needs_ack: z.boolean(),
});
export type MedicationStackScheduleReviewMember = z.infer<
  typeof medicationStackScheduleReviewMemberSchema
>;

export const medicationStackScheduleReviewSchema = z.object({
  /** 0 when the stack has no schedule yet. */
  expected_version: z.number().int().nonnegative(),
  review_fingerprint: z.string().min(1),
  today: medicationCourseDaySchema,
  effective_from: medicationCourseDaySchema,
  members: z.array(medicationStackScheduleReviewMemberSchema),
  /** Members the save leaves out; the save must echo this list. */
  skipped_member_ids: z.array(uuid),
});
export type MedicationStackScheduleReview = z.infer<
  typeof medicationStackScheduleReviewSchema
>;

export const medicationStackScheduleSaveInputSchema = z
  .object({
    schedule: medicationStackScheduleInputSchema,
    operation_id: uuid,
    expected_version: z.number().int().nonnegative(),
    review_fingerprint: z.string().min(1),
    effective_from: medicationCourseDaySchema,
    skipped_member_ids: z.array(uuid).default([]),
    acknowledged_member_ids: z.array(uuid).default([]),
  })
  .strict();
export type MedicationStackScheduleSaveInput = z.infer<
  typeof medicationStackScheduleSaveInputSchema
>;

export const medicationStackScheduleClearInputSchema = z
  .object({
    operation_id: uuid,
    expected_version: z.number().int().positive(),
  })
  .strict();
export type MedicationStackScheduleClearInput = z.infer<
  typeof medicationStackScheduleClearInputSchema
>;

export const medicationStackScheduleAppliedSchema = z.object({
  medication_id: uuid,
  action: stackMemberActionSchema,
  course_id: uuid.nullable(),
  revision_id: uuid.nullable(),
  version: z.number().int().positive().nullable(),
});
export const medicationStackScheduleResultSchema = z.object({
  operation_id: uuid,
  schedule: medicationStackScheduleSchema,
  applied: z.array(medicationStackScheduleAppliedSchema),
});
export type MedicationStackScheduleResult = z.infer<
  typeof medicationStackScheduleResultSchema
>;
