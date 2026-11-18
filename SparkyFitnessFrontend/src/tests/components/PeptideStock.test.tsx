import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import PeptideStock from '@/pages/Medications/PeptideStock';
import {
  dashboardFixture,
  dashboardPen,
  queueItem,
} from '@/tests/fixtures/medicationInventoryDashboard';
import type { Medication, MedicationPen } from '@/types/medications';
const mockSave = jest.fn();
const mockPens = jest.fn(
  (_id: string): { data: MedicationPen[]; isError?: boolean } => ({ data: [] })
);
let mockDashboard = dashboardFixture({ preparation_queue: [] });
let mockReady = true;
let mockScopeKey = 'owner:1';
let mockError = false;
jest.mock('@/hooks/Medications/useMedicationStockDashboard', () => ({
  useMedicationStockDashboard: () => ({
    scope: {
      ready: mockReady,
      canWrite: true,
      key: mockScopeKey,
      isCurrent: () => mockReady,
    },
    query: { isError: mockError },
    data: mockDashboard,
  }),
  usePreparationQueueStock: () => ({ scope: { ready: false } }),
}));
jest.mock('@/hooks/Medications/useMedicationInventoryForecast', () => ({
  useMedicationInventoryForecast: () => ({
    scope: { ready: mockReady, isCurrent: () => mockReady },
    query: { isError: false },
    data: undefined,
  }),
}));
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptionScope: () => ({
    ready: false,
    key: mockScopeKey,
    canWrite: false,
    isCurrent: () => false,
  }),
  useMedicationPrescriptions: () => ({
    scope: { ready: false },
    query: {},
    data: undefined,
  }),
}));
jest.mock('@/pages/Medications/MedicationVialCostLink', () => ({
  __esModule: true,
  default: () => <p>Existing cost link</p>,
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: (id: string) => mockPens(id),
  useCreatePenMutation: () => ({ mutate: mockSave, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useDeletePenMutation: () => ({ mutate: jest.fn(), isPending: false }),
  usePreparationReview: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
  }),
  useCorrectPreparationMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));
jest.mock('@/hooks/useMedicationSyringes', () => ({
  useMedicationSyringes: () => ({
    data: {
      syringes: [
        {
          id: 'device',
          name: 'Synthetic U100',
          graduation_type: 'units',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '1',
        },
      ],
      default_syringe_id: null,
    },
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => day,
  }),
}));
jest.mock('@/pages/Medications/AddMedicationDialog', () => ({
  __esModule: true,
  default: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={() => onOpenChange(false)}>
          Cancel new medication
        </button>
      </div>
    ) : null,
}));
jest.mock('@/pages/Medications/Glp1LogInjection', () => ({
  __esModule: true,
  default: ({ med }: { med: Medication }) => (
    <p>{`Log injection: ${med.id}`}</p>
  ),
}));
jest.mock('@/pages/Medications/Glp1RecentInjections', () => ({
  __esModule: true,
  default: () => <p>Injection history</p>,
}));
const peptide = {
  id: 'peptide',
  name: 'Example peptide',
  type_id: 'injection',
  is_glp1: false,
  dose_amount: 500,
  dose_unit: 'mcg',
  is_active: true,
} as Medication;
beforeEach(() => {
  mockSave.mockClear();
  mockPens.mockReset();
  mockPens.mockReturnValue({ data: [] });
  mockDashboard = dashboardFixture({ preparation_queue: [] });
  mockReady = true;
  mockScopeKey = 'owner:1';
  mockError = false;
});
it('shows preparation tools without injection logging or history for a non-GLP-1 peptide', () => {
  render(
    <MemoryRouter
      initialEntries={['/medications?tab=stock&medication=peptide']}
    >
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.getByLabelText('Medication for new stock')).toHaveTextContent(
    'Example peptide'
  );
  expect(screen.queryByText('Log injection: peptide')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection history')).not.toBeInTheDocument();
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'More stock tools' }),
    { button: 0, ctrlKey: false }
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Prepare a vial' }));
  fireEvent.click(screen.getByRole('button', { name: /Dry powder —/ }));
  fireEvent.change(screen.getByLabelText('Prepared date'), {
    target: { value: '2026-11-15' },
  });
  fireEvent.change(screen.getByLabelText('Powder in the vial'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Diluent added (mL)'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
  expect(screen.getByText('4 mg/mL')).toBeInTheDocument();
  expect(screen.getByText('500 mcg · 0.125 mL')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'vial',
      dose_mg: 0.5,
      preparation: expect.objectContaining({
        mass_value: '12',
        final_volume_ml: '3',
      }),
    }),
    expect.anything()
  );
});
it('shows a clear add-injectable entry point without existing peptides', () => {
  render(
    <MemoryRouter>
      <PeptideStock meds={[]} />
    </MemoryRouter>
  );
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'More stock tools' }),
    { button: 0, ctrlKey: false }
  );
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Add peptide / injectable' })
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel new medication' })
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.getByText(
      /Existing injectable medications appear here automatically/
    )
  ).toBeInTheDocument();
});
it('honours a direct link to a different injectable and keeps its stock queries scoped', () => {
  const other = { ...peptide, id: 'second', name: 'Second peptide' };
  render(
    <MemoryRouter initialEntries={['/medications?tab=stock&medication=second']}>
      <PeptideStock meds={[peptide, other]} />
    </MemoryRouter>
  );
  expect(screen.getByLabelText('Medication for new stock')).toHaveTextContent(
    'Second peptide'
  );
  expect(mockPens).toHaveBeenCalledWith('second');
});

