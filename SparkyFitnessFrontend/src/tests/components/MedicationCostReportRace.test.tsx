import { emptyCostBreakdown } from '../fixtures/medicationCostBreakdown';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MedicationPrescriptionCostAnalytics } from '@workspace/shared';
import MedicationCostReport from '@/pages/Medications/MedicationCostReport';
import * as api from '@/api/Medications/purchaseService';
const mockUser = { id: 'owner', activeUserId: 'owner' };
const mockBlends: unknown[] | undefined = undefined;
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({ data: mockBlends }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(async () => ({
    authenticatedUserId: 'owner',
    activeUserId: 'owner',
  })),
  getMedicationCostAnalyticsWithPrescriptionEstimates: jest.fn(),
}));
const response = (
  key: '3' | '6' | '12',
  name: string
): MedicationPrescriptionCostAnalytics => ({
  ...emptyCostBreakdown,
  waste: { ...emptyCostBreakdown.waste, rows: [] },
  cost_basis: 'with_prescription_estimates',
  accounted: [],
  window: { key, from_date: '2026-01-01', to_date: '2026-11-15' },
  rows: [
    {
      medication_id: 'med',
      medication_name: name,
      spend: '10',
      spend_currency: 'AUD',
      spend_present: true,
      spend_mixed_currency: false,
      cost_per_dose: '1',
      cost_per_mg: '0.5',
      usage_currency: 'AUD',
      usage_mixed_currency: false,
      costed_doses: 1,
      uncosted_doses: 0,
      usage_sources: { invoice: 1, prescription: 0 },
      accounted: [],
    },
  ],
});
it('ignores a slow earlier window response after the selected window changes', async () => {
  jest
    .mocked(api.getMedicationPurchaseIdentity)
    .mockResolvedValue({ authenticatedUserId: 'owner', activeUserId: 'owner' });
  let resolve3!: (value: MedicationPrescriptionCostAnalytics) => void;
  let resolve6!: (value: MedicationPrescriptionCostAnalytics) => void;
  jest
    .mocked(api.getMedicationCostAnalyticsWithPrescriptionEstimates)
    .mockImplementation(async (_owner, window) =>
      window === '3'
        ? new Promise((done) => {
            resolve3 = done;
          })
        : window === '6'
          ? new Promise((done) => {
              resolve6 = done;
            })
          : response('12', 'Synthetic twelve-month result')
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MedicationCostReport ownerId="owner" />
    </QueryClientProvider>
  );
  await screen.findByText('Synthetic twelve-month result');
  fireEvent.click(screen.getByRole('button', { name: '3m' }));
  expect(
    screen.queryByText('Synthetic twelve-month result')
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '6m' }));
  await act(async () => resolve6(response('6', 'Synthetic six-month result')));
  await screen.findByText('Synthetic six-month result');
  await act(async () =>
    resolve3(response('3', 'Synthetic old three-month result'))
  );
  expect(screen.getByText('Synthetic six-month result')).toBeInTheDocument();
  expect(
    screen.queryByText('Synthetic old three-month result')
  ).not.toBeInTheDocument();
});
