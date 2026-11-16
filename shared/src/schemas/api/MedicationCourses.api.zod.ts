import { Decimal } from 'decimal.js';
import { z } from 'zod';

/** Authored calendar boundaries; actual administrations keep their own tracking day. */
export const medicationCourseDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day
    );
  }, 'Enter a valid calendar date');
export const medicationCourseInstantSchema = z
  .string()
  .datetime({ offset: true });
export const medicationCourseDoseSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const dose = new Decimal(value);
      if (
        dose.isFinite() &&
        dose.gt(0) &&
        dose.e <= 131071 &&
        dose.decimalPlaces() <= 16383
      )
        return dose.toString();
    } catch {
      /* The same validation issue covers invalid decimals. */
    }
    context.addIssue({
      code: 'custom',
      message: 'Enter a finite positive dose',
    });
    return z.NEVER;
  });
export const medicationCourseStatusSchema = z.enum([
  'active',
  'paused',
  'completed',
]);
export const medicationCourseBucketSchema = z.enum([
  'active',
  'scheduled',
  'paused',
  'ended',
  'completed',
]);
export const medicationCourseDeviceChoiceSchema = z.enum([
  'preferred',
  'explicit',
]);
export const medicationCourseDoseBasisSchema = z.enum([
  'per_injection',
  'per_week',
]);
const uuid = z.string().uuid();
const nullableDay = medicationCourseDaySchema.nullable();
const nullableInstant = medicationCourseInstantSchema.nullable();

/** The existing recurrence vocabulary, including distinct authored daily slots. */
export const medicationCourseRuleInputSchema = z
  .object({
    schedule_type_id: z.enum([
      'daily',
      'weekly',
      'specific_days',
      'every_n_days',
      'monthly',
      'cyclic',
      'taper',
      'prn',
    ]),
    time_of_day: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .nullable()
      .optional(),
    dose_amount: medicationCourseDoseSchema.nullable().optional(),
    days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    interval_days: z.number().int().positive().nullable().optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    cycle_on_days: z.number().int().positive().nullable().optional(),
    cycle_off_days: z.number().int().nonnegative().nullable().optional(),
    with_meal: z
      .enum(['before', 'with', 'after', 'away_from_meals'])
      .nullable()
      .optional(),
    prn_reason: z.string().nullable().optional(),
    prn_max_per_day: z.number().int().positive().nullable().optional(),
    start_date: nullableDay.optional(),
    end_date: nullableDay.optional(),
    anchor_date: nullableDay.optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    const missing = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (
      (rule.schedule_type_id === 'weekly' ||
        rule.schedule_type_id === 'specific_days') &&
      !rule.days_of_week?.length
    )
      missing('days_of_week', 'Choose at least one authored weekday');
    if (rule.schedule_type_id === 'every_n_days' && !rule.interval_days)
      missing('interval_days', 'Enter the authored interval');
    if (rule.schedule_type_id === 'monthly' && !rule.day_of_month)
      missing('day_of_month', 'Enter the authored day of month');
    if (rule.schedule_type_id === 'cyclic' && !rule.cycle_on_days)
      missing('cycle_on_days', 'Enter the authored active cycle length');
  });
export const medicationCourseStepInputSchema = z
  .object({
    dose: medicationCourseDoseSchema,
    dose_unit: z.string().trim().min(1),
    duration_days: z.number().int().nonnegative().nullable(),
    notes: z.string().nullable().optional(),
  })
  .strict();
export const medicationCoursePlanInputSchema = z
  .object({
    device_id: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1),
    notes: z.string().nullable().optional(),
    start_date: medicationCourseDaySchema,
    end_date: nullableDay.optional(),
    cycle_anchor_date: nullableDay.optional(),
    target_dose: medicationCourseDoseSchema.nullable().optional(),
    dose_unit: z.string().trim().min(1),
    dose_basis: medicationCourseDoseBasisSchema.default('per_injection'),
    rules: z.array(medicationCourseRuleInputSchema).min(1),
    steps: z.array(medicationCourseStepInputSchema).default([]),
  })
  .strict();
export const medicationCourseHandoffInputSchema = z
  .object({
    cutover_day: medicationCourseDaySchema,
    selected_rules: z
      .array(
        z
          .object({
            schedule_id: uuid,
            fingerprint: z.string().min(1),
          })
          .strict()
      )
      .min(1),
  })
  .strict();
