import { z } from 'zod';

const timestamp = z.union([z.date(), z.string()]);

export const medicationStacksSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  notes: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type MedicationStacksRow = z.infer<typeof medicationStacksSchema>;

export const medicationStackMembersSchema = z.object({
  stack_id: z.string().uuid(),
  user_id: z.string().uuid(),
  medication_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
});
export type MedicationStackMembersRow = z.infer<
  typeof medicationStackMembersSchema
>;
