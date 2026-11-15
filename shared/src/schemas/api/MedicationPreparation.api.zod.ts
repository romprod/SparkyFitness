import { z } from 'zod';

export const medicationPreparationInputSchema = z.object({
  mode: z.enum(['reconstituted', 'premixed']),
  mass_value: z.number().finite().positive(),
  mass_unit: z.enum(['mg', 'mcg']),
  final_volume_ml: z.number().finite().positive(),
  prepared_date: z.iso.date(),
  diluent: z.string().trim().max(1000).nullable().optional(),
});
export type MedicationPreparationInput = z.infer<
  typeof medicationPreparationInputSchema
>;
export const medicationPreparationSchema =
  medicationPreparationInputSchema.extend({
    id: z.string().uuid(),
    mass_mg: z.number().finite().positive(),
    concentration_mg_ml: z.number().finite().positive(),
    created_at: z.string(),
  });
export type MedicationPreparation = z.infer<typeof medicationPreparationSchema>;
