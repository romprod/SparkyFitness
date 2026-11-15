import { z } from 'zod';

export const medicationPreparationDoseCorrectionsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  correction_id: z.string().uuid(),
  injection_id: z.string().uuid(),
  before_dose_mg: z.string().nullable(),
  after_dose_mg: z.string(),
  volume_ml: z.string(),
  created_at: z.string(),
});
export type MedicationPreparationDoseCorrections = z.infer<
  typeof medicationPreparationDoseCorrectionsSchema
>;
