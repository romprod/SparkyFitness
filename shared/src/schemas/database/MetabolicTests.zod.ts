import { z } from 'zod';

export const metabolicTestsIdSchema = z.string().or(z.number());

export const metabolicTestsSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  tested_day: z.date(),
  method: z.string(),
  device_label: z.string().nullable().optional(),
  facility: z.string().nullable().optional(),
  measured_rmr_kcal: z.number(),
  kcal_per_litre_o2: z.number().nullable().optional(),
  vo2_ml_min: z.number().nullable().optional(),
  vco2_ml_min: z.number().nullable().optional(),
  rq: z.number().nullable().optional(),
  duration_min: z.number().int().nullable().optional(),
  steady_state_cv_pct: z.number().nullable().optional(),
  sex: z.string(),
  age_years: z.number(),
  height_cm: z.number(),
  weight_kg: z.number(),
  fat_free_mass_kg: z.number().nullable().optional(),
  reported_predicted_kcal: z.number().nullable().optional(),
  reported_prediction_equation: z.string().nullable().optional(),
  reported_activity_factor: z.number().nullable().optional(),
  reported_activity_label: z.string().nullable().optional(),
  prep_fasted: z.boolean().nullable().optional(),
  prep_fasting_hours: z.number().nullable().optional(),
  prep_no_caffeine: z.boolean().nullable().optional(),
  prep_no_training_prior_day: z.boolean().nullable().optional(),
  prep_active_travel: z.boolean().nullable().optional(),
  prep_rested: z.boolean().nullable().optional(),
  prep_rest_min_before_test: z.number().int().nullable().optional(),
  prep_illness_free_14d: z.boolean().nullable().optional(),
  prep_awake_quiet: z.boolean().nullable().optional(),
  room_temp_c: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const metabolicTestsInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  tested_day: z.date().optional(),
  method: z.string().optional(),
  device_label: z.string().nullable().optional(),
  facility: z.string().nullable().optional(),
  measured_rmr_kcal: z.number().optional(),
  kcal_per_litre_o2: z.number().nullable().optional(),
  vo2_ml_min: z.number().nullable().optional(),
  vco2_ml_min: z.number().nullable().optional(),
  rq: z.number().nullable().optional(),
  duration_min: z.number().int().nullable().optional(),
  steady_state_cv_pct: z.number().nullable().optional(),
  sex: z.string().optional(),
  age_years: z.number().optional(),
  height_cm: z.number().optional(),
  weight_kg: z.number().optional(),
  fat_free_mass_kg: z.number().nullable().optional(),
  reported_predicted_kcal: z.number().nullable().optional(),
  reported_prediction_equation: z.string().nullable().optional(),
  reported_activity_factor: z.number().nullable().optional(),
  reported_activity_label: z.string().nullable().optional(),
  prep_fasted: z.boolean().nullable().optional(),
  prep_fasting_hours: z.number().nullable().optional(),
  prep_no_caffeine: z.boolean().nullable().optional(),
  prep_no_training_prior_day: z.boolean().nullable().optional(),
  prep_active_travel: z.boolean().nullable().optional(),
  prep_rested: z.boolean().nullable().optional(),
  prep_rest_min_before_test: z.number().int().nullable().optional(),
  prep_illness_free_14d: z.boolean().nullable().optional(),
  prep_awake_quiet: z.boolean().nullable().optional(),
  room_temp_c: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const metabolicTestsMutatorSchema =
  metabolicTestsInitializerSchema.partial();

export type MetabolicTests = z.infer<typeof metabolicTestsSchema>;
export type MetabolicTestsInitializer = z.infer<
  typeof metabolicTestsInitializerSchema
>;
export type MetabolicTestsMutator = z.infer<typeof metabolicTestsMutatorSchema>;
