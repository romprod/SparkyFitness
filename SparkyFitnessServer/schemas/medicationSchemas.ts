import {
  calculatedDrawInputSchema,
  medicationPreparationQueueStateSchema,
  medicationCourseAttributionInputSchema,
} from '@workspace/shared';
import {
  medicationPreparationInputSchema,
  medicationVialLabelMassSchema,
} from '@workspace/shared';
import { z } from 'zod/v4';
import { optionalNullableNumber, optionalNullableInt } from './schema.utils.js';

const customFields = z.record(z.string(), z.unknown()).nullable().optional();
const optionalNullableString = z.string().nullable().optional();
const optionalDateString = z.string().nullable().optional(); // 'YYYY-MM-DD'
const nutrientValue = z.number().finite().nonnegative();
// A dose amount, when present, must be positive. Beyond being a sane display quantity, for
// a supplement it becomes the report's per-entry dose multiplier (COALESCE(ms.dose_amount,
// m.dose_amount)), where a zero or negative value would silently zero or subtract every
// nutrient in the daily total.
const positiveDoseAmount = z
  .number()
  .finite()
  .positive('dose_amount must be greater than 0')
  .nullable()
  .optional();

export const MedicationNutrientsSchema = z
  .object({
    calories: nutrientValue.optional(),
    protein: nutrientValue.optional(),
    carbs: nutrientValue.optional(),
    fat: nutrientValue.optional(),
    saturated_fat: nutrientValue.optional(),
    polyunsaturated_fat: nutrientValue.optional(),
    monounsaturated_fat: nutrientValue.optional(),
    trans_fat: nutrientValue.optional(),
    cholesterol: nutrientValue.optional(),
    sodium: nutrientValue.optional(),
    potassium: nutrientValue.optional(),
    dietary_fiber: nutrientValue.optional(),
    sugars: nutrientValue.optional(),
    vitamin_a: nutrientValue.optional(),
    vitamin_c: nutrientValue.optional(),
    calcium: nutrientValue.optional(),
    iron: nutrientValue.optional(),
    // Kept in step with the food_variants nutrient columns. The micronutrient
    // catalog offers Caffeine against fixedField caffeine_mg and the caffeine
    // kinetics query already reads nutrients_snapshot->>'caffeine_mg' off a
    // supplement, but this strict schema rejected the field -- so a
    // caffeinated supplement could be picked in the UI and never saved, and
    // the dose arm that reads it could never have any rows.
    caffeine_mg: nutrientValue.optional(),
    water_ml: nutrientValue.optional(),
    alcohol_g: nutrientValue.optional(),
    custom_nutrients: z.record(z.string(), nutrientValue).optional(),
  })
  .strict();
export type MedicationNutrients = z.infer<typeof MedicationNutrientsSchema>;

// --------------------------------------------------------------------------
// Medications
// --------------------------------------------------------------------------
const MedicationFieldsSchema = z.object({
  name: z.string().min(1, 'name is required'),
  display_name: optionalNullableString,
  type_id: optionalNullableString,
  route_id: optionalNullableString,
  strength_value: optionalNullableNumber,
  strength_unit: optionalNullableString,
  dose_amount: positiveDoseAmount,
  dose_unit: optionalNullableString,
  rxnorm_rxcui: optionalNullableString,
  ndc: optionalNullableString,
  prescriber: optionalNullableString,
  pharmacy: optionalNullableString,
  rx_number: optionalNullableString,
  reason_text: optionalNullableString,
  effectiveness_rating: optionalNullableInt,
  color: optionalNullableString,
  icon: optionalNullableString,
  photo_path: optionalNullableString,
  is_active: z.boolean().optional(),
  is_quick: z.boolean().optional(),
  is_glp1: z.boolean().optional(),
  is_supplement: z.boolean().optional(),
  nutrients: MedicationNutrientsSchema.optional(),
  notes: optionalNullableString,
  source: z.string().optional(),
  custom_fields: customFields,
});

