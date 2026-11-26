import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
} from './MedicationCourses.api.zod.ts';
import { normalizePurchaseDecimal } from '../../medications/purchaseCosts.ts';

const uuid = z.string().uuid();
/**
 * Clients that send this header with a value of 2 or more can read and write the
 * several medicines a prescription covers. Without it the API keeps the
 * one-medicine contract on the primary medicine.
 */
export const PRESCRIPTION_MODEL_VERSION_HEADER = 'X-Prescription-Model-Version';
export const PRESCRIPTION_MODEL_VERSION = 2;
export const MAX_PRESCRIPTION_MEDICATIONS = 20;
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
  /** No default: a create without a currency is refused, an update may omit it. */
  currency: z
    .string({ error: 'Currency is required.' })
    .trim()
    .min(1, 'Currency is required.'),
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
const medicationIds = z
  .array(uuid)
  .min(1)
  .max(MAX_PRESCRIPTION_MEDICATIONS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Each medication can be listed once',
  });
/**
 * Model 2 create: either `medication_id` (one medicine, exactly the model 1
 * body) or `medication_ids`, never both. Key order matches model 1 so a
 * legacy body parses to the same JSON and keeps its operation hash.
 */
export const medicationPrescriptionCreateSchemaV2 = fields
  .extend({
    operation_id: uuid,
    medication_id: uuid.optional(),
    medication_ids: medicationIds.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.medication_id === undefined) ===
      (value.medication_ids === undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['medication_ids'],
        message: 'Send either medication_id or medication_ids',
      });
    if (value.cost_basis === 'per_vial' && value.cost === null)
      context.addIssue({
        code: 'custom',
        path: ['cost'],
        message: 'Confirm per-vial basis with an explicit cost',
      });
  });
/** Model 2 update: `medication_ids` replaces the covered set; omitted preserves it. */
export const medicationPrescriptionUpdateSchemaV2 = fields
  .partial()
  .extend({
    status: medicationPrescriptionStatusSchema.optional(),
    operation_id: uuid,
    expected_version: version,
    medication_id: uuid.nullable().optional(),
    medication_ids: medicationIds.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.medication_id !== undefined && value.medication_ids !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['medication_ids'],
        message: 'Send either medication_id or medication_ids',
      });
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
/** One covered medicine; `medication_id` null is the permanent tombstone of a deleted medicine. */
export const medicationPrescriptionCoverageSchema = z
  .object({
    medication_id: uuid.nullable(),
    medication_name: z.string(),
    position: count,
  })
  .strict();
/** Model 2 response: model 1 plus the covered medicines in display order (primary first). */
export const medicationPrescriptionSchemaV2 =
  medicationPrescriptionSchema.extend({
    medications: z.array(medicationPrescriptionCoverageSchema).min(1),
  });
/** What a model 2 client parses: an older server omits `medications`, so it is optional. */
export const medicationPrescriptionClientSchema =
  medicationPrescriptionSchema.extend({
    medications: z
      .array(medicationPrescriptionCoverageSchema)
      .min(1)
      .optional(),
  });
export const medicationPrescriptionListSchemaV2 = z
  .object({ prescriptions: z.array(medicationPrescriptionSchemaV2) })
  .strict();
export const medicationPrescriptionDetailSchemaV2 = z
  .object({ prescription: medicationPrescriptionSchemaV2 })
  .strict();
export const medicationPrescriptionClientListSchema = z
  .object({ prescriptions: z.array(medicationPrescriptionClientSchema) })
  .strict();
export const medicationPrescriptionClientDetailSchema = z
  .object({ prescription: medicationPrescriptionClientSchema })
  .strict();
export const medicationPrescriptionMutationResultSchema = z
  .object({ id: uuid, version: version.nullable(), deleted: z.boolean() })
  .strict();

export type MedicationPrescription = z.infer<
  typeof medicationPrescriptionSchema
>;
export type MedicationPrescriptionCreateV2 = z.infer<
  typeof medicationPrescriptionCreateSchemaV2
>;
export type MedicationPrescriptionUpdateV2 = z.infer<
  typeof medicationPrescriptionUpdateSchemaV2
>;
export type MedicationPrescriptionCoverage = z.infer<
  typeof medicationPrescriptionCoverageSchema
>;
export type MedicationPrescriptionV2 = z.infer<
  typeof medicationPrescriptionSchemaV2
>;
export type MedicationPrescriptionClient = z.infer<
  typeof medicationPrescriptionClientSchema
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
