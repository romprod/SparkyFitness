import { z } from 'zod';
export const medicationCostWindowSchema = z.enum(['3', '6', '12', 'all']);
export type MedicationCostWindow = z.infer<typeof medicationCostWindowSchema>;
export const medicationCostAnalyticsQuerySchema = z.object({
  window: medicationCostWindowSchema.catch('12').default('12'),
  expected_owner_id: z.string().uuid().optional(),
});
export const medicationCostAnalyticsRowSchema = z.object({
  medication_id: z.string().uuid(),
  medication_name: z.string(),
  spend: z.string().nullable(),
  spend_currency: z.string().nullable(),
  spend_present: z.boolean(),
  spend_mixed_currency: z.boolean(),
  cost_per_dose: z.string().nullable(),
  cost_per_mg: z.string().nullable(),
  usage_currency: z.string().nullable(),
  usage_mixed_currency: z.boolean(),
  costed_doses: z.number().int().nonnegative(),
  uncosted_doses: z.number().int().nonnegative(),
});
export const medicationCostAnalyticsSchema = z.object({
  window: z.object({
    key: medicationCostWindowSchema,
    from_date: z.string(),
    to_date: z.string(),
  }),
  rows: z.array(medicationCostAnalyticsRowSchema),
});
export type MedicationCostAnalytics = z.infer<
  typeof medicationCostAnalyticsSchema
>;
export type MedicationCostAnalyticsRow = z.infer<
  typeof medicationCostAnalyticsRowSchema
>;
