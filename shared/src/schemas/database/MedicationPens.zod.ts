import { z } from 'zod';
import { medicationVialLabelMassSchema } from '../api/MedicationStockMetadata.api.zod.ts';

export const medicationPensIdSchema = z.string().or(z.number());

export const medicationPensSchema = z.object({
  id: z.string().optional(),
  medication_id: z.string(),
  prescription_id: z.string().uuid().nullable().optional(),
  user_id: z.string(),
  kind: z.string(),
  label: z.string().nullable().optional(),
  label_mass_mg: medicationVialLabelMassSchema.nullable().optional(),
  dose_mg: z.number().nullable().optional(),
  concentration_mg_ml: z.number().nullable().optional(),
  volume_ml: z.number().nullable().optional(),
  doses_total: z.number().nullable().optional(),
  doses_used: z.number(),
  status: z.string(),
  finished_at: z.union([z.date(), z.string()]).nullable().optional(),
  opened_at: z.date().nullable().optional(),
  expiry_date: z.date().nullable().optional(),
  bud_date: z.date().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  storage_location: z.string().nullable().optional(),
  bud_mode: z.enum(['date', 'interval']).nullable().optional(),
  bud_interval_days: z.number().int().nonnegative().nullable().optional(),
  bud_base_date: z.date().nullable().optional(),
  bud_source: z.string().nullable().optional(),
  reorder_flag: z.boolean(),
  reorder_threshold: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string(),
  custom_fields: z.unknown(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const medicationPensInitializerSchema = z.object({
  id: z.string().optional(),
  medication_id: z.string().optional(),
  prescription_id: z.string().uuid().nullable().optional(),
  user_id: z.string().optional(),
  kind: z.string().optional(),
  label: z.string().nullable().optional(),
  label_mass_mg: medicationVialLabelMassSchema.nullable().optional(),
  dose_mg: z.number().nullable().optional(),
  concentration_mg_ml: z.number().nullable().optional(),
  volume_ml: z.number().nullable().optional(),
  doses_total: z.number().nullable().optional(),
  doses_used: z.number().optional(),
  status: z.string().optional(),
  finished_at: z.union([z.date(), z.string()]).nullable().optional(),
  opened_at: z.date().nullable().optional(),
  expiry_date: z.date().nullable().optional(),
  bud_date: z.date().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  storage_location: z.string().nullable().optional(),
  bud_mode: z.enum(['date', 'interval']).nullable().optional(),
  bud_interval_days: z.number().int().nonnegative().nullable().optional(),
  bud_base_date: z.date().nullable().optional(),
  bud_source: z.string().nullable().optional(),
  reorder_flag: z.boolean().optional(),
  reorder_threshold: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().optional(),
  custom_fields: z.unknown().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const medicationPensMutatorSchema =
  medicationPensInitializerSchema.partial();

export type MedicationPens = z.infer<typeof medicationPensSchema>;
export type MedicationPensInitializer = z.infer<
  typeof medicationPensInitializerSchema
>;
export type MedicationPensMutator = z.infer<typeof medicationPensMutatorSchema>;
