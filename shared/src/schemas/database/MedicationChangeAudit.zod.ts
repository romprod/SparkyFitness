import { z } from 'zod';

const timestamp = z.union([z.date(), z.string()]);

export const medicationChangeAuditSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  entity_kind: z.enum([
    'vial',
    'purchase',
    'purchase_item',
    'prescription',
    'prescription_medicine',
  ]),
  entity_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  medication_id: z.string().uuid().nullable(),
  action: z.enum(['create', 'edit', 'delete']),
  changed_at: timestamp,
  old_values: z.record(z.string(), z.unknown()).nullable(),
  new_values: z.record(z.string(), z.unknown()).nullable(),
  // bigint comes back from node-postgres as a string
  tx_id: z.union([z.string(), z.number()]),
});
export type MedicationChangeAuditRow = z.infer<
  typeof medicationChangeAuditSchema
>;
