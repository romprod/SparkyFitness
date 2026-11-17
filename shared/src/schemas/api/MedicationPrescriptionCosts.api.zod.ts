import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { medicationCourseDaySchema } from './MedicationCourses.api.zod.ts';
import {
  medicationCostAnalyticsSchema,
  medicationCostAnalyticsRowSchema,
  medicationCostAnalyticsQuerySchema,
  medicationWasteSchema,
  medicationWasteRowSchema,
} from './MedicationCostAnalytics.api.zod.ts';

const uuid = z.string().uuid();
const count = z.number().int().nonnegative();
const finiteAmount = (value: string): Decimal | null => {
  try {
    const parsed = new Decimal(value);
    return value.trim() !== '' && parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
};
const amount = z.string().refine((value) => finiteAmount(value) !== null);
export const medicationPrescriptionCostModeSchema = z.enum([
  'invoice_only',
  'with_prescription_estimates',
]);
export const medicationPrescriptionVialCostsQuerySchema = z
  .object({
    cost_basis: medicationPrescriptionCostModeSchema.optional(),
    expected_owner_id: uuid.optional(),
  })
  .strict();
export const medicationPrescriptionCostAnalyticsQuerySchema =
  medicationCostAnalyticsQuerySchema
    .extend({
      cost_basis: medicationPrescriptionCostModeSchema.optional(),
    })
    .strict();
export const medicationPrescriptionVialCostSchema = z
  .object({
    pen_id: uuid,
    is_costed: z.boolean(),
    cost_source: z.enum(['invoice', 'prescription']).nullable(),
    unit_cost: amount.nullable(),
    currency: z.string().min(1).nullable(),
    purchase_id: uuid.nullable(),
    purchase_item_id: uuid.nullable(),
    prescription_id: uuid.nullable(),
    estimate_basis: z.literal('per_vial').nullable(),
    prescription_date_written: medicationCourseDaySchema.nullable(),
  })
  .strict()
  .superRefine((price, context) => {
    const missing = price.cost_source === null;
    if (
      price.is_costed !== !missing ||
      (missing &&
        [
          price.unit_cost,
          price.currency,
          price.purchase_id,
          price.purchase_item_id,
          price.prescription_id,
          price.estimate_basis,
          price.prescription_date_written,
        ].some((value) => value !== null)) ||
      (!missing && price.unit_cost === null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Selected unit price and its provenance must agree',
      });
    if (
      price.cost_source === 'invoice' &&
      (!price.purchase_id ||
        !price.purchase_item_id ||
        price.prescription_id !== null ||
        price.estimate_basis !== null ||
        price.prescription_date_written !== null)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Invoice prices must retain only their selected invoice provenance',
      });
    if (
      price.cost_source === 'prescription' &&
      (!price.prescription_id ||
        price.estimate_basis !== 'per_vial' ||
        price.purchase_id !== null ||
        price.purchase_item_id !== null ||
        (price.unit_cost !== null &&
          (finiteAmount(price.unit_cost)?.lt(0) ?? false)))
    )
      context.addIssue({
        code: 'custom',
        message:
          'Prescription estimates require confirmed nonnegative per-vial provenance',
      });
  });
export const medicationPrescriptionVialCostsSchema = z
  .object({
    cost_basis: z.literal('with_prescription_estimates'),
    vials: z.array(medicationPrescriptionVialCostSchema),
  })
  .strict();

export const medicationPrescriptionAccountedBucketSchema = z
  .object({
    currency: z.string().min(1),
    invoice_cash: amount,
    prescription_estimate: amount.refine(
      (value) => finiteAmount(value)?.gte(0) ?? false
    ),
    accounted_total: amount,
    estimated_vials: count,
    undated_vials: count,
  })
  .strict()
  .superRefine((bucket, context) => {
    if (bucket.undated_vials > bucket.estimated_vials)
      context.addIssue({
        code: 'custom',
        message: 'Undated estimates must be a subset of estimated vials',
      });
  });
const usageSources = z.object({ invoice: count, prescription: count }).strict();
export const medicationPrescriptionCostAnalyticsSchema =
  medicationCostAnalyticsSchema.safeExtend({
    cost_basis: z.literal('with_prescription_estimates'),
    accounted: z.array(medicationPrescriptionAccountedBucketSchema),
    rows: z.array(
      medicationCostAnalyticsRowSchema
        .extend({
          accounted: z.array(medicationPrescriptionAccountedBucketSchema),
          usage_sources: usageSources,
        })
        .superRefine((row, context) => {
          if (
            row.usage_sources.invoice + row.usage_sources.prescription !==
            row.costed_doses
          )
            context.addIssue({
              code: 'custom',
              message:
                'Usage provenance must account for each costed dose once',
            });
        })
    ),
    waste: medicationWasteSchema.extend({
      rows: z.array(
        medicationWasteRowSchema.extend({
          cost_source: z.enum(['invoice', 'prescription']).nullable(),
        })
      ),
    }),
  });

export type MedicationPrescriptionCostMode = z.infer<
  typeof medicationPrescriptionCostModeSchema
>;
export type MedicationPrescriptionVialCostsQuery = z.infer<
  typeof medicationPrescriptionVialCostsQuerySchema
>;
export type MedicationPrescriptionCostAnalyticsQuery = z.infer<
  typeof medicationPrescriptionCostAnalyticsQuerySchema
>;
export type MedicationPrescriptionVialCost = z.infer<
  typeof medicationPrescriptionVialCostSchema
>;
export type MedicationPrescriptionVialCosts = z.infer<
  typeof medicationPrescriptionVialCostsSchema
>;
export type MedicationPrescriptionAccountedBucket = z.infer<
  typeof medicationPrescriptionAccountedBucketSchema
>;
export type MedicationPrescriptionCostAnalytics = z.infer<
  typeof medicationPrescriptionCostAnalyticsSchema
>;
