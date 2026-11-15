import { Decimal } from 'decimal.js';
import { z } from 'zod';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const positiveDecimal = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const n = new D(value);
      return n.isFinite() && n.gt(0);
    } catch {
      return false;
    }
  }, 'Must be a finite positive decimal');
const preparationFields = {
  mode: z.enum(['reconstituted', 'premixed']),
  mass_value: z.number().finite().positive(),
  mass_unit: z.enum(['mg', 'mcg']),
  final_volume_ml: z.number().finite().positive(),
  prepared_date: z.iso.date(),
  diluent: z.string().trim().max(1000).nullable().optional(),
};
const legacyInput = z.object({
  ...preparationFields,
  label_concentration_value: z.never().optional(),
  label_concentration_unit: z.never().optional(),
});
const decimalOrNumber = z.union([
  positiveDecimal,
  z.number().finite().positive(),
]);
const labelledPremix = z.object({
  mode: z.literal('premixed'),
  label_concentration_value: positiveDecimal,
  label_concentration_unit: z.literal('mg/ml'),
  final_volume_ml: decimalOrNumber,
  prepared_date: z.iso.date(),
  diluent: preparationFields.diluent,
});
const decimalDry = z.object({
  mode: z.literal('reconstituted'),
  mass_value: positiveDecimal,
  mass_unit: preparationFields.mass_unit,
  final_volume_ml: decimalOrNumber,
  prepared_date: z.iso.date(),
  diluent: preparationFields.diluent,
  label_concentration_value: z.never().optional(),
  label_concentration_unit: z.never().optional(),
});
interface NormalizedPreparationInput {
  mode: 'reconstituted' | 'premixed';
  mass_value: number;
  mass_unit: 'mg' | 'mcg';
  final_volume_ml: number;
  prepared_date: string;
  diluent?: string | null;
  label_concentration_value?: string;
  label_concentration_unit?: 'mg/ml';
  mass_value_exact?: string;
  final_volume_ml_exact?: string;
}
export const medicationPreparationInputSchema = z
  .union([labelledPremix, decimalDry, legacyInput])
  .transform((input, ctx): NormalizedPreparationInput => {
    const label = input.label_concentration_value;
    if (
      label === undefined &&
      'mass_value' in input &&
      typeof input.mass_value === 'number'
    )
      return {
        mode: input.mode,
        mass_value: input.mass_value,
        mass_unit: input.mass_unit,
        final_volume_ml: Number(input.final_volume_ml),
        prepared_date: input.prepared_date,
        ...(input.diluent !== undefined ? { diluent: input.diluent } : {}),
      };
    const volume = new D(input.final_volume_ml);
    const mass =
      label !== undefined
        ? new D(label).times(volume)
        : new D('mass_value' in input ? input.mass_value : '0');
    const concentration =
      label !== undefined
        ? new D(label)
        : mass
            .times(
              ('mass_unit' in input ? input.mass_unit : 'mg') === 'mcg'
                ? '0.001'
                : 1
            )
            .div(volume);
    if (
      ![mass, volume, concentration].every(
        (value) =>
          value.isFinite() &&
          value.gt(0) &&
          Number.isFinite(value.toNumber()) &&
          value.toNumber() > 0
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Preparation amounts must produce finite positive values',
      });
      return z.NEVER;
    }
    return {
      ...input,
      mass_value: mass.toNumber(),
      mass_unit:
        label !== undefined
          ? 'mg'
          : 'mass_unit' in input
            ? input.mass_unit
            : 'mg',
      final_volume_ml: volume.toNumber(),
      mass_value_exact: mass.toString(),
      final_volume_ml_exact: volume.toString(),
    };
  });
export type MedicationPreparationInput = z.output<
  typeof medicationPreparationInputSchema
>;
export type MedicationPreparationCreationInput = z.input<
  typeof medicationPreparationInputSchema
>;
export const medicationPreparationSchema = legacyInput.extend({
  id: z.string().uuid(),
  mass_mg: z.number().finite().positive(),
  concentration_mg_ml: z.number().finite().positive(),
  created_at: z.string(),
  revision: z.number().int().nonnegative().optional(),
  exact: z
    .object({
      mass_value: z.string(),
      mass_mg: z.string(),
      concentration_mg_ml: z.string(),
      final_volume_ml: z.string(),
    })
    .optional(),
  label_concentration_value: z.string().nullable().optional(),
  label_concentration_unit: z.literal('mg/ml').nullable().optional(),
});
export type MedicationPreparation = z.infer<typeof medicationPreparationSchema>;

const correctionFields = {
  final_volume_ml: positiveDecimal,
  prepared_date: z.iso.date(),
  diluent: preparationFields.diluent,
};
export const medicationPreparationCorrectionValuesSchema = z.discriminatedUnion(
  'mode',
  [
    z.object({
      ...correctionFields,
      mode: z.literal('reconstituted'),
      mass_value: positiveDecimal,
      mass_unit: z.enum(['mg', 'mcg']),
    }),
    z.object({
      ...correctionFields,
      mode: z.literal('premixed'),
      label_concentration_value: positiveDecimal,
      label_concentration_unit: z.literal('mg/ml'),
    }),
  ]
);
export type MedicationPreparationCorrectionValues = z.infer<
  typeof medicationPreparationCorrectionValuesSchema
>;
export const medicationPreparationBudInputSchema = z.object({
  bud_mode: z.enum(['date', 'interval']).nullable().optional(),
  bud_date: z.iso.date().nullable().optional(),
  bud_interval_days: z.number().int().min(0).max(36500).nullable().optional(),
  bud_base_date: z.iso.date().nullable().optional(),
  bud_source: z.string().trim().max(1000).nullable().optional(),
});
export const medicationPreparationReviewInputSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  preparation: medicationPreparationCorrectionValuesSchema,
  bud: medicationPreparationBudInputSchema.optional(),
});
export type MedicationPreparationReviewInput = z.infer<
  typeof medicationPreparationReviewInputSchema
>;
export const medicationPreparationCorrectionInputSchema =
  medicationPreparationReviewInputSchema.extend({
    review_hash: z.string().regex(/^[a-f0-9]{64}$/),
    operation_id: z.string().uuid(),
  });
export type MedicationPreparationCorrectionInput = z.infer<
  typeof medicationPreparationCorrectionInputSchema
>;
export interface MedicationPreparationReviewBalance {
  concentration_mg_ml: string;
  final_volume_ml: string;
  remaining_mg: string | null;
  remaining_ml: string | null;
}
export interface MedicationPreparationReview {
  expected_revision: number;
  review_hash: string;
  before: MedicationPreparationReviewBalance;
  after: MedicationPreparationReviewBalance;
  affected_dose_count: number;
  overdrawn_mg: string | null;
  overdraw_warning: boolean;
  stock_unknown: boolean;
  can_confirm: boolean;
  blocking_reason: 'INCOMPLETE_PHYSICAL_HISTORY' | null;
}
export interface MedicationPreparationCorrectionResult {
  correction_id: string;
  revision: number;
  review: MedicationPreparationReview;
}
