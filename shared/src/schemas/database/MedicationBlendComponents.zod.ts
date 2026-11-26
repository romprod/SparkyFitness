import { z } from 'zod';

export const medicationBlendComponentsIdSchema = z.string().or(z.number());

export const medicationBlendComponentsSchema = z.object({
  blend_medication_id: z.string(),
  component_medication_id: z.string(),
  user_id: z.string(),
  mass_mg: z.number(),
  source: z.string().optional(),
  sort_index: z.number().int().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const medicationBlendComponentsInitializerSchema = z.object({
  blend_medication_id: z.string().optional(),
  component_medication_id: z.string().optional(),
  user_id: z.string().optional(),
  mass_mg: z.number().optional(),
  source: z.string().optional(),
  sort_index: z.number().int().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const medicationBlendComponentsMutatorSchema =
  medicationBlendComponentsInitializerSchema.partial();

export type MedicationBlendComponents = z.infer<
  typeof medicationBlendComponentsSchema
>;
export type MedicationBlendComponentsInitializer = z.infer<
  typeof medicationBlendComponentsInitializerSchema
>;
export type MedicationBlendComponentsMutator = z.infer<
  typeof medicationBlendComponentsMutatorSchema
>;