const mutationFields = {
  operation_id: uuid,
  expected_version: z.number().int().nonnegative(),
};
export const medicationCourseCreateInputSchema = medicationCoursePlanInputSchema
  .extend({
    ...mutationFields,
    medication_id: uuid,
    handoff: medicationCourseHandoffInputSchema.optional(),
    native_reminder_limitation_acknowledged: z.boolean(),
    review_fingerprint: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.handoff && !value.review_fingerprint)
      context.addIssue({
        code: 'custom',
        path: ['review_fingerprint'],
        message: 'Review the selected legacy rules before confirming handoff',
      });
    if (value.handoff && !value.native_reminder_limitation_acknowledged)
      context.addIssue({
        code: 'custom',
        path: ['native_reminder_limitation_acknowledged'],
        message:
          'Acknowledge website availability and the native reminder limitation',
      });
  });
export const medicationCourseEditInputSchema = medicationCoursePlanInputSchema
  .extend(mutationFields)
  .strict();
export const medicationCourseReviseInputSchema = medicationCoursePlanInputSchema
  .extend({
    ...mutationFields,
    start_date: medicationCourseDaySchema,
    review_fingerprint: z.string().min(1),
  })
  .strict();
export const medicationCourseStatusInputSchema = z
  .object({
    ...mutationFields,
    status: medicationCourseStatusSchema,
  })
  .strict();
export const medicationCourseDeleteInputSchema = z
  .object(mutationFields)
  .strict();
export const medicationCourseReviewInputSchema = medicationCoursePlanInputSchema
  .extend({
    expected_version: z.number().int().nonnegative(),
    handoff: medicationCourseHandoffInputSchema.optional(),
  })
  .strict();

/** Explicit attribution only: omitted fields retain legacy unassigned logging. */
export const medicationCourseAttributionInputSchema = z
  .object({
    course_revision_id: uuid.nullable().optional(),
    course_rule_id: uuid.nullable().optional(),
    course_step_id: uuid.nullable().optional(),
    scheduled_for: nullableInstant.optional(),
    scheduled_day: nullableDay.optional(),
    course_slot_key: z.string().min(1).nullable().optional(),
    course_expected_version: z.number().int().positive().optional(),
  })
  .superRefine((value, context) => {
    if (
      !value.course_revision_id &&
      (value.course_rule_id ||
        value.course_step_id ||
        value.course_slot_key ||
        value.course_expected_version)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['course_revision_id'],
        message:
          'A course revision is required for explicit course attribution',
      });
    }
    if (value.course_slot_key && !value.course_rule_id) {
      context.addIssue({
        code: 'custom',
        path: ['course_rule_id'],
        message: 'A course rule is required for a scheduled course slot',
      });
    }
  });

export const medicationCourseRuleSchema =
  medicationCourseRuleInputSchema.safeExtend({
    id: uuid,
    user_id: uuid,
    revision_id: uuid,
    rule_index: z.number().int().nonnegative(),
  });
export const medicationCourseStepSchema =
  medicationCourseStepInputSchema.extend({
    id: uuid,
    user_id: uuid,
    revision_id: uuid,
    step_index: z.number().int().nonnegative(),
  });
export const medicationCourseActivitySchema = z.object({
  id: uuid,
  user_id: uuid,
  revision_id: uuid,
  from_at: medicationCourseInstantSchema,
  until_at: nullableInstant,
});
export const medicationCourseRevisionSchema = z.object({
  id: uuid,
  user_id: uuid,
  course_id: uuid,
  predecessor_id: uuid.nullable(),
  device_id: uuid.nullable(),
  device_choice: medicationCourseDeviceChoiceSchema,
  revision_no: z.number().int().positive(),
  name: z.string(),
  notes: z.string().nullable(),
  status: medicationCourseStatusSchema,
  start_date: medicationCourseDaySchema,
  end_date: nullableDay,
  closed_date: nullableDay,
  cycle_anchor_date: nullableDay,
  target_dose: medicationCourseDoseSchema.nullable(),
  dose_unit: z.string(),
  dose_basis: medicationCourseDoseBasisSchema,
  created_at: medicationCourseInstantSchema,
  deleted_at: nullableInstant,
  rules: z.array(medicationCourseRuleSchema),
  steps: z.array(medicationCourseStepSchema),
  activity: z.array(medicationCourseActivitySchema),
});
export const medicationCourseSchema = z.object({
  id: uuid,
  user_id: uuid,
  medication_id: uuid.nullable(),
  medication_name_snapshot: z.string(),
  current_revision_id: uuid.nullable(),
  version: z.number().int().positive(),
  captured_at: medicationCourseInstantSchema,
  capture_day: medicationCourseDaySchema,
  timezone: z.string().min(1),
  deleted_at: nullableInstant,
  revisions: z.array(medicationCourseRevisionSchema),
});
export const medicationCourseDeviceBindingSchema = z
  .object({
    choice: medicationCourseDeviceChoiceSchema,
    device_id: uuid.nullable(),
    device_name: z.string().nullable(),
    source: z.enum(['plan', 'preferred', 'missing', 'incompatible']),
  })
  .superRefine((binding, context) => {
    if (
      (binding.source === 'preferred' && binding.choice !== 'preferred') ||
      (binding.source === 'plan' && binding.choice !== 'explicit')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Resolved device source must preserve the authored choice',
      });
    }
    if (
      (binding.source === 'plan' || binding.source === 'preferred') &&
      binding.device_id === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A resolved device must reference a real saved device',
      });
    }
    if (
      binding.choice === 'explicit' &&
      binding.device_id === null &&
      binding.source !== 'missing'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A deleted explicit selection remains missing until an explicit choice',
      });
    }
  });