export const CreateMedicationBodySchema = MedicationFieldsSchema.loose();
export type CreateMedicationBody = z.infer<typeof CreateMedicationBodySchema>;

// Update is a partial patch — every field optional, including name.
export const UpdateMedicationBodySchema =
  MedicationFieldsSchema.partial().loose();
export type UpdateMedicationBody = z.infer<typeof UpdateMedicationBodySchema>;

// --------------------------------------------------------------------------
// Schedules
// --------------------------------------------------------------------------
export const CreateScheduleBodySchema = z
  .object({
    schedule_type_id: z.string().min(1, 'schedule_type_id is required'),
    time_of_day: optionalNullableString, // 'HH:MM' or 'HH:MM:SS'
    dose_amount: positiveDoseAmount,
    days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    interval_days: optionalNullableInt,
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    cycle_on_days: optionalNullableInt,
    cycle_off_days: optionalNullableInt,
    with_meal: z
      .enum(['before', 'with', 'after', 'away_from_meals'])
      .nullable()
      .optional(),
    prn_reason: optionalNullableString,
    prn_max_per_day: optionalNullableInt,
    start_date: optionalDateString,
    end_date: optionalDateString,
    active: z.boolean().optional(),
    source: z.string().optional(),
    custom_fields: customFields,
  })
  .loose();
export type CreateScheduleBody = z.infer<typeof CreateScheduleBodySchema>;

// Update is a partial patch — every field optional, including schedule_type_id.
export const UpdateScheduleBodySchema = CreateScheduleBodySchema.partial();
export type UpdateScheduleBody = z.infer<typeof UpdateScheduleBodySchema>;

// Moving schedules: end the named rules on `end_date` and start copies on `new_start_date`.
// Weekly rules rotate by `rotate_days`; an every-N-days rule counts on from the dose day, so it
// takes no rotation. The repository checks the dates against each rule.
export const MoveSchedulesBodySchema = z
  .object({
    schedule_ids: z.array(z.string().uuid()).min(1).max(20),
    end_date: z.iso.date(),
    new_start_date: z.iso.date(),
    rotate_days: z.number().int().min(1).max(6).optional(),
  })
  .strict();
export type MoveSchedulesBody = z.infer<typeof MoveSchedulesBodySchema>;

// --------------------------------------------------------------------------
// Pens / vials
// --------------------------------------------------------------------------
const PenFieldsSchema = z.object({
  prescription_id: z.string().uuid().nullable().optional(),
  label_mass_mg: medicationVialLabelMassSchema.nullable().optional(),
  preparation: medicationPreparationInputSchema.optional(),
  lifecycle_intent: z.boolean().optional(),
  lot_number: z.string().trim().max(500).nullable().optional(),
  storage_location: z.string().trim().max(500).nullable().optional(),
  bud_mode: z.enum(['date', 'interval']).nullable().optional(),
  bud_interval_days: z.number().int().min(0).max(36500).nullable().optional(),
  bud_base_date: z.iso.date().nullable().optional(),
  bud_source: z.string().trim().max(1000).nullable().optional(),
  kind: z.enum(['pen', 'vial']).optional(),
  label: optionalNullableString,
  dose_mg: z.number().finite().positive().nullable().optional(),
  concentration_mg_ml: z.number().finite().positive().nullable().optional(),
  volume_ml: z.number().finite().positive().nullable().optional(),
  doses_total: optionalNullableInt,
  doses_used: optionalNullableInt,
  status: z.enum(['sealed', 'in_use', 'finished', 'discarded']).optional(),
  opened_at: optionalDateString,
  expiry_date: optionalDateString,
  bud_date: z.iso.date().nullable().optional(),
  reorder_flag: z.boolean().optional(),
  reorder_threshold: optionalNullableInt,
  notes: optionalNullableString,
  source: z.string().optional(),
  custom_fields: customFields,
});
export const CreatePenBodySchema = PenFieldsSchema.loose().superRefine(
  (data, context) => {
    if (data.expected_preparation_queue_state !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['expected_preparation_queue_state'],
        message: 'Queued preparation applies only to an existing stock item.',
      });
    if (
      data.label_mass_mg !== null &&
      data.label_mass_mg !== undefined &&
      data.kind !== 'vial'
    )
      context.addIssue({
        code: 'custom',
        path: ['label_mass_mg'],
        message: 'A vial label amount requires vial stock.',
      });
  }
);
export type CreatePenBody = z.infer<typeof CreatePenBodySchema>;
export const UpdatePenBodySchema = PenFieldsSchema.partial()
  .extend({
    expected_preparation_queue_state:
      medicationPreparationQueueStateSchema.optional(),
  })
  .loose()
  .superRefine((data, context) => {
    if (
      data.expected_preparation_queue_state !== undefined &&
      !data.preparation
    )
      context.addIssue({
        code: 'custom',
        path: ['preparation'],
        message:
          'A queued preparation confirmation requires a preparation payload.',
      });
  });
