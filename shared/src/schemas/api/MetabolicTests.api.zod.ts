import { z } from 'zod';
import { isDayString } from '../../utils/timezone.ts';

export const METABOLIC_TEST_METHODS = [
  'ic_vo2_only',
  'ic_vo2_vco2',
  'other',
] as const;
export type MetabolicTestMethod = (typeof METABOLIC_TEST_METHODS)[number];
/** The usual kcal per litre of oxygen for a VO2-only device, which assumes an RQ of about 0.79. */
export const VO2_ONLY_KCAL_PER_LITRE = 4.81;

const number = (min: number, max: number, minExclusive = false) => {
  const base = z.number().finite();
  return (minExclusive ? base.gt(min) : base.gte(min)).lte(max);
};
const optionalNumber = (min: number, max: number, minExclusive = false) =>
  number(min, max, minExclusive)
    .nullable()
    .optional()
    .transform((value) => value ?? null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));
/** Yes, no or not recorded. */
const tri = z
  .boolean()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

/** The pre-test conditions. Every answer is yes, no or not recorded. */
export const metabolicTestPrepSchema = z
  .object({
    fasted: tri,
    fasting_hours: optionalNumber(0, 72),
    no_caffeine: tri,
    no_training_prior_day: tri,
    active_travel: tri,
    rested: tri,
    rest_min_before_test: z
      .number()
      .int()
      .min(0)
      .max(600)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    illness_free_14d: tri,
    awake_quiet: tri,
  })
  .default({
    fasted: null,
    fasting_hours: null,
    no_caffeine: null,
    no_training_prior_day: null,
    active_travel: null,
    rested: null,
    rest_min_before_test: null,
    illness_free_14d: null,
    awake_quiet: null,
  });
export type MetabolicTestPrep = z.output<typeof metabolicTestPrepSchema>;

/**
 * One measured RMR test as the clinic reported it. `weight_kg` and the other subject values are the
 * ones the clinic fed its prediction equation. The clinic's own predicted figure and activity factor
 * are kept as printed and are never used to work out a target.
 */
export const metabolicTestInputSchema = z
  .object({
    tested_day: z.string().refine(isDayString, 'Use a real date (YYYY-MM-DD)'),
    method: z.enum(METABOLIC_TEST_METHODS),
    device_label: optionalText(100),
    facility: optionalText(100),
    measured_rmr_kcal: number(0, 10000, true),
    kcal_per_litre_o2: optionalNumber(0, 10, true),
    vo2_ml_min: optionalNumber(0, 5000, true),
    vco2_ml_min: optionalNumber(0, 5000, true),
    rq: optionalNumber(0, 2, true),
    duration_min: z
      .number()
      .int()
      .positive()
      .max(240)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    steady_state_cv_pct: optionalNumber(0, 100),
    sex: z.enum(['male', 'female']),
    age_years: number(0, 120, true),
    height_cm: number(100, 250),
    weight_kg: number(0, 700, true),
    /** Fat-free mass from a body scan, if there is one; the equations built on it need it. */
    fat_free_mass_kg: optionalNumber(0, 700, true),
    reported_predicted_kcal: optionalNumber(0, 10000, true),
    reported_prediction_equation: optionalText(60),
    reported_activity_factor: optionalNumber(0, 5, true),
    reported_activity_label: optionalText(40),
    prep: metabolicTestPrepSchema,
    room_temp_c: optionalNumber(-49, 59),
    notes: optionalText(2000),
  })
  .refine(
    (value) =>
      value.fat_free_mass_kg === null ||
      value.fat_free_mass_kg <= value.weight_kg,
    {
      path: ['fat_free_mass_kg'],
      message: 'Fat-free mass cannot be more than the body weight',
    }
  );
export type MetabolicTestInput = z.input<typeof metabolicTestInputSchema>;
export type NewMetabolicTest = z.output<typeof metabolicTestInputSchema>;

export const metabolicTestSchema = z.object({
  id: z.string().uuid(),
  tested_day: z.string(),
  method: z.enum(METABOLIC_TEST_METHODS),
  device_label: z.string().nullable(),
  facility: z.string().nullable(),
  measured_rmr_kcal: z.number(),
  kcal_per_litre_o2: z.number().nullable(),
  vo2_ml_min: z.number().nullable(),
  vco2_ml_min: z.number().nullable(),
  rq: z.number().nullable(),
  duration_min: z.number().nullable(),
  steady_state_cv_pct: z.number().nullable(),
  sex: z.enum(['male', 'female']),
  age_years: z.number(),
  height_cm: z.number(),
  weight_kg: z.number(),
  fat_free_mass_kg: z.number().nullable(),
  reported_predicted_kcal: z.number().nullable(),
  reported_prediction_equation: z.string().nullable(),
  reported_activity_factor: z.number().nullable(),
  reported_activity_label: z.string().nullable(),
  prep: z.object({
    fasted: z.boolean().nullable(),
    fasting_hours: z.number().nullable(),
    no_caffeine: z.boolean().nullable(),
    no_training_prior_day: z.boolean().nullable(),
    active_travel: z.boolean().nullable(),
    rested: z.boolean().nullable(),
    rest_min_before_test: z.number().nullable(),
    illness_free_14d: z.boolean().nullable(),
    awake_quiet: z.boolean().nullable(),
  }),
  room_temp_c: z.number().nullable(),
  notes: z.string().nullable(),
});
export type MetabolicTest = z.infer<typeof metabolicTestSchema>;

export const metabolicTestListSchema = z.object({
  metabolic_tests: z.array(metabolicTestSchema),
});
