import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
} from './MedicationCourses.api.zod.ts';
import { normalizePurchaseDecimal } from '../../medications/purchaseCosts.ts';

const uuid = z.string().uuid();
const count = z.number().int().min(0).max(2147483647);
const version = z.number().int().positive().max(2147483647);
const text = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null);
const integerInput = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, context) => {
    if (value == null || (typeof value === 'string' && !value.trim()))
      return null;
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a nonnegative whole number',
      });
      return z.NEVER;
    }
    const parsed = count.safeParse(
      typeof value === 'string' ? Number(value.trim()) : value
    );
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a supported nonnegative whole number',
      });
      return z.NEVER;
    }
    return parsed.data;
  });
const prescriptionDay = medicationCourseDaySchema.refine(
  (value) => !value.startsWith('0000-'),
  'Enter a calendar year from 0001 to 9999'
);
const dateInput = text.pipe(prescriptionDay.nullable());
const costInput = z
  .string()
  .nullish()
  .transform((value, context) => {
    if (!value?.trim()) return null;
    const normalized = normalizePurchaseDecimal(value);
    if (normalized === null) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a finite nonnegative cost',
      });
      return z.NEVER;
    }
    return normalized;
  });
export const medicationPrescriptionStatusSchema = z.enum([
  'active',
  'expired',
  'cancelled',
]);
const fields = z.object({
  cost_basis: z.literal('per_vial').nullable().optional(),
  source: text,
  prescriber: text,
  pharmacy: text,
  dose_instructions: text,
  cost: costInput,
  currency: z
    .string()
    .nullish()
    .transform((value) => value?.trim() || 'AUD'),
  quantity: integerInput,
  refills_authorized: integerInput,
  refills_remaining: integerInput,
  date_written: dateInput,
  next_refill: dateInput,
  expiration: dateInput,
  lead_time_days: integerInput,
  status: medicationPrescriptionStatusSchema.default('active'),
});

export const medicationPrescriptionQuerySchema = z
  .object({ expected_owner_id: uuid.optional() })
  .strict();
export const medicationPrescriptionCreateSchema = fields
  .extend({ operation_id: uuid, medication_id: uuid })
  .strict()
  .superRefine((value, context) => {
    if (value.cost_basis === 'per_vial' && value.cost === null)
      context.addIssue({
        code: 'custom',
        path: ['cost'],
        message: 'Confirm per-vial basis with an explicit cost',
      });
  });
/** Partial updates retain omitted fields; only an identical target may be echoed. */
export const medicationPrescriptionUpdateSchema = fields
  .partial()
  .extend({
    status: medicationPrescriptionStatusSchema.optional(),
    operation_id: uuid,
    expected_version: version,
    medication_id: uuid.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.cost_basis === 'per_vial' &&
      (value.cost === undefined || value.cost === null)
    )
      context.addIssue({
        code: 'custom',
        path: ['cost'],
        message: 'Confirm per-vial basis with an explicit cost',
      });
  });
export const medicationPrescriptionDeleteSchema = z
  .object({ operation_id: uuid, expected_version: version })
  .strict();

/** Plain owner-only response, never storage encryption envelopes. */
export const medicationPrescriptionSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    medication_id: uuid.nullable(),
    medication_name: z.string(),
    source: z.string().nullable(),
    prescriber: z.string().nullable(),
    pharmacy: z.string().nullable(),
    dose_instructions: z.string().nullable(),
    cost: z
      .string()
      .nullable()
      .refine(
        (value) =>
          value === null ||
          (value.trim() !== '' && normalizePurchaseDecimal(value) !== null)
      ),
    cost_basis: z.literal('per_vial').nullable().optional(),
    currency: z.string().min(1),
    quantity: count.nullable(),
    refills_authorized: count.nullable(),
    refills_remaining: count.nullable(),
    date_written: prescriptionDay.nullable(),
    next_refill: prescriptionDay.nullable(),
    expiration: prescriptionDay.nullable(),
    lead_time_days: count.nullable(),
    status: medicationPrescriptionStatusSchema,
    version,
    created_at: medicationCourseInstantSchema,
    updated_at: medicationCourseInstantSchema,
  })
  .strict();
export const medicationPrescriptionListSchema = z
  .object({ prescriptions: z.array(medicationPrescriptionSchema) })
  .strict();
export const medicationPrescriptionDetailSchema = z
  .object({ prescription: medicationPrescriptionSchema })
  .strict();
export const medicationPrescriptionMutationResultSchema = z
  .object({ id: uuid, version: version.nullable(), deleted: z.boolean() })
  .strict();

export type MedicationPrescription = z.infer<
  typeof medicationPrescriptionSchema
>;
export type MedicationPrescriptionQuery = z.infer<
  typeof medicationPrescriptionQuerySchema
>;
export type MedicationPrescriptionCreate = z.infer<
  typeof medicationPrescriptionCreateSchema
>;
export type MedicationPrescriptionUpdate = z.infer<
  typeof medicationPrescriptionUpdateSchema
>;
export type MedicationPrescriptionDelete = z.infer<
  typeof medicationPrescriptionDeleteSchema
>;
export type MedicationPrescriptionList = z.infer<
  typeof medicationPrescriptionListSchema
>;
export type MedicationPrescriptionDetail = z.infer<
  typeof medicationPrescriptionDetailSchema
>;
export type MedicationPrescriptionMutationResult = z.infer<
  typeof medicationPrescriptionMutationResultSchema
>;
