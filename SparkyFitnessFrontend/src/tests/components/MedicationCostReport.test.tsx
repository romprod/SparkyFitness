import { emptyCostBreakdown } from '../fixtures/medicationCostBreakdown';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationCostReport from '@/pages/Medications/MedicationCostReport';
import type {
  MedicationCostAnalytics,
  MedicationPrescriptionCostAnalytics,
} from '@workspace/shared';
const mockReport = jest.fn();
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationCostAnalytics: (...args: unknown[]) => mockReport(...args),
}));
const row = (
  patch: Partial<MedicationPrescriptionCostAnalytics['rows'][number]> = {}
): MedicationPrescriptionCostAnalytics['rows'][number] => ({
  medication_id: 'med',
  medication_name: 'Synthetic medication',
  spend: '100',
  spend_currency: 'AUD',
  spend_present: true,
  spend_mixed_currency: false,
  cost_per_dose: '0.125',
  cost_per_mg: '0.001',
  usage_currency: 'GBP',
  usage_mixed_currency: false,
  costed_doses: 3,
  uncosted_doses: 2,
  usage_sources: { invoice: patch.costed_doses ?? 3, prescription: 0 },
  accounted: [],
  ...patch,
});
const data = (
  rows = [row()],
  key: MedicationCostAnalytics['window']['key'] = '12'
): MedicationPrescriptionCostAnalytics => ({
  cost_basis: 'with_prescription_estimates' as const,
  accounted: [],
  window: { key, from_date: '2025-11-15', to_date: '2026-11-15' },
  rows,
  ...emptyCostBreakdown,
  waste: { ...emptyCostBreakdown.waste, rows: [] },
});
beforeEach(() => mockReport.mockReset());
const ready = (value = data()) =>
  mockReport.mockReturnValue({
    data: value,
    isFetching: false,
    isError: false,
    refetch: jest.fn(),
  });
