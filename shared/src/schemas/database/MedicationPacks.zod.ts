import { z } from 'zod';

export const medicationPackStatusSchema = z.enum([
  'sealed',
  'in_use',
  'finished',
  'discarded',
]);
export type MedicationPackStatus = z.infer<typeof medicationPackStatusSchema>;

export const medicationPacksSchema = z.object({
  id: z.string().uuid(),
  medication_id: z.string().uuid(),
  user_id: z.string().uuid(),
  label: z.string().nullable(),
  unit_label: z.string().min(1),
  units_total: z.string(),
  units_used: z.string(),
  status: medicationPackStatusSchema,
  opened_at: z.string().nullable(),
  finished_at: z.union([z.date(), z.string()]).nullable(),
  expiry_date: z.string().nullable(),
  lot_number: z.string().nullable(),
  storage_location: z.string().nullable(),
  reorder_threshold_units: z.string().nullable(),
  notes: z.string().nullable(),
  source: z.string(),
  created_at: z.union([z.date(), z.string()]),
  updated_at: z.union([z.date(), z.string()]),
});
export type MedicationPacks = z.infer<typeof medicationPacksSchema>;
