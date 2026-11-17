import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
} from '../api/MedicationCourses.api.zod.ts';
import {
  medicationPrescriptionStatusSchema,
  medicationPrescriptionMutationResultSchema,
} from '../api/MedicationPrescriptions.api.zod.ts';

const uuid = z.string().uuid();
const timestamp = z.union([z.date(), medicationCourseInstantSchema]);
const date = z.union([z.date(), medicationCourseDaySchema]).nullable();
const encrypted = z.record(z.string(), z.unknown()).nullable();
const count = z.number().int().min(0).max(2147483647).nullable();

export const medicationPrescriptionsSchema = z.object({
  id: uuid,
  user_id: uuid,
  medication_id: uuid.nullable(),
  medication_name_snapshot: z.string(),
  source_encrypted: encrypted,
  prescriber_encrypted: encrypted,
  pharmacy_encrypted: encrypted,
  dose_instructions_encrypted: encrypted,
  cost: z.string().nullable(),
  cost_basis: z.literal('per_vial').nullable().optional(),
  currency: z.string(),
  quantity: count,
  refills_authorized: count,
  refills_remaining: count,
  date_written: date,
  next_refill: date,
  expiration: date,
  lead_time_days: count,
  status: medicationPrescriptionStatusSchema,
  version: z.number().int().positive(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const medicationPrescriptionOperationsSchema = z.object({
  user_id: uuid,
  operation_id: uuid,
  request_hash: z.string(),
  result: medicationPrescriptionMutationResultSchema,
  created_at: timestamp,
});
export type MedicationPrescriptions = z.infer<
  typeof medicationPrescriptionsSchema
>;
export type MedicationPrescriptionOperations = z.infer<
  typeof medicationPrescriptionOperationsSchema
>;
