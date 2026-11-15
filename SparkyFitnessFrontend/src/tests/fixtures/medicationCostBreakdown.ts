import type { MedicationCostAnalytics } from '@workspace/shared';

export const emptyCostBreakdown: Pick<
  MedicationCostAnalytics,
  'consumables' | 'waste' | 'monthly_spend'
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
};
