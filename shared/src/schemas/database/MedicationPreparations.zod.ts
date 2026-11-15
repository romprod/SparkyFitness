import { z } from 'zod';
import { medicationPreparationSchema } from '../api/MedicationPreparation.api.zod.ts';

export const medicationPreparationsSchema = medicationPreparationSchema.extend({
  user_id: z.string().uuid(),
  medication_id: z.string().uuid(),
  pen_id: z.string().uuid(),
});
export type MedicationPreparations = z.infer<
  typeof medicationPreparationsSchema
>;
