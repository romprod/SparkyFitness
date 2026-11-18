import { z } from 'zod';
import { medicationPackStatusSchema } from '../database/MedicationPacks.zod.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positive = z.coerce.number().positive().max(1_000_000);
const nonNegative = z.coerce.number().min(0).max(1_000_000);
const text = z.string().trim().max(200);

export const medicationPackCreateSchema = z
  .object({
    label: text.nullable().optional(),
    unit_label: text.min(1),
    units_total: positive,
    units_used: nonNegative.optional(),
    status: medicationPackStatusSchema.optional(),
    expiry_date: day.nullable().optional(),
    lot_number: text.nullable().optional(),
    storage_location: text.nullable().optional(),
    reorder_threshold_units: nonNegative.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type MedicationPackCreate = z.infer<typeof medicationPackCreateSchema>;

/** Status changes are deliberate lifecycle actions, never a side effect of an edit. */
export const medicationPackUpdateSchema = medicationPackCreateSchema
  .partial()
  .extend({ lifecycle_intent: z.boolean().optional() })
  .strict();
export type MedicationPackUpdate = z.infer<typeof medicationPackUpdateSchema>;

/** A pack as the stock screen shows it, with server-derived figures. */
export const medicationPackViewSchema = z.object({
  id: z.string().uuid(),
  medication_id: z.string().uuid(),
  medication_name: z.string(),
  label: z.string().nullable(),
  unit_label: z.string(),
  status: medicationPackStatusSchema,
  units_total: z.string(),
  units_used: z.string(),
  units_remaining: z.string(),
  overdrawn: z.boolean(),
  /** Remaining units divided by the medication's current dose, when its dose unit matches the pack. */
  doses_left: z.string().nullable(),
  /** Average of the last 14 days of taken doses; null with fewer than 3 doses. Not a plan. */
  observed_days_left: z.number().int().nonnegative().nullable(),
  low: z.boolean(),
  opened_at: z.string().nullable(),
  expiry_date: z.string().nullable(),
  expired: z.boolean(),
  lot_number: z.string().nullable(),
  storage_location: z.string().nullable(),
  reorder_threshold_units: z.string().nullable(),
  notes: z.string().nullable(),
});
export type MedicationPackView = z.infer<typeof medicationPackViewSchema>;
export const medicationPackListSchema = z.object({
  today: z.string(),
  packs: z.array(medicationPackViewSchema),
});
export type MedicationPackList = z.infer<typeof medicationPackListSchema>;