it('shows exactly the source four columns with independent metric currencies and counts', () => {
  ready();
  render(<MedicationCostReport ownerId="owner" />);
  expect(
    screen.getAllByRole('columnheader').map((cell) => cell.textContent)
  ).toEqual(['Medication', 'Invoice spend', 'Per dose', 'Per mg']);
  expect(screen.getByText('AUD 100.00')).toBeInTheDocument();
  expect(screen.getByText('GBP 0.125')).toBeInTheDocument();
  expect(screen.getByText('GBP 0.001')).toBeInTheDocument();
  expect(screen.getByText('3 costed doses · 2 uncosted')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '12m' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
it('distinguishes known zero, negative figures and absent unknown data', () => {
  ready(
    data([
      row({
        medication_id: 'zero',
        medication_name: 'Synthetic zero',
        spend: '0',
        cost_per_dose: '0',
        cost_per_mg: '0',
        usage_currency: 'AUD',
        costed_doses: 1,
        uncosted_doses: 0,
      }),
      row({
        medication_id: 'negative',
        medication_name: 'Synthetic negative',
        spend: '-5',
        cost_per_dose: '-0.5',
        cost_per_mg: '-2',
        usage_currency: 'AUD',
      }),
      row({
        medication_id: 'unknown',
        medication_name: 'Synthetic unknown',
        spend: null,
        spend_currency: null,
        spend_present: false,
        cost_per_dose: null,
        cost_per_mg: null,
        usage_currency: null,
        costed_doses: 0,
        uncosted_doses: 2,
      }),
    ])
  );
  render(<MedicationCostReport ownerId="owner" />);
  expect(
    within(screen.getByText('Synthetic zero').closest('tr')!).getAllByText(
      'AUD 0.00'
    )
  ).toHaveLength(3);
  expect(screen.getByText('AUD -5.00')).toBeInTheDocument();
  expect(screen.getByText('AUD -0.500')).toBeInTheDocument();
  expect(screen.getByText('AUD -2.00')).toBeInTheDocument();
  expect(
    within(screen.getByText('Synthetic unknown').closest('tr')!).getAllByText(
      '—'
    )
  ).toHaveLength(3);
  expect(screen.getByText('0 costed doses · 2 uncosted')).toBeInTheDocument();
});
it('suppresses only metrics with mixed contributors and keeps other metrics available', () => {
  ready(
    data([
      row({
        medication_id: 'mixedspend',
        medication_name: 'Synthetic mixed spend',
        spend: '999',
        spend_currency: null,
        spend_mixed_currency: true,
      }),
      row({
        medication_id: 'mixedusage',
        medication_name: 'Synthetic mixed usage',
        spend: '5',
        spend_currency: 'EUR',
        usage_currency: null,
        usage_mixed_currency: true,
      }),
    ])
  );
  render(<MedicationCostReport ownerId="owner" />);
  expect(
    screen.getByText('Mixed currencies: affected figures are hidden.')
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByText('Synthetic mixed spend').closest('tr')!
    ).getAllByText('—')
  ).toHaveLength(1);
  expect(screen.getByText('GBP 0.125')).toBeInTheDocument();
  expect(screen.getByText('EUR 5.00')).toBeInTheDocument();
  expect(
    within(
      screen.getByText('Synthetic mixed usage').closest('tr')!
    ).getAllByText('—')
  ).toHaveLength(2);
  expect(screen.queryByText(/999/)).not.toBeInTheDocument();
});
it('changes report windows without showing cached numbers while a request is pending', () => {
  mockReport.mockImplementation((_owner: string, window: string) => ({
    data: data([row()], window === '12' ? '12' : '3'),
    isFetching: window !== '12',
    isError: false,
    refetch: jest.fn(),
  }));
  render(<MedicationCostReport ownerId="owner" />);
  fireEvent.click(screen.getByRole('button', { name: '3m' }));
  expect(mockReport).toHaveBeenLastCalledWith('owner', '3', true);
  expect(screen.queryByText('AUD 100.00')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading cost report');
  expect(
    screen.queryByRole('heading', { name: 'Spend by month' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(mockReport).toHaveBeenLastCalledWith('owner', 'all', true);
});
it('rejects a mismatched response window and hides failed cached data', () => {
  ready(data([row()], '3'));
  const { rerender } = render(<MedicationCostReport ownerId="owner" />);
  expect(
    screen.getByText('Could not load the cost report.')
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  mockReport.mockReturnValue({
    data: data(),
    isFetching: false,
    isError: true,
    refetch: jest.fn(),
  });
  rerender(<MedicationCostReport ownerId="owner" />);
  expect(screen.queryByText('AUD 100.00')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', {
      name: 'Invoice cash and prescription estimates',
    })
  ).not.toBeInTheDocument();
});

it('keeps known-zero prescription estimates without invoices and separates currencies and undated counts', () => {
  const zero = {
    currency: 'GBP',
    invoice_cash: '0',
    prescription_estimate: '0',
    accounted_total: '0',
    estimated_vials: 2,
    undated_vials: 1,
  };
  const euro = {
    currency: 'EUR',
    invoice_cash: '0',
    prescription_estimate: '12.345',
    accounted_total: '12.345',
    estimated_vials: 1,
    undated_vials: 0,
  };
  const result = data([
    row({
      spend: null,
      spend_present: false,
      spend_currency: null,
      cost_per_dose: '0',
      cost_per_mg: '0',
      usage_currency: 'GBP',
      usage_sources: { invoice: 0, prescription: 3 },
      accounted: [zero, euro],
    }),
  ]);
  ready({ ...result, accounted: [zero, euro] });
  render(<MedicationCostReport ownerId="owner" />);
  const summary = within(
    screen.getByRole('region', {
      name: 'Accounted values by recorded currency',
    })
  );
  expect(summary.getByRole('rowheader', { name: 'GBP' })).toBeInTheDocument();
  expect(summary.getByRole('rowheader', { name: 'EUR' })).toBeInTheDocument();
  expect(summary.getAllByText('GBP 0.00')).toHaveLength(3);
  expect(summary.getAllByText('EUR 12.35')).toHaveLength(2);
  expect(
    summary.getByText('2 estimated vials · no shipping')
  ).toBeInTheDocument();
  expect(
    summary.getByText(
      '1 vials have no prescription written date and are included in every window.'
    )
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      '0 doses priced from invoices · 3 from prescription estimates'
    )
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Monthly bars and invoice totals show recorded invoice cash only/
    )
  ).toBeInTheDocument();
  expect(screen.getByText('No invoices in this window.')).toBeInTheDocument();
});
