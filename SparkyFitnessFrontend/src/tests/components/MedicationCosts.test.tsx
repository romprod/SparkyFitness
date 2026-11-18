import { emptyCostBreakdown } from '../fixtures/medicationCostBreakdown';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  allocateMedicationPurchase,
  type MedicationPurchaseView,
} from '@workspace/shared';
import MedicationCosts from '@/pages/Medications/MedicationCosts';
import * as api from '@/api/Medications/purchaseService';
import { HttpApiError } from '@/api/api';
let mockUser = {
  id: '10000000-0000-4000-8000-000000000001',
  activeUserId: '10000000-0000-4000-8000-000000000001',
};
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
  getMedicationCostAnalyticsWithPrescriptionEstimates: jest.fn(),
  listMedicationPurchases: jest.fn(),
  getMedicationPurchase: jest.fn(),
  getMedicationPurchaseEditorData: jest.fn(),
  createMedicationPurchase: jest.fn(),
  updateMedicationPurchase: jest.fn(),
  deleteMedicationPurchase: jest.fn(),
}));
const med = '20000000-0000-4000-8000-000000000002';
let rows: MedicationPurchaseView[];
const view = (
  patch: Partial<MedicationPurchaseView> = {}
): MedicationPurchaseView => ({
  id: '30000000-0000-4000-8000-000000000003',
  revision: 1,
  vendor: 'Synthetic supplier',
  reference: 'SYN-1',
  ordered_date: '2026-11-15',
  received_date: null,
  currency: 'AUD',
  shipping_cost: '0',
  tax_cost: '0',
  other_fees: '0',
  discount: '0',
  allocation_method: 'value',
  notes: '',
  items: [
    {
      id: '40000000-0000-4000-8000-000000000004',
      kind: 'medication',
      medication_id: med,
      medication_name: 'Synthetic medication',
      category: null,
      description: 'Synthetic vial',
      quantity: 1,
      unit_cost: '20',
      units_per_pack: null,
      units_per_dose: null,
      vial_ids: [],
      pack_ids: [],
      subtotal: '20.00',
      allocated: '0.00',
      landed: '20.00',
      landed_unit: '20',
    },
  ],
  totals: allocateMedicationPurchase({
    lines: [{ id: 'line', quantity: 1, unit_cost: '20' }],
    allocation_method: 'value',
  }),
  vials_expected: 1,
  vials_linked: 0,
  packs_linked: 0,
  created_at: '2026-11-15T10:00:00Z',
  ...patch,
});
beforeEach(() => {
  mockUser = {
    id: '10000000-0000-4000-8000-000000000001',
    activeUserId: '10000000-0000-4000-8000-000000000001',
  };
  rows = [];
  jest.clearAllMocks();
  jest
    .mocked(api.getMedicationCostAnalyticsWithPrescriptionEstimates)
    .mockImplementation(async (_owner, window) => ({
      window: { key: window, from_date: '2025-11-15', to_date: '2026-11-15' },
      rows: [],
      ...emptyCostBreakdown,
      waste: { ...emptyCostBreakdown.waste, rows: [] },
      cost_basis: 'with_prescription_estimates',
      accounted: [],
    }));
  jest
    .mocked(api.getMedicationPurchaseIdentity)
    .mockImplementation(async () => ({
      authenticatedUserId: mockUser.id,
      activeUserId: mockUser.activeUserId,
    }));
  jest
    .mocked(api.listMedicationPurchases)
    .mockImplementation(async () => ({ purchases: [...rows] }));
  jest
    .mocked(api.getMedicationPurchase)
    .mockImplementation(async () => ({ ...rows[0]! }));
  jest.mocked(api.getMedicationPurchaseEditorData).mockResolvedValue({
    medications: [{ id: med, name: 'Synthetic medication' }],
    vials: [],
    packs: [],
  });
  jest.mocked(api.createMedicationPurchase).mockImplementation(async () => {
    const row = view();
    rows = [row];
    return row;
  });
  jest
    .mocked(api.updateMedicationPurchase)
    .mockImplementation(async (_id, body) => {
      const row = view({ revision: 2, notes: body.notes ?? '' });
      rows = [row];
      return row;
    });
  jest.mocked(api.deleteMedicationPurchase).mockImplementation(async () => {
    rows = [];
  });
});
function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/medications?tab=costs']}>
        <MedicationCosts />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}
