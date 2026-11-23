import { z } from 'zod';
import { isDayString } from '../../utils/timezone.ts';

/** The regions a DEXA report prints. The first six add up to the whole body; the last two are zones. */
export const BODY_COMP_REGIONS = [
  'l_arm',
  'r_arm',
  'trunk',
  'l_leg',
  'r_leg',
  'head',
  'android',
  'gynoid',
] as const;
export type BodyCompRegion = (typeof BODY_COMP_REGIONS)[number];

export const CREATINE_STATUSES = [
  'stable',
  'started',
  'stopped',
  'none',
] as const;
export const CARB_PATTERNS = ['normal', 'loaded', 'depleted'] as const;

const gram = (max: number) => z.number().finite().gt(0).lte(max);
const optionalGram = (max: number) =>
  gram(max)
    .nullable()
    .optional()
    .transform((value) => value ?? null);
const optionalNumber = (min: number, max: number) =>
  z
    .number()
    .finite()
    .gte(min)
    .lte(max)
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
/** Yes, no or not recorded. Never assumed. */
const tri = z
  .boolean()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

/** One region, in grams as the report prints it; the total and the percentage fat follow from them. */
export const bodyCompRegionSchema = z.object({
  region: z.enum(BODY_COMP_REGIONS),
  fat_g: z.number().finite().gte(0).lte(200_000),
  lean_g: z.number().finite().gte(0).lte(300_000),
  bmc_g: optionalNumber(0, 20_000),
  total_g: gram(500_000),
  pct_fat: z.number().finite().gte(0).lte(100),
});
export type BodyCompRegionValues = z.infer<typeof bodyCompRegionSchema>;

/** The conditions the scan was taken in. Every answer is yes, no or not recorded. */
export const bodyCompPrepSchema = z
  .object({
    fasted: tri,
    fasting_hours: optionalNumber(0, 72),
    no_caffeine: tri,
    no_training_prior_day: tri,
    active_travel: tri,
    euhydrated_voided: tri,
    illness_free_14d: tri,
  })
  .default({
    fasted: null,
    fasting_hours: null,
    no_caffeine: null,
    no_training_prior_day: null,
    active_travel: null,
    euhydrated_voided: null,
    illness_free_14d: null,
  });
export type BodyCompPrep = z.output<typeof bodyCompPrepSchema>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One DEXA whole-body scan as the report printed it, in grams. The total mass and the percentage
 * fat may be left out and are then worked out from fat, lean and bone mineral; regions are
 * optional. Nothing here is read by any target or goal.
 */
export const bodyCompScanInputSchema = z
  .object({
    scanned_day: z.string().refine(isDayString, 'Use a real date (YYYY-MM-DD)'),
    device_label: optionalText(100),
    device_serial: optionalText(60),
    software_version: optionalText(60),
    facility: optionalText(100),
    sex: z.enum(['male', 'female']),
    age_years: z.number().finite().gt(0).lte(120),
    height_cm: z.number().finite().gte(100).lte(250),
    clinic_weight_kg: optionalNumber(1, 700),
    total_fat_g: z.number().finite().gte(0).lte(300_000),
    total_lean_g: gram(400_000),
    total_bmc_g: gram(20_000),
    total_mass_g: optionalGram(700_000),
    pct_fat: optionalNumber(0, 100),
    vat_mass_g: optionalNumber(0, 20_000),
    vat_volume_cm3: optionalNumber(0, 30_000),
    vat_area_cm2: optionalNumber(0, 2_000),
    total_bmd_gcm2: optionalNumber(0.2, 3),
    prep: bodyCompPrepSchema,
    creatine_status: z
      .enum(CREATINE_STATUSES)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    carb_pattern_48h: z
      .enum(CARB_PATTERNS)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    regions: z
      .array(bodyCompRegionSchema)
      .max(BODY_COMP_REGIONS.length)
      .default([])
      .refine(
        (rows) => new Set(rows.map((row) => row.region)).size === rows.length,
        'Each region can appear once'
      ),
    notes: optionalText(2000),
  })
  .transform((value) => {
    const total =
      value.total_mass_g ??
      value.total_fat_g + value.total_lean_g + value.total_bmc_g;
    return {
      ...value,
      total_mass_g: total,
      pct_fat: value.pct_fat ?? round1((value.total_fat_g / total) * 100),
    };
  })
  .refine((value) => value.total_fat_g <= value.total_mass_g, {
    path: ['total_fat_g'],
    message: 'Fat cannot be more than the total mass',
  });
export type BodyCompScanInput = z.input<typeof bodyCompScanInputSchema>;
export type NewBodyCompScan = z.output<typeof bodyCompScanInputSchema>;

export const bodyCompScanSchema = z.object({
  id: z.string().uuid(),
  scanned_day: z.string(),
  device_label: z.string().nullable(),
  device_serial: z.string().nullable(),
  software_version: z.string().nullable(),
  facility: z.string().nullable(),
  sex: z.enum(['male', 'female']),
  age_years: z.number(),
  height_cm: z.number(),
  clinic_weight_kg: z.number().nullable(),
  total_fat_g: z.number(),
  total_lean_g: z.number(),
  total_bmc_g: z.number(),
  total_mass_g: z.number(),
  pct_fat: z.number(),
  vat_mass_g: z.number().nullable(),
  vat_volume_cm3: z.number().nullable(),
  vat_area_cm2: z.number().nullable(),
  total_bmd_gcm2: z.number().nullable(),
  prep: z.object({
    fasted: z.boolean().nullable(),
    fasting_hours: z.number().nullable(),
    no_caffeine: z.boolean().nullable(),
    no_training_prior_day: z.boolean().nullable(),
    active_travel: z.boolean().nullable(),
    euhydrated_voided: z.boolean().nullable(),
    illness_free_14d: z.boolean().nullable(),
  }),
  creatine_status: z.enum(CREATINE_STATUSES).nullable(),
  carb_pattern_48h: z.enum(CARB_PATTERNS).nullable(),
  regions: z.array(bodyCompRegionSchema),
  notes: z.string().nullable(),
});
export type BodyCompScan = z.infer<typeof bodyCompScanSchema>;

export const bodyCompScanListSchema = z.object({
  body_comp_scans: z.array(bodyCompScanSchema),
});