export const medicationCourseReviewSchema = z.object({
  device_binding: medicationCourseDeviceBindingSchema,
  timezone: z.string().min(1),
  expected_version: z.number().int().nonnegative(),
  review_fingerprint: z.string().min(1),
  material_changes: z.array(z.string()),
  requires_revision: z.boolean(),
  plan: medicationCoursePlanInputSchema,
  warnings: z.array(z.string()),
  resumed_dose: z.string().nullable(),
  resumed_dose_unit: z.string().nullable(),
  carried_steps: z.array(medicationCourseStepInputSchema),
  phase_progress_known: z.boolean(),
});
export const medicationCourseMutationResultSchema = z.object({
  course_id: uuid,
  revision_id: uuid.nullable(),
  version: z.number().int().positive(),
  operation_id: uuid,
});
export type MedicationCourseRuleInput = z.infer<
  typeof medicationCourseRuleInputSchema
>;
export type MedicationCourseStepInput = z.infer<
  typeof medicationCourseStepInputSchema
>;
export type MedicationCoursePlanInput = z.infer<
  typeof medicationCoursePlanInputSchema
>;
export type MedicationCourseHandoffInput = z.infer<
  typeof medicationCourseHandoffInputSchema
>;
export type MedicationCourseCreateInput = z.infer<
  typeof medicationCourseCreateInputSchema
>;
export type MedicationCourseEditInput = z.infer<
  typeof medicationCourseEditInputSchema
>;
export type MedicationCourseReviseInput = z.infer<
  typeof medicationCourseReviseInputSchema
>;
export type MedicationCourseReviewInput = z.infer<
  typeof medicationCourseReviewInputSchema
>;
export type MedicationCourseStatusInput = z.infer<
  typeof medicationCourseStatusInputSchema
>;
export type MedicationCourseDeleteInput = z.infer<
  typeof medicationCourseDeleteInputSchema
>;
export type MedicationCourseAttributionInput = z.infer<
  typeof medicationCourseAttributionInputSchema
>;
export type MedicationCourseRule = z.infer<typeof medicationCourseRuleSchema>;
export type MedicationCourseStep = z.infer<typeof medicationCourseStepSchema>;
export type MedicationCourseActivity = z.infer<
  typeof medicationCourseActivitySchema
>;
export type MedicationCourseRevision = z.infer<
  typeof medicationCourseRevisionSchema
>;
export type MedicationCourse = z.infer<typeof medicationCourseSchema>;
export type MedicationCourseReview = z.infer<
  typeof medicationCourseReviewSchema
>;
export type MedicationCourseMutationResult = z.infer<
  typeof medicationCourseMutationResultSchema
>;
export type MedicationCourseStatus = z.infer<
  typeof medicationCourseStatusSchema
>;
export type MedicationCourseBucket = z.infer<
  typeof medicationCourseBucketSchema
>;

export const medicationCourseHandoffCandidateSchema = z.object({
  schedule_id: uuid,
  rule: medicationCourseRuleInputSchema,
  fingerprint: z.string().min(1),
  already_handed_off: z.boolean(),
});
export type MedicationCourseHandoffCandidate = z.infer<
  typeof medicationCourseHandoffCandidateSchema
>;