it('creates, reopens, edits and deletes with owner/revision bindings', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Add invoice' }));
  await screen.findByRole('heading', { name: 'New invoice' });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await screen.findByText('Synthetic supplier · SYN-1');
  expect(api.createMedicationPurchase).toHaveBeenCalledWith(
    expect.objectContaining({
      expected_owner_id: mockUser.id,
      operation_id: expect.any(String),
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByRole('heading', { name: 'Edit invoice' });
  expect(screen.getByLabelText('Unit cost')).toHaveValue('20');
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Synthetic edited notes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await screen.findByText('Synthetic edited notes');
  expect(api.updateMedicationPurchase).toHaveBeenCalledWith(
    rows[0]!.id,
    expect.objectContaining({
      expected_owner_id: mockUser.id,
      expected_revision: 1,
      notes: 'Synthetic edited notes',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('dialog', { name: 'Delete this invoice?' });
  expect(
    screen.getByText(
      'The vials are kept. Costs are recalculated from eligible linked prescriptions; otherwise they become uncosted.'
    )
  ).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
  await screen.findByText('No invoices yet');
  expect(api.deleteMedicationPurchase).toHaveBeenCalledWith(
    expect.any(String),
    { expected_owner_id: mockUser.id, expected_revision: 2 }
  );
});
it('keeps a stale edit draft until the explicit reload action', async () => {
  rows = [view()];
  jest
    .mocked(api.updateMedicationPurchase)
    .mockRejectedValueOnce(
      new HttpApiError('Synthetic revision conflict', 409)
    );
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('heading', { name: 'Edit invoice' });
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Synthetic unsaved draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await screen.findByText('Synthetic revision conflict');
  expect(screen.getByLabelText('Notes')).toHaveValue('Synthetic unsaved draft');
  expect(screen.getByRole('button', { name: 'Save invoice' })).toBeDisabled();
  rows = [view({ revision: 2, notes: 'Synthetic server update' })];
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved invoice' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Notes')).toHaveValue(
      'Synthetic server update'
    )
  );
});
it('removes an open draft immediately on context cache clear and ignores a pending result', async () => {
  let finish!: (value: MedicationPurchaseView) => void;
  jest.mocked(api.createMedicationPurchase).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const client = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Add invoice' }));
  await screen.findByRole('heading', { name: 'New invoice' });
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Synthetic private draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await waitFor(() => expect(api.createMedicationPurchase).toHaveBeenCalled());
  const reads = jest.mocked(api.listMedicationPurchases).mock.calls.length;
  act(() => client.clear());
  expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  await act(async () => finish(view()));
  expect(
    screen.queryByText('Synthetic supplier · SYN-1')
  ).not.toBeInTheDocument();
  expect(api.listMedicationPurchases).toHaveBeenCalledTimes(reads);
});
it('renders each invoice currency without a mixed-currency aggregate', async () => {
  rows = [
    view(),
    view({
      id: '50000000-0000-4000-8000-000000000005',
      currency: 'GBP',
      reference: 'SYN-2',
    }),
  ];
  open();
  await screen.findByText('Synthetic supplier · SYN-1');
  expect(screen.getByText('Synthetic supplier · SYN-2')).toBeInTheDocument();
  expect(screen.getAllByText(/AUD 20\.00/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/GBP 20\.00/).length).toBeGreaterThan(0);
  // No single total is invented across currencies: the headline stays blank.
  expect(screen.queryByText(/(AUD|GBP) 40\.00/)).not.toBeInTheDocument();
});

it('refreshes matching candidates as well as the saved invoice after a claim conflict', async () => {
  rows = [view()];
  const candidate = {
    id: '60000000-0000-4000-8000-000000000006',
    medication_id: med,
    medication_name: 'Synthetic medication',
    label: 'Synthetic candidate',
    status: 'sealed',
    lot_number: null,
    expiry_date: null,
    purchase_item_id: null,
  };
  jest.mocked(api.getMedicationPurchaseEditorData).mockResolvedValue({
    medications: [{ id: med, name: 'Synthetic medication' }],
    vials: [candidate],
    packs: [],
  });
  jest
    .mocked(api.updateMedicationPurchase)
    .mockRejectedValueOnce(
      new HttpApiError('Synthetic vial claimed elsewhere', 409)
    );
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('heading', { name: 'Edit invoice' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await screen.findByText('Synthetic vial claimed elsewhere');
  jest.mocked(api.getMedicationPurchaseEditorData).mockResolvedValue({
    medications: [{ id: med, name: 'Synthetic medication' }],
    vials: [],
    packs: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved invoice' }));
  await screen.findByText(/No unmatched vials for this medication/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(api.getMedicationPurchaseEditorData).toHaveBeenCalledTimes(2);
});

it('keeps the dirty draft if either part of the explicit reload fails', async () => {
  rows = [view()];
  jest
    .mocked(api.updateMedicationPurchase)
    .mockRejectedValueOnce(new HttpApiError('Synthetic stale revision', 409));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('heading', { name: 'Edit invoice' });
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Synthetic retained draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
  await screen.findByText('Synthetic stale revision');
  jest
    .mocked(api.getMedicationPurchaseEditorData)
    .mockRejectedValueOnce(new Error('Synthetic reload unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved invoice' }));
  await screen.findByText(
    'Could not reload the invoice and matching stock. Your draft is kept.'
  );
  expect(screen.getByLabelText('Notes')).toHaveValue(
    'Synthetic retained draft'
  );
});

it('keeps all invoice cards and old edit links independent of report windows', async () => {
  rows = [view({ ordered_date: '2020-01-01', reference: 'SYN-OLDER' })];
  open();
  await screen.findByText('Synthetic supplier · SYN-OLDER');
  expect(screen.getByRole('button', { name: '12m' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '3m' }));
  await waitFor(() =>
    expect(
      api.getMedicationCostAnalyticsWithPrescriptionEstimates
    ).toHaveBeenLastCalledWith(mockUser.id, '3', expect.any(AbortSignal))
  );
  expect(
    screen.getByText('Synthetic supplier · SYN-OLDER')
  ).toBeInTheDocument();
  expect(api.listMedicationPurchases).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByRole('heading', { name: 'Edit invoice' });
  expect(screen.getByLabelText('Ordered')).toHaveValue('2020-01-01');
});

it('shows known-zero stock estimates beside an empty invoice ledger', async () => {
  jest
    .mocked(api.getMedicationCostAnalyticsWithPrescriptionEstimates)
    .mockImplementation(async (_owner, window) => ({
      ...emptyCostBreakdown,
      waste: { ...emptyCostBreakdown.waste, rows: [] },
      window: { key: window, from_date: '2025-11-15', to_date: '2026-11-15' },
      rows: [],
      cost_basis: 'with_prescription_estimates',
      accounted: [
        {
          currency: 'GBP',
          invoice_cash: '0',
          prescription_estimate: '0',
          accounted_total: '0',
          estimated_vials: 1,
          undated_vials: 1,
        },
      ],
    }));
  open();
  await screen.findByText('No invoices yet');
  await screen.findByRole('region', {
    name: 'Accounted values by recorded currency',
  });
  expect(
    screen.getByText('1 estimated vials · no shipping')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Add invoice' })
  ).toBeInTheDocument();
  expect(api.createMedicationPurchase).not.toHaveBeenCalled();
});
