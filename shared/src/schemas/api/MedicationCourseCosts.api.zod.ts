import { z } from 'zod';

export const medicationCourseCostsQuerySchema = z.object({
  expected_owner_id: z.string().uuid().optional(),
});
const money = z.string().nullable();
export const medicationCourseCostActualSchema = z.object({
  cost: money,
  currency: z.string().nullable(),
  mixed_currency: z.boolean(),
  delivered_mg: z.string(),
  costed_doses: z.number().int().nonnegative(),
  uncosted_doses: z.number().int().nonnegative(),
  cost_per_dose: money,
  cost_per_mg: money,
});
export const medicationCourseCostRowSchema = z.object({
  course_id: z.string().uuid(),
  medication_id: z.string().uuid().nullable(),
  medication_name: z.string(),
  name: z.string(),
  status: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  actual: medicationCourseCostActualSchema,
});
export const medicationCourseCostsSchema = z.object({
  as_of: z.string(),
  rows: z.array(medicationCourseCostRowSchema),
  /** Logged doses that are not attributed to any course, so totals reconcile. */
  unattributed: medicationCourseCostActualSchema,
});
export type MedicationCourseCosts = z.infer<typeof medicationCourseCostsSchema>;
export type MedicationCourseCostRow = z.infer<
  typeof medicationCourseCostRowSchema
>;