export const medicationCourseExpectedSlotSchema = z.object({
  course_id: uuid,
  schedule_type_id: z.string(),
  course_revision_id: uuid,
  course_rule_id: uuid,
  course_step_id: uuid.nullable(),
  course_slot_key: z.string(),
  course_expected_version: z.number().int().positive(),
  medication_id: uuid.nullable(),
  scheduled_day: medicationCourseDaySchema,
  time_of_day: z.string().nullable(),
  scheduled_for: nullableInstant,
  // A positive authored amount may round to zero at the source projection precision.
  per_dose_amount: z.string().nullable(),
  authored_dose: medicationCourseDoseSchema.nullable(),
  dose_unit: z.string(),
  dose_basis: medicationCourseDoseBasisSchema,
  phase_progress_known: z.boolean(),
});
export const medicationCourseScoredSlotSchema =
  medicationCourseExpectedSlotSchema.extend({
    status: z.enum(['taken', 'missed', 'pending', 'skipped']),
    entry_id: uuid.nullable(),
  });
const count = z.number().int().nonnegative();
export const medicationCourseAdherenceSchema = z.object({
  captured_at: medicationCourseInstantSchema,
  taken: count,
  missed: count,
  pending: count,
  skipped: count,
  pct: z.number().min(0).max(100).nullable(),
  days: z.array(
    z.object({
      date: medicationCourseDaySchema,
      coverage: z.enum(['unavailable', 'partial', 'available']),
      taken: count,
      missed: count,
      pending: count,
      skipped: count,
      slots: z.array(medicationCourseScoredSlotSchema),
    })
  ),
});
export const medicationCourseActualSchema = z.object({
  id: uuid,
  course_origin: z.boolean().nullable(),
  source_kind: z.enum(['entry', 'injection']),
  course_revision_id: uuid.nullable(),
  course_rule_id: uuid.nullable(),
  course_step_id: uuid.nullable(),
  course_slot_key: z.string().nullable(),
  scheduled_day: nullableDay,
  scheduled_for: nullableInstant,
  entry_date: medicationCourseDaySchema,
  occurred_at: medicationCourseInstantSchema,
  status: z.string(),
  medication_name: z.string().nullable(),
  dose_amount: z.string().nullable(),
  dose_unit: z.string().nullable(),
  dose_mg_exact: z.string().nullable(),
  volume_ml: z.string().nullable(),
  site: z.string().nullable(),
  notes: z.string().nullable(),
  administration_route: z.string().nullable(),
});
export const medicationCourseHistorySchema = z.object({
  course: medicationCourseSchema,
  from_date: medicationCourseDaySchema,
  to_date: medicationCourseDaySchema,
  today: medicationCourseDaySchema,
  timezone: z.string(),
  adherence: medicationCourseAdherenceSchema,
  actuals: z.array(medicationCourseActualSchema),
});
/** Authoritative completion for requested slots, independently of actual administration day. */
export const medicationCourseSlotFulfilmentSchema = z.object({
  course_revision_id: uuid,
  course_rule_id: uuid,
  course_slot_key: z.string().min(1),
  scheduled_day: medicationCourseDaySchema,
  status: z.enum(['taken', 'skipped']),
  source_kind: z.enum(['entry', 'injection']),
  entry_id: uuid,
  occurred_at: medicationCourseInstantSchema,
  entry_date: medicationCourseDaySchema,
});
export const medicationCourseDueSchema = z.object({
  courses: z.array(medicationCourseSchema),
  slots: z.array(medicationCourseExpectedSlotSchema),
  fulfilled_slots: z.array(medicationCourseSlotFulfilmentSchema),
  today: medicationCourseDaySchema,
  timezone: z.string(),
});
export type MedicationCourseExpectedSlot = z.infer<
  typeof medicationCourseExpectedSlotSchema
>;
export type MedicationCourseAdherence = z.infer<
  typeof medicationCourseAdherenceSchema
>;
export type MedicationCourseActual = z.infer<
  typeof medicationCourseActualSchema
>;
export type MedicationCourseHistory = z.infer<
  typeof medicationCourseHistorySchema
>;
export type MedicationCourseDue = z.infer<typeof medicationCourseDueSchema>;

export type MedicationCourseSlotFulfilment = z.infer<
  typeof medicationCourseSlotFulfilmentSchema
>;

export type MedicationCourseDeviceChoice = z.infer<
  typeof medicationCourseDeviceChoiceSchema
>;
export type MedicationCourseDeviceBinding = z.infer<
  typeof medicationCourseDeviceBindingSchema
>;
