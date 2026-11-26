import { z } from 'zod';

export const medicationSmoothWeekPinsIdSchema = z.string().or(z.number());

export const medicationSmoothWeekPinsSchema = z.object({
  user_id: z.string(),
  medication_id: z.string(),
  created_at: z.date().optional(),
});

export const medicationSmoothWeekPinsInitializerSchema = z.object({
  user_id: z.string().optional(),
  medication_id: z.string().optional(),
  created_at: z.date().optional(),
});

export const medicationSmoothWeekPinsMutatorSchema = medicationSmoothWeekPinsInitializerSchema.partial();

export type MedicationSmoothWeekPins = z.infer<typeof medicationSmoothWeekPinsSchema>;
export type MedicationSmoothWeekPinsInitializer = z.infer<typeof medicationSmoothWeekPinsInitializerSchema>;
export type MedicationSmoothWeekPinsMutator = z.infer<typeof medicationSmoothWeekPinsMutatorSchema>;