export type UpdatePenBody = z.infer<typeof UpdatePenBodySchema>;

// --------------------------------------------------------------------------
// Injections
// --------------------------------------------------------------------------
export const CreateInjectionBodySchema = z
  .object({
    ...medicationCourseAttributionInputSchema.shape,
    medication_id: z.string().uuid(),
    calculated_draw: calculatedDrawInputSchema.optional(),
    pen_id: z.string().uuid().nullable().optional(),
    injected_at: z.string().nullable().optional(), // ISO timestamp
    entry_date: optionalDateString,
    site: optionalNullableString,
    dose_mg: z.number().finite().positive().nullable().optional(),
    notes: optionalNullableString,
    /**
     * when true, increment the pen's doses_used in the same txn; with a pen_id that pen is
     * used, without one the best candidate pen is auto-picked (in-use first, else oldest
     * sealed with doses remaining)
     */
    deduct_pen: z.boolean().optional(),
    source: z.string().optional(),
    custom_fields: customFields,
  })
  .loose()
  .superRefine((data, context) => {
    for (const field of [
      'course_origin',
      'medication_name_snapshot',
      'phase_family_id',
    ])
      if (Object.prototype.hasOwnProperty.call(data, field))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'This historical snapshot is set by the server.',
        });
    if ((data.scheduled_for || data.scheduled_day) && !data.course_slot_key)
      context.addIssue({
        code: 'custom',
        path: ['scheduled_for'],
        message:
          'A saved scheduled timestamp requires an explicit course slot.',
      });
    const hasCourseMetadata =
      data.course_revision_id ||
      data.course_rule_id ||
      data.course_step_id ||
      data.course_slot_key ||
      data.scheduled_day ||
      data.course_expected_version;
    if (!hasCourseMetadata) return;
    const attribution = medicationCourseAttributionInputSchema.safeParse(data);
    if (!attribution.success) {
      for (const issue of attribution.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    }
  });
export type CreateInjectionBody = z.infer<typeof CreateInjectionBodySchema>;

// Update is a partial patch. pen_id/deduct_pen are deliberately excluded — inventory
// deduction can't be re-pointed after the fact; delete and re-log instead.
export const UpdateInjectionBodySchema = z
  .object({
    ...medicationCourseAttributionInputSchema.shape,
    calculated_draw: calculatedDrawInputSchema.optional(),
    injected_at: z.string().nullable().optional(), // ISO timestamp
    entry_date: optionalDateString,
    site: optionalNullableString,
    dose_mg: z.number().finite().nonnegative().nullable().optional(),
    notes: optionalNullableString,
    source: z.string().optional(),
    custom_fields: customFields,
  })
  .loose()
  .superRefine((data, context) => {
    for (const field of [
      'course_origin',
      'medication_name_snapshot',
      'phase_family_id',
    ])
      if (Object.prototype.hasOwnProperty.call(data, field))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'This historical snapshot is set by the server.',
        });
    const hasCourseMetadata =
      data.course_revision_id ||
      data.course_rule_id ||
      data.course_step_id ||
      data.course_slot_key ||
      data.scheduled_day ||
      data.course_expected_version;
    if (!hasCourseMetadata) return;
    const attribution = medicationCourseAttributionInputSchema.safeParse(data);
    if (!attribution.success) {
      for (const issue of attribution.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    }
  });
