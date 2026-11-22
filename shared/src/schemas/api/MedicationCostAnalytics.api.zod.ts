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
  /** Landed cost of a millilitre of bacteriostatic water, added to each vial it was mixed into. */
  water_cost_per_ml: z.string().nullable().default(null),
  water_currency: z.string().nullable().default(null),
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
/** Monthly spend rate over months of actual use, as the Pitstop Costs page reports it. */
export const medicationRunRateSchema = z.object({
  per_month: z.string().nullable(),
  months_of_data: z.number().int().positive(),
  currency: z.string().nullable(),
  mixed_currency: z.boolean(),
});
/** Headline figures for the Costs page: invoice totals, per-dose split and how complete the costing is. */
export const medicationCostSummarySchema = z.object({
  invoice_count: z.number().int().nonnegative(),
  /** Recorded invoice cash in the window; null when empty or mixed currencies. */
  invoice_total: z.string().nullable(),
  overhead_total: z.string().nullable(),
  currency: z.string().nullable(),
  mixed_currency: z.boolean(),
  per_dose: z.object({
    peptide: z.string().nullable(),
    /** Bacteriostatic water per dose, through the vial each dose came from; null when none is costed. */
    water: z.string().nullable().default(null),
    sundries: z.string().nullable(),
    total: z.string().nullable(),
    currency: z.string().nullable(),
    basis: z.enum(['modelled', 'amortised']).nullable(),
  }),
  coverage: z.object({
    vials_total: z.number().int().nonnegative(),
    vials_costed: z.number().int().nonnegative(),
    doses_in_window: z.number().int().nonnegative(),
    doses_costed: z.number().int().nonnegative(),
  }),
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
  run_rate: medicationRunRateSchema,
  summary: medicationCostSummarySchema,
});
export type MedicationCostAnalytics = z.infer<
  typeof medicationCostAnalyticsSchema
>;
export type MedicationCostAnalyticsRow = z.infer<
  typeof medicationCostAnalyticsRowSchema
>;
