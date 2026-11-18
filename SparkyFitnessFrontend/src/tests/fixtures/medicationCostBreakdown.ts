import type { MedicationCostAnalytics } from '@workspace/shared';

export const emptyCostBreakdown: Pick<
  MedicationCostAnalytics,
  'consumables' | 'waste' | 'monthly_spend' | 'run_rate' | 'summary'
> = {
  consumables: {
    rows: [],
    spend: null,
    spend_currency: null,
    spend_mixed_currency: false,
    cost_per_dose: null,
    cost_per_dose_basis: 'unavailable',
    cost_per_dose_currency: null,
    cost_per_dose_mixed_currency: false,
    modelled_lines: 0,
    unmodelled_lines: 0,
    dose_count: 0,
  },
  waste: {
    basis: 'current_closed_stock_lifetime_delivered',
    rows: [],
    estimated_unused_value: null,
    currency: null,
    mixed_currency: false,
    unavailable_vials: 0,
  },
  monthly_spend: [],
  run_rate: {
    per_month: null,
    months_of_data: 12,
    currency: null,
    mixed_currency: false,
  },
  summary: {
    invoice_count: 0,
    invoice_total: null,
    overhead_total: null,
    currency: null,
    mixed_currency: false,
    per_dose: {
      peptide: null,
      sundries: null,
      total: null,
      currency: null,
      basis: null,
    },
    coverage: {
      vials_total: 0,
      vials_costed: 0,
      doses_in_window: 0,
      doses_costed: 0,
    },
  },
};
