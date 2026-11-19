import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import PeptideStock from '@/pages/Medications/PeptideStock';
import {
  dashboardFixture,
  dashboardPen,
  queueItem,
} from '@/tests/fixtures/medicationInventoryDashboard';
import type { Medication, MedicationPen } from '@/types/medications';
import type { MedicationPackView } from '@workspace/shared';
const mockSave = jest.fn();
const mockUpdatePen = jest.fn();
const mockDeletePen = jest.fn();
const mockPens = jest.fn(
  (_id: string): { data: MedicationPen[]; isError?: boolean } => ({ data: [] })
);
let mockDashboard = dashboardFixture({ preparation_queue: [] });
let mockPackList: MedicationPackView[] = [];
const mockPackMutate = jest.fn();
jest.mock('@/hooks/Medications/useMedicationPacks', () => ({
  useMedicationPacks: () => ({
    scope: { ready: mockReady, isCurrent: () => mockReady },
    query: { isError: false },
    data: { today: '2026-11-18', packs: mockPackList },
  }),
  useCreatePackMutation: () => ({ mutate: mockPackMutate, isPending: false }),
  useUpdatePackMutation: () => ({ mutate: mockPackMutate, isPending: false }),
  useDeletePackMutation: () => ({ mutate: mockPackMutate, isPending: false }),
}));
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
jest.mock('@/pages/Medications/MedicationPackCostLink', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: (id: string) => mockPens(id),
  useCreatePenMutation: () => ({ mutate: mockSave, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: mockUpdatePen, isPending: false }),
  useDeletePenMutation: () => ({ mutate: mockDeletePen, isPending: false }),
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
  mockUpdatePen.mockClear();
  mockDeletePen.mockClear();
  mockPens.mockReset();
  mockPens.mockReturnValue({ data: [] });
  mockDashboard = dashboardFixture({ preparation_queue: [] });
  mockReady = true;
  mockScopeKey = 'owner:1';
  mockError = false;
  mockPackList = [];
  mockPackMutate.mockClear();
});
it('shows preparation tools without injection logging or history for a non-GLP-1 peptide', () => {
  render(
    <MemoryRouter
      initialEntries={['/medications?tab=stock&medication=peptide']}
    >
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.queryByText('Log injection: peptide')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection history')).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add stock' }), {
    button: 0,
    ctrlKey: false,
  });
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
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add stock' }), {
    button: 0,
    ctrlKey: false,
  });
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
  const tracked = screen.getByRole('region', { name: 'Tracked stock' });
  expect(tracked).toHaveTextContent('Used custom label');
  expect(tracked).toHaveTextContent('Legacy physical stock');
  expect(tracked.querySelectorAll('article')).toHaveLength(2);
  const queue = screen.getByRole('region', { name: 'Needs preparation' });
  expect(queue.querySelectorAll('details')).toHaveLength(2);
  expect(queue).toHaveTextContent(/\d+ vials?/);
  expect(queue).toHaveTextContent('Inactive blend');
  expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  expect(screen.getByText(/Archived vial/)).toBeInTheDocument();
  const disclosures = Array.from(container.querySelectorAll('summary')).map(
    (node) => node.textContent
  );
  expect(disclosures.at(-1)).toBe('Stock forecasts');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add stock' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add a vial or pen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Add Pen / Vial');
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
    screen.queryByRole('button', { name: 'Add stock' })
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
  const more = screen.getByRole('button', { name: 'Add stock' });
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
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add stock' }), {
    button: 0,
    ctrlKey: false,
  });
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

it('shows one empty message instead of a placeholder card per medication, so stock cards keep their grid slots', () => {
  const other = {
    ...peptide,
    id: 'other',
    name: 'Other peptide',
  } as Medication;
  mockPens.mockImplementation((id: string) => ({
    data:
      id === 'other'
        ? [dashboardPen({ medication_id: 'other', status: 'in_use' })]
        : [],
  }));
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, other]} />
    </MemoryRouter>
  );
  expect(screen.queryByText(/No stock tracked for/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No vials yet/)).not.toBeInTheDocument();
  const tracked = screen.getByRole('region', { name: 'Tracked stock' });
  expect(tracked.querySelectorAll('article')).toHaveLength(1);
});

it('says so once when nothing is tracked for any medication', () => {
  mockPens.mockReturnValue({ data: [] });
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  expect(screen.getAllByText(/No vials yet/)).toHaveLength(1);
  expect(screen.queryByText(/No stock tracked for/)).not.toBeInTheDocument();
});

it('shows Prepare as a pill and a retired medication with a queued vial as a normal preparable card', () => {
  const retired = {
    ...peptide,
    id: 'retired',
    name: 'Retired blend',
    is_active: false,
  } as Medication;
  mockDashboard = dashboardFixture({
    preparation_queue: [
      queueItem({ stock_id: 'queued', medication_id: 'retired' }),
    ],
  });
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, retired]} />
    </MemoryRouter>
  );
  expect(
    screen.queryByText('Preparing stock requires medication edit access.')
  ).not.toBeInTheDocument();
  const pill = screen.getByText('Prepare ›');
  expect(pill).toHaveClass('rounded-full');
});