export type UpdateInjectionBody = z.infer<typeof UpdateInjectionBodySchema>;

// --------------------------------------------------------------------------
// Titration / taper steps
// --------------------------------------------------------------------------
export const CreateTitrationStepBodySchema = z
  .object({
    dose_mg: z.number(),
    dose_unit: z.string().optional(),
    start_date: optionalDateString,
    planned_weeks: optionalNullableInt,
    step_order: optionalNullableInt,
    status: z.enum(['done', 'active', 'planned']).optional(),
    is_taper: z.boolean().optional(),
    note: optionalNullableString,
    source: z.string().optional(),
    custom_fields: customFields,
  })
  .loose();
export type CreateTitrationStepBody = z.infer<
  typeof CreateTitrationStepBodySchema
>;

// Update is a partial patch — every field optional, including dose_mg.
export const UpdateTitrationStepBodySchema =
  CreateTitrationStepBodySchema.partial();
export type UpdateTitrationStepBody = z.infer<
  typeof UpdateTitrationStepBodySchema
>;

// --------------------------------------------------------------------------
// Param / query schemas
// --------------------------------------------------------------------------
export const MedicationIdParamSchema = z
  .object({ medicationId: z.string().uuid() })
  .loose();
export type MedicationIdParam = z.infer<typeof MedicationIdParamSchema>;

/**
 * A boolean query flag. `z.coerce.boolean()` treats every non-empty string, including "false",
 * as true, so a caller asking for activeOnly=false silently got true. Words are read as words.
 */
const queryFlag = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const word = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(word)) return true;
  if (['false', '0', 'no', 'off', ''].includes(word)) return false;
  return value;
}, z.boolean().optional());

export const ListMedicationsQuerySchema = z
  .object({
    glp1Only: queryFlag,
    activeOnly: queryFlag,
  })
  .loose();
export type ListMedicationsQuery = z.infer<typeof ListMedicationsQuerySchema>;

export const SerumCurveQuerySchema = z
  .object({
    fromDay: z.coerce.number().optional(),
    toDay: z.coerce.number().optional(),
    stepDays: z.coerce.number().optional(),
  })
  .loose();
export type SerumCurveQuery = z.infer<typeof SerumCurveQuerySchema>;

