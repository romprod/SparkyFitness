import { z } from 'zod';

const timestamp = z.union([z.date(), z.string()]);

export const medicationDoseAuditSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  entity_kind: z.enum(['injection', 'entry']),
  entity_id: z.string().uuid(),
  medication_id: z.string().uuid().nullable(),
  action: z.enum(['create', 'edit', 'delete']),
  changed_at: timestamp,
  old_values: z.record(z.string(), z.unknown()).nullable(),
  new_values: z.record(z.string(), z.unknown()).nullable(),
});
export type MedicationDoseAuditRow = z.infer<typeof medicationDoseAuditSchema>;
