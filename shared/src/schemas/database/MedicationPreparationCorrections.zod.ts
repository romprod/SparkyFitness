import { z } from 'zod';

export const medicationPreparationCorrectionsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  preparation_id: z.string().uuid(),
  pen_id: z.string().uuid(),
  medication_id: z.string().uuid(),
  from_revision: z.number().int().nonnegative(),
  to_revision: z.number().int().positive(),
  operation_id: z.string().uuid(),
  request_hash: z.string(),
  before_snapshot: z.record(z.string(), z.unknown()),
  after_snapshot: z.record(z.string(), z.unknown()),
  before_bud: z.record(z.string(), z.unknown()),
  after_bud: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type MedicationPreparationCorrections = z.infer<
  typeof medicationPreparationCorrectionsSchema
>;
