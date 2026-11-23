import { Decimal } from 'decimal.js';
import { z } from 'zod';

/** Where a blend's component masses come from; the weakest one claimed taints every derived figure. */
export const BLEND_SOURCES = ['label', 'coa', 'assumed'] as const;
export const blendSourceSchema = z.enum(BLEND_SOURCES);
export type BlendSource = z.infer<typeof blendSourceSchema>;

export const MAX_BLEND_COMPONENTS = 20;
/** A kilogram in milligrams: far above any vial, below what the column holds. */
export const MAX_BLEND_COMPONENT_MG = 1_000_000;
const MAX_MASS_DECIMALS = 6;

const parseMass = (value: string): Decimal | null => {
  try {
    const mass = new Decimal(value);
    return mass.isFinite() ? mass : null;
  } catch {
    return null;
  }
};

/** A component's mass in one labelled vial, in mg: a positive decimal, written without an exponent. */
const massMgSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => {
    const mass = parseMass(value);
    return mass !== null && mass.gt(0);
  }, 'Enter a mass above zero')
  .refine((value) => {
    const mass = parseMass(value);
    return mass !== null && mass.lte(MAX_BLEND_COMPONENT_MG);
  }, 'Use a mass of 1,000,000 mg or less')
  .refine((value) => {
    const mass = parseMass(value);
    return mass !== null && mass.decimalPlaces() <= MAX_MASS_DECIMALS;
  }, 'Use at most six decimal places')
  .transform((value) => new Decimal(value).toFixed());

export const medicationBlendComponentInputSchema = z.object({
  component_medication_id: z.string().uuid(),
  mass_mg: massMgSchema,
  source: blendSourceSchema.default('label'),
});

/**
 * Replace the composition of one blend: the compounds one labelled vial of it holds, in order.
 * An empty list says the medication is not a blend.
 */
export const medicationBlendInputSchema = z.object({
  components: z
    .array(medicationBlendComponentInputSchema)
    .max(MAX_BLEND_COMPONENTS)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.component_medication_id)).size ===
        rows.length,
      'Each component can appear once'
    ),
});
export type MedicationBlendInput = z.infer<typeof medicationBlendInputSchema>;

export const medicationBlendComponentSchema = z.object({
  component_medication_id: z.string().uuid(),
  name: z.string(),
  mass_mg: z.string(),
  source: blendSourceSchema,
  sort_index: z.number().int().nonnegative(),
});
export type MedicationBlendComponent = z.infer<
  typeof medicationBlendComponentSchema
>;

export const medicationBlendSchema = z.object({
  blend_medication_id: z.string().uuid(),
  name: z.string(),
  components: z.array(medicationBlendComponentSchema),
});
export type MedicationBlend = z.infer<typeof medicationBlendSchema>;

export const medicationBlendListSchema = z.object({
  blends: z.array(medicationBlendSchema),
});
export type MedicationBlendList = z.infer<typeof medicationBlendListSchema>;