// --------------------------------------------------------------------------
// Medication Entries
// --------------------------------------------------------------------------
export const CreateMedicationEntryBodySchema = z
  .object({
    ...medicationCourseAttributionInputSchema.shape,
    medication_id: z.string().uuid(),
    schedule_id: z.string().uuid().nullable().optional(),
    status: z.enum(['taken', 'skipped', 'snoozed', 'prn_taken']).optional(),
    taken_at: z.string().nullable().optional(),
    scheduled_for: z.string().nullable().optional(),
    entry_date: optionalDateString,
    med_name_snapshot: optionalNullableString,
    dose_amount_snapshot: optionalNullableNumber,
    dose_unit_snapshot: optionalNullableString,
    notes: optionalNullableString,
    source: z.string().optional(),
    custom_fields: customFields,
    pack_id: z.string().uuid().optional(),
    deduct_pack: z.boolean().optional(),
  })
  .loose()
  .superRefine((data, context) => {
    if (Object.prototype.hasOwnProperty.call(data, 'phase_family_id'))
      context.addIssue({
        code: 'custom',
        path: ['phase_family_id'],
        message: 'Phase provenance is set by the server.',
      });
    if (Object.prototype.hasOwnProperty.call(data, 'course_origin'))
      context.addIssue({
        code: 'custom',
        path: ['course_origin'],
        message: 'This historical origin is set by the server.',
      });
    if (data.course_revision_id && data.schedule_id)
      context.addIssue({
        code: 'custom',
        path: ['schedule_id'],
        message: 'Select either a managed course or a legacy schedule.',
      });
    const hasCourseMetadata =
      data.course_revision_id ||
      data.course_rule_id ||
      data.course_step_id ||
      data.course_slot_key ||
      data.scheduled_day ||
      data.course_expected_version;
    if (!hasCourseMetadata) return;
    const attribution = medicationCourseAttributionInputSchema.safeParse(data);
    if (!attribution.success) {
      for (const issue of attribution.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    }
  });
export type CreateMedicationEntryBody = z.infer<
  typeof CreateMedicationEntryBodySchema
>;

// Update is a partial patch — chiefly for correcting the "when" (taken_at/entry_date)
// of a dose logged after the fact. medication_id is not editable.
export const UpdateMedicationEntryBodySchema = z
  .object({
    ...medicationCourseAttributionInputSchema.shape,
    schedule_id: z.string().uuid().nullable().optional(),
    status: z.enum(['taken', 'skipped', 'snoozed', 'prn_taken']).optional(),
    taken_at: z.string().nullable().optional(),
    scheduled_for: z.string().nullable().optional(),
    entry_date: optionalDateString,
    notes: optionalNullableString,
    custom_fields: customFields,
  })
  .loose()
  .superRefine((data, context) => {
    if (Object.prototype.hasOwnProperty.call(data, 'phase_family_id'))
      context.addIssue({
        code: 'custom',
        path: ['phase_family_id'],
        message: 'Phase provenance is set by the server.',
      });
    if (Object.prototype.hasOwnProperty.call(data, 'course_origin'))
      context.addIssue({
        code: 'custom',
        path: ['course_origin'],
        message: 'This historical origin is set by the server.',
      });
    if (data.course_revision_id && data.schedule_id)
      context.addIssue({
        code: 'custom',
        path: ['schedule_id'],
        message: 'Select either a managed course or a legacy schedule.',
      });
    const hasCourseMetadata =
      data.course_revision_id ||
      data.course_rule_id ||
      data.course_step_id ||
      data.course_slot_key ||
      data.scheduled_day ||
      data.course_expected_version;
    if (!hasCourseMetadata) return;
    const attribution = medicationCourseAttributionInputSchema.safeParse(data);
    if (!attribution.success) {
      for (const issue of attribution.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    }
  });
export type UpdateMedicationEntryBody = z.infer<
  typeof UpdateMedicationEntryBodySchema
>;

export const ListMedicationEntriesQuerySchema = z
  .object({
    fromDate: optionalDateString,
    toDate: optionalDateString,
    medicationId: z.string().uuid().optional(),
  })
  .loose();
export type ListMedicationEntriesQuery = z.infer<
  typeof ListMedicationEntriesQuerySchema
>;

// --------------------------------------------------------------------------
// Display Preferences
// --------------------------------------------------------------------------
export const UpdateMedicationDisplayPreferencesBodySchema = z
  .object({
    visible_items: z.array(z.string()),
  })
  .loose();
export type UpdateMedicationDisplayPreferencesBody = z.infer<
  typeof UpdateMedicationDisplayPreferencesBodySchema
>;

export const DisplayPreferenceParamsSchema = z.object({
  viewGroup: z.string().min(1).max(50),
  platform: z.string().min(1).max(20),
});
export type DisplayPreferenceParams = z.infer<
  typeof DisplayPreferenceParamsSchema
>;
