import { z } from 'zod';
import { medicationCourseInstantSchema } from '../api/MedicationCourses.api.zod.ts';

const uuid = z.string().uuid();
const timestamp = z.union([z.date(), medicationCourseInstantSchema]);

/** One medicine a prescription covers; a null medication_id is the tombstone of a deleted medicine. */
export const medicationPrescriptionMedicationsSchema = z.object({
  id: uuid,
  prescription_id: uuid,
  user_id: uuid,
  medication_id: uuid.nullable(),
  medication_name_snapshot: z.string(),
  position: z.number().int().min(0),
  created_at: timestamp,
});
export type MedicationPrescriptionMedications = z.infer<
  typeof medicationPrescriptionMedicationsSchema
>;