it('lists all medications without turning the new-stock picker into an overview filter', () => {
  const other = {
    ...peptide,
    id: 'second',
    name: 'Inactive blend',
    is_active: false,
  };
  mockDashboard = dashboardFixture({
    preparation_queue: [
      queueItem({
        stock_id: 'raw-one',
        medication_id: peptide.id,
        medication_name: peptide.name,
      }),
      queueItem({
        stock_id: 'raw-two',
        medication_id: other.id,
        medication_name: other.name,
      }),
    ],
  });
  mockPens.mockImplementation((id) => ({
    data:
      id === peptide.id
        ? [
            dashboardPen({
              id: 'used',
              medication_id: id,
              label: 'Used custom label',
              status: 'in_use',
              doses_used: 1,
            }),
            dashboardPen({ id: 'raw-one', medication_id: id }),
          ]
        : [
            dashboardPen({ id: 'raw-two', medication_id: id }),
            dashboardPen({
              id: 'legacy',
              medication_id: id,
              label: 'Legacy physical stock',
              concentration_mg_ml: 5,
            }),
            dashboardPen({
              id: 'closed',
              medication_id: id,
              status: 'discarded',
              label: 'Archived vial',
            }),
          ],
  }));
  const { container } = render(
    <MemoryRouter initialEntries={['/medications?tab=stock&medication=second']}>
      <PeptideStock meds={[peptide, other]} />
    </MemoryRouter>
  );
  expect(screen.getByLabelText('Medication for new stock')).toHaveTextContent(
    'Inactive blend'
  );
  const tracked = screen.getByRole('region', { name: 'Tracked stock' });
  expect(tracked).toHaveTextContent('Used custom label');
  expect(tracked).toHaveTextContent('Legacy physical stock');
  expect(tracked.querySelectorAll('article')).toHaveLength(2);
  const queue = screen.getByRole('region', { name: 'Needs preparation' });
  expect(queue.querySelectorAll('details')).toHaveLength(2);
  expect(queue).toHaveTextContent('Inactive blend');
  expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  expect(screen.getByText('Archived vial')).toBeInTheDocument();
  const disclosures = Array.from(container.querySelectorAll('summary')).map(
    (node) => node.textContent
  );
  expect(disclosures.at(-1)).toBe('Stock forecasts');
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Add Inventory');
  expect(mockSave).not.toHaveBeenCalled();
});
it('does not construct stock cards or actions from stale/failed dashboard classification', () => {
  mockError = true;
  mockPens.mockReturnValue({
    data: [dashboardPen({ medication_id: peptide.id })],
  });
  const { container } = render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No preparation eligibility is assumed'
  );
  expect(container.querySelectorAll('article')).toHaveLength(0);
  expect(mockSave).not.toHaveBeenCalled();
});
it('drops overview and stock actions when authoritative profile readiness is lost', () => {
  const { rerender } = render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  mockReady = false;
  rerender(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(
    screen.queryByRole('button', { name: 'Add Inventory' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Tracked stock' })
  ).not.toBeInTheDocument();
});

it('closes the preparation dialog back to More and drops its draft across medication/profile changes', async () => {
  const other = { ...peptide, id: 'second', name: 'Other medication' };
  const view = render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  const more = screen.getByRole('button', { name: 'More stock tools' });
  fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Prepare a vial' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(more).toHaveFocus());
  fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Prepare a vial' }));
  view.rerender(
    <MemoryRouter>
      <PeptideStock meds={[other]} />
    </MemoryRouter>
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'More stock tools' }),
    { button: 0, ctrlKey: false }
  );
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Add peptide / injectable' })
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  mockScopeKey = 'owner:2';
  view.rerender(
    <MemoryRouter>
      <PeptideStock meds={[other]} />
    </MemoryRouter>
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
it('uses loaded counts without a render loop and hides empty groups after data or scope changes', () => {
  mockPens.mockReturnValue({
    data: [dashboardPen({ medication_id: peptide.id, status: 'discarded' })],
  });
  const view = render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.getByText('Finished / discarded')).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'In use' })
  ).not.toBeInTheDocument();
  mockPens.mockReturnValue({
    data: [dashboardPen({ medication_id: peptide.id, status: 'in_use' })],
  });
  view.rerender(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.queryByText('Finished / discarded')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'In use' })).toBeInTheDocument();
  mockScopeKey = 'owner:2';
  mockPens.mockReturnValue({ data: [] });
  view.rerender(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(
    screen.queryByRole('heading', { name: 'In use' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Finished / discarded')).not.toBeInTheDocument();
});
