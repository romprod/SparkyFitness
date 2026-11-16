import { z } from 'zod';

export const injectionEntriesIdSchema = z.string().or(z.number());

export const injectionEntriesSchema = z.object({
  id: z.string().optional(),
  medication_id: z.string().nullable().optional(),
  user_id: z.string(),
  volume_ml: z.string().nullable().optional(),
  syringe_units: z.string().nullable().optional(),
  dose_input_unit: z.string().nullable().optional(),
  administration_route: z.enum(['injection', 'nasal']).nullable().optional(),
  syringe_id: z.string().uuid().nullable().optional(),
  pen_id: z.string().nullable().optional(),
  preparation_id: z.string().uuid().nullable().optional(),
  medication_name_snapshot: z.string().nullable().optional(),
  course_origin: z.boolean().nullable().optional(),
  course_revision_id: z.string().uuid().nullable().optional(),
  course_rule_id: z.string().uuid().nullable().optional(),
  course_step_id: z.string().uuid().nullable().optional(),
  scheduled_day: z.string().nullable().optional(),
  course_slot_key: z.string().nullable().optional(),
  scheduled_for: z.date().nullable().optional(),
  injected_at: z.date(),
  entry_date: z.date(),
  site: z.string().nullable().optional(),
  dose_mg: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string(),
  custom_fields: z.unknown(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const injectionEntriesInitializerSchema = z.object({
  id: z.string().optional(),
  medication_id: z.string().nullable().optional(),
  user_id: z.string().optional(),
  volume_ml: z.string().nullable().optional(),
  syringe_units: z.string().nullable().optional(),
  dose_input_unit: z.string().nullable().optional(),
  administration_route: z.enum(['injection', 'nasal']).nullable().optional(),
  syringe_id: z.string().uuid().nullable().optional(),
  pen_id: z.string().nullable().optional(),
  preparation_id: z.string().uuid().nullable().optional(),
  medication_name_snapshot: z.string().nullable().optional(),
  course_origin: z.boolean().nullable().optional(),
  course_revision_id: z.string().uuid().nullable().optional(),
  course_rule_id: z.string().uuid().nullable().optional(),
  course_step_id: z.string().uuid().nullable().optional(),
  scheduled_day: z.string().nullable().optional(),
  course_slot_key: z.string().nullable().optional(),
  scheduled_for: z.date().nullable().optional(),
  injected_at: z.date().optional(),
  entry_date: z.date().optional(),
  site: z.string().nullable().optional(),
  dose_mg: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().optional(),
  custom_fields: z.unknown().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const injectionEntriesMutatorSchema =
  injectionEntriesInitializerSchema.partial();

export type InjectionEntries = z.infer<typeof injectionEntriesSchema>;
export type InjectionEntriesInitializer = z.infer<
  typeof injectionEntriesInitializerSchema
>;
export type InjectionEntriesMutator = z.infer<
  typeof injectionEntriesMutatorSchema
>;
