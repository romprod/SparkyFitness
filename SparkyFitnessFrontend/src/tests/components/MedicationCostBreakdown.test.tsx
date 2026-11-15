import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationCostAnalytics } from '@workspace/shared';
import MedicationCostBreakdown from '@/pages/Medications/MedicationCostBreakdown';
import { emptyCostBreakdown } from '../fixtures/medicationCostBreakdown';

const report = (): MedicationCostAnalytics => ({
  window: { key: '12', from_date: '2025-11-15', to_date: '2026-11-15' },
  rows: [],
  ...emptyCostBreakdown,
  consumables: {
    rows: [
      {
        category: 'needle',
        spend: '20',
        spend_currency: 'GBP',
        spend_mixed_currency: false,
        pieces: '100',
        cost_per_piece: '0.2',
      },
    ],
    spend: '20',
    spend_currency: 'GBP',
    spend_mixed_currency: false,
    cost_per_dose: '0.2',
    cost_per_dose_currency: 'GBP',
    cost_per_dose_mixed_currency: false,
    cost_per_dose_basis: 'modelled',
    modelled_lines: 1,
    unmodelled_lines: 2,
    dose_count: 4,
  },
  monthly_spend: [
    {
      month: '2026-11',
      medication_subtotal: '100',
      consumable_subtotal: '20',
      overhead: '-5',
      total: '115',
      currency: 'GBP',
      mixed_currency: false,
    },
  ],
  waste: {
    basis: 'current_closed_stock_lifetime_delivered',
    estimated_unused_value: '3',
    currency: 'GBP',
    mixed_currency: false,
    unavailable_vials: 1,
    rows: [
      {
        vial_id: 'synthetic-vial',
        medication_id: 'synthetic-medication',
        medication_name: 'Synthetic closed vial',
        status: 'finished',
        label_mass_mg: '10',
        delivered_mass_mg: '7',
        estimated_unused_mg: '3',
        utilisation_percent: '70',
        estimated_unused_value: '3',
        currency: 'GBP',
        value_unavailable: false,
      },
    ],
  },
});

it('keeps signed monthly invoice components and their exact net total, with accessible tables', () => {
  const { container } = render(<MedicationCostBreakdown data={report()} />);
  const table = within(
    screen.getByRole('region', { name: 'Monthly invoice spend' })
  );
  expect(table.getByText('GBP -5.00')).toBeInTheDocument();
  expect(table.getByText('GBP 115.00')).toBeInTheDocument();
  expect(table.getByText('Nov 2026')).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Monthly invoice spend' })
  ).toHaveAttribute('tabindex', '0');
  expect(
    container.querySelector('.recharts-responsive-container')
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('heading').map((heading) => heading.textContent)
  ).toEqual(['Spend by month', 'Sundries & consumables', 'Wasted product']);
});

it('labels partial modelled assumptions and closed-stock lifetime estimates explicitly', () => {
  render(<MedicationCostBreakdown data={report()} />);
  expect(
    screen.getByText(/Declared lines included: 1; lines.*excluded: 2/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Uses all logged delivered history, independent of the selected window/
    )
  ).toBeInTheDocument();
  expect(screen.getByText(/at most 70% delivered/)).toBeInTheDocument();
  expect(
    screen.getByText(
      /Closed vials with missing cost, label or delivered history: 1/
    )
  ).toBeInTheDocument();
  expect(
    screen.getByText('3 mg estimated unused', { exact: false })
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole('region', { name: 'Consumable costs by category' })
    ).getByText('GBP 0.200')
  ).toBeInTheDocument();
});

it('suppresses incomparable chart axes but preserves separate known month currencies and modelled-only rate currency', () => {
  const data = report();
  data.monthly_spend.push({
    month: '2026-12',
    medication_subtotal: '50',
    consumable_subtotal: '0',
    overhead: '0',
    total: '50',
    currency: 'EUR',
    mixed_currency: false,
  });
  data.consumables.spend_mixed_currency = true;
  data.consumables.spend_currency = null;
  const { container } = render(<MedicationCostBreakdown data={data} />);
  expect(
    container.querySelector('.recharts-responsive-container')
  ).not.toBeInTheDocument();
  expect(screen.getAllByText('EUR 50.00')).toHaveLength(2);
  expect(screen.getByText('GBP 115.00')).toBeInTheDocument();
  expect(screen.getAllByText('GBP 0.200')).toHaveLength(2);
  expect(
    screen.getAllByText('Mixed currencies: affected figures are hidden.')
  ).toHaveLength(2);
});

it('renders known zero, absent and mixed values without inventing money or a zero rate', () => {
  const data = report();
  data.monthly_spend[0] = {
    month: '2026-11',
    medication_subtotal: null,
    consumable_subtotal: null,
    overhead: null,
    total: null,
    currency: null,
    mixed_currency: true,
  };
  data.consumables.cost_per_dose_basis = 'amortised';
  data.consumables.cost_per_dose = '0';
  data.waste.estimated_unused_value = null;
  data.waste.currency = null;
  const { rerender } = render(<MedicationCostBreakdown data={data} />);
  expect(
    within(
      screen.getByRole('region', { name: 'Monthly invoice spend' })
    ).getAllByText('—')
  ).toHaveLength(4);
  expect(screen.getByText('GBP 0.00')).toBeInTheDocument();
  expect(
    screen.getByText(/Amortised: landed sundry spend.*4 logged doses/)
  ).toBeInTheDocument();
  data.consumables.cost_per_dose = null;
  data.consumables.cost_per_dose_basis = 'unavailable';
  data.consumables.cost_per_dose_currency = null;
  rerender(<MedicationCostBreakdown data={data} />);
  expect(screen.queryByText('GBP 0.00')).not.toBeInTheDocument();
  expect(screen.getByText(/Estimate unavailable/)).toBeInTheDocument();
});

it('keeps unvalued closed vials out of the six-value list while explaining excluded values', () => {
  const data = report();
  const vial = data.waste.rows[0]!;
  data.waste.rows = [
    {
      ...vial,
      vial_id: 'unknown',
      medication_name: 'Synthetic unvalued',
      value_unavailable: true,
      estimated_unused_value: null,
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      ...vial,
      vial_id: String(index),
      medication_name: `Synthetic eligible ${index}`,
    })),
  ];
  render(<MedicationCostBreakdown data={data} />);
  expect(screen.queryByText('Synthetic unvalued')).not.toBeInTheDocument();
  expect(screen.getByText('Synthetic eligible 5')).toBeInTheDocument();
  expect(screen.queryByText('Synthetic eligible 6')).not.toBeInTheDocument();
  expect(
    screen.getByText('Showing six eligible closed vials.')
  ).toBeInTheDocument();
});