const pack = (over: Partial<MedicationPackView> = {}): MedicationPackView => ({
  id: 'pack-1',
  medication_id: 'tablet-med',
  medication_name: 'Synthetic tablets',
  label: null,
  unit_label: 'tablets',
  status: 'in_use',
  units_total: '60.000',
  units_used: '12.000',
  units_remaining: '48.000',
  overdrawn: false,
  doses_left: '24',
  observed_days_left: 20,
  planned_days_left: null,
  planned_empty_date: null,
  low: false,
  opened_at: '2026-11-01',
  expiry_date: null,
  expired: false,
  lot_number: null,
  storage_location: null,
  reorder_threshold_units: null,
  notes: null,
  ...over,
});
const tabletMed = {
  id: 'tablet-med',
  name: 'Synthetic tablets',
  type_id: 'tablet',
  is_glp1: false,
  dose_amount: 2,
  dose_unit: 'tablet',
  is_active: true,
} as Medication;

it('shows pack stock in the same in-use grid as vials, with remaining units, doses left and pace', () => {
  mockPackList = [pack()];
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, tabletMed]} />
    </MemoryRouter>
  );
  const tracked = screen.getByRole('region', { name: 'Tracked stock' });
  const card = within(tracked).getByRole('article', {
    name: 'Pack of Synthetic tablets',
  });
  expect(card).toHaveTextContent('48 of 60 tablets left');
  expect(card).toHaveTextContent('24 doses left');
  expect(card).toHaveTextContent('~20 days at your recent pace');
  expect(screen.getByRole('heading', { name: 'In use' })).toBeInTheDocument();
  expect(screen.queryByText(/No vials yet/)).not.toBeInTheDocument();
});

it('shows the schedule-based run-out on a pack, or today when it is already due', () => {
  mockPackList = [
    pack({ planned_days_left: 24, planned_empty_date: '2026-12-12' }),
    pack({
      id: 'pack-2',
      label: 'Second',
      planned_days_left: 0,
      planned_empty_date: '2026-11-18',
    }),
    pack({ id: 'pack-3', label: 'Third' }),
  ];
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, tabletMed]} />
    </MemoryRouter>
  );
  expect(screen.getAllByText(/On your plan:/)).toHaveLength(2);
  expect(screen.getByText(/runs out .*~24 days/)).toBeInTheDocument();
  expect(screen.getByText('On your plan: runs out today')).toBeInTheDocument();
});

it('lists unopened packs apart, never under Needs preparation, with an Open action', () => {
  mockPackList = [
    pack({ status: 'sealed', units_used: '0.000', units_remaining: '60.000' }),
  ];
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, tabletMed]} />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: 'Unopened' })).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Needs preparation' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(mockPackMutate).toHaveBeenCalledWith({
    id: 'pack-1',
    body: { status: 'in_use', lifecycle_intent: true },
  });
});

it('flags low, expired and overdrawn packs and keeps finished packs in the archive', () => {
  mockPackList = [
    pack({ low: true, expired: true }),
    pack({
      id: 'pack-2',
      status: 'in_use',
      units_remaining: '-2.000',
      overdrawn: true,
      doses_left: '0',
    }),
    pack({ id: 'pack-3', status: 'finished', medication_name: 'Old tablets' }),
  ];
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, tabletMed]} />
    </MemoryRouter>
  );
  expect(screen.getByText('Low')).toBeInTheDocument();
  expect(screen.getByText('Expired')).toBeInTheDocument();
  expect(screen.getByText('Overdrawn by 2 tablets')).toBeInTheDocument();
  expect(screen.getByText('Finished / discarded')).toBeInTheDocument();
  expect(screen.getByText('Old tablets')).toBeInTheDocument();
});

it('offers Add pack for non-injectable medications and supplements only when allowed', () => {
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide, tabletMed]} />
    </MemoryRouter>
  );
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add stock' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add pack' }));
  expect(
    screen.getByRole('dialog', { name: 'Add a pack' })
  ).toBeInTheDocument();
  expect(screen.getByText(/Your dose is 2 tablet/)).toBeInTheDocument();
});

it('retires an in-use vial only after confirming, with explicit lifecycle intent', () => {
  mockPens.mockReturnValue({
    data: [
      dashboardPen({
        id: 'live',
        medication_id: peptide.id,
        status: 'in_use',
        doses_used: 1,
      }),
    ],
  });
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
  // Nothing happens until the confirmation is accepted.
  expect(mockUpdatePen).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {
    name: 'Retire Example vial?',
  });
  expect(dialog).toHaveTextContent('Doses already logged are kept.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
  expect(mockUpdatePen).toHaveBeenCalledWith({
    id: 'live',
    body: { status: 'finished', lifecycle_intent: true },
  });
});

it('keeps the vial when the retire confirmation is cancelled', () => {
  mockPens.mockReturnValue({
    data: [
      dashboardPen({
        id: 'live',
        medication_id: peptide.id,
        status: 'in_use',
        doses_used: 1,
      }),
    ],
  });
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
  const dialog = screen.getByRole('dialog', {
    name: 'Retire Example vial?',
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(mockUpdatePen).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('deletes a vial only after confirming that it cannot be undone', () => {
  mockPens.mockReturnValue({
    data: [
      dashboardPen({
        id: 'unused',
        medication_id: peptide.id,
        status: 'sealed',
        doses_used: 0,
      }),
    ],
  });
  render(
    <MemoryRouter>
      <PeptideStock meds={[peptide]} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(mockDeletePen).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {
    name: 'Delete Example vial?',
  });
  expect(dialog).toHaveTextContent('cannot be undone');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(mockDeletePen).toHaveBeenCalledWith('unused');
});
