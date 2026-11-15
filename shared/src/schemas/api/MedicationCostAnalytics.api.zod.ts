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
export const medicationConsumableCostRowSchema = z.object({
  category: z.string(),
  spend: z.string().nullable(),
  spend_currency: z.string().nullable(),
  spend_mixed_currency: z.boolean(),
  pieces: z.string(),
  cost_per_piece: z.string().nullable(),
});
export const medicationConsumableCostsSchema = z.object({
  rows: z.array(medicationConsumableCostRowSchema),
  spend: z.string().nullable(),
  spend_currency: z.string().nullable(),
  spend_mixed_currency: z.boolean(),
  cost_per_dose: z.string().nullable(),
  cost_per_dose_basis: z.enum(['modelled', 'amortised', 'unavailable']),
  cost_per_dose_currency: z.string().nullable(),
  cost_per_dose_mixed_currency: z.boolean(),
  modelled_lines: z.number().int().nonnegative(),
  unmodelled_lines: z.number().int().nonnegative(),
  dose_count: z.number().int().nonnegative(),
});
export const medicationWasteRowSchema = z.object({
  vial_id: z.string(),
  medication_id: z.string(),
  medication_name: z.string(),
  status: z.enum(['finished', 'discarded']),
  label_mass_mg: z.string().nullable(),
  delivered_mass_mg: z.string().nullable(),
  estimated_unused_mg: z.string().nullable(),
  utilisation_percent: z.string().nullable(),
  estimated_unused_value: z.string().nullable(),
  currency: z.string().nullable(),
  value_unavailable: z.boolean(),
});
export const medicationWasteSchema = z.object({
  basis: z.literal('current_closed_stock_lifetime_delivered'),
  rows: z.array(medicationWasteRowSchema),
  estimated_unused_value: z.string().nullable(),
  currency: z.string().nullable(),
  mixed_currency: z.boolean(),
  unavailable_vials: z.number().int().nonnegative(),
});
export const medicationMonthlySpendSchema = z.object({
  month: z.string(),
  medication_subtotal: z.string().nullable(),
  consumable_subtotal: z.string().nullable(),
  overhead: z.string().nullable(),
  total: z.string().nullable(),
  currency: z.string().nullable(),
  mixed_currency: z.boolean(),
});
export const medicationCostAnalyticsSchema = z.object({
  window: z.object({
    key: medicationCostWindowSchema,
    from_date: z.string(),
    to_date: z.string(),
  }),
  rows: z.array(medicationCostAnalyticsRowSchema),
  consumables: medicationConsumableCostsSchema,
  waste: medicationWasteSchema,
  monthly_spend: z.array(medicationMonthlySpendSchema),
});
export type MedicationCostAnalytics = z.infer<
  typeof medicationCostAnalyticsSchema
>;
export type MedicationCostAnalyticsRow = z.infer<
  typeof medicationCostAnalyticsRowSchema
>;
