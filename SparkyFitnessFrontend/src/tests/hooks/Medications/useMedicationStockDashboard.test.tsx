import '@testing-library/jest-dom';
import { useEffect } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { medicationPreparationSchema } from '@workspace/shared';
import {
  useMedicationStockDashboard,
  usePreparationQueueStock,
} from '@/hooks/Medications/useMedicationStockDashboard';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import { getMedicationStockDashboard } from '@/api/Medications/inventoryDashboardService';
import { listPens } from '@/api/Medications/medicationService';
import {
  dashboardFixture,
  dashboardPen,
  dashboardStockId,
  queueItem,
} from '@/tests/fixtures/medicationInventoryDashboard';
import {
  courseIds,
  courseMedication,
} from '@/tests/fixtures/medicationCourses';
import MedicationPreparationQueue from '@/pages/Medications/MedicationPreparationQueue';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => day }),
}));
jest.mock('@/pages/Medications/MedicationPreparationWizard', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <p>Validated inline wizard</p>
      <button onClick={onClose}>Cancel inline preparation</button>
    </div>
  ),
}));

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner;
let mockRead = true;
let mockWrite = true;
let mockExpanded = true;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockActive,
    hasPermission: (permission: string) =>
      permission === 'can_manage_medications' && mockRead,
    hasWritePermission: () => mockWrite,
  }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
}));
jest.mock('@/api/Medications/inventoryDashboardService', () => ({
  getMedicationStockDashboard: jest.fn(),
}));
jest.mock('@/api/Medications/medicationService', () => ({
  listPens: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const dashboard = jest.mocked(getMedicationStockDashboard);
const pens = jest.mocked(listPens);
let currentDashboard: ReturnType<typeof useMedicationStockDashboard>;
let currentQueue: ReturnType<typeof usePreparationQueueStock>;
function DashboardProbe() {
  const state = useMedicationStockDashboard();
  useEffect(() => {
    currentDashboard = state;
  }, [state]);
  return (
    <output data-testid="dashboard">
      {state.scope.ready
        ? (state.data?.preparation_queue[0]?.label ?? 'waiting')
        : 'private'}
    </output>
  );
}
function QueueProbe() {
  const state = usePreparationQueueStock(
    courseIds.med,
    dashboardStockId,
    mockExpanded
  );
  useEffect(() => {
    currentQueue = state;
  }, [state]);
  return (
    <output data-testid="queue">
      {!state.scope.ready
        ? 'private'
        : state.query.isError
          ? 'error'
          : (state.data?.pen.id ?? 'waiting')}
    </output>
  );
}
function setup(mode: 'dashboard' | 'queue' | 'both' = 'queue') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      {mode !== 'queue' && <DashboardProbe />}
      {mode !== 'dashboard' && <QueueProbe />}
    </QueryClientProvider>
  );
  return { client, tree, ...render(tree()) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockRead = true;
  mockWrite = true;
  mockExpanded = true;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  dashboard.mockReset().mockResolvedValue(dashboardFixture());
  pens.mockReset().mockResolvedValue([dashboardPen()]);
});
it('requests no private dashboard or exact-stock reads before authoritative identity resolves', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  setup('both');
  expect(dashboard).not.toHaveBeenCalled();
  expect(pens).not.toHaveBeenCalled();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() =>
    expect(screen.getByTestId('queue')).toHaveTextContent(dashboardStockId)
  );
  expect(dashboard).toHaveBeenCalledWith(
    courseIds.owner,
    expect.any(AbortSignal)
  );
  expect(pens).toHaveBeenCalledWith(courseIds.med, expect.any(AbortSignal));
});
it('blocks all private reads when authoritative proof names another actor', async () => {
  identity.mockResolvedValue({
    authenticatedUserId: otherOwner,
    activeUserId: courseIds.owner,
  });
  const { client } = setup('both');
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[0] === 'medication-course-scope' &&
            query.state.status === 'success'
        )
    ).toBe(true)
  );
  expect(dashboard).not.toHaveBeenCalled();
  expect(pens).not.toHaveBeenCalled();
  expect(screen.getByTestId('dashboard')).toHaveTextContent('private');
  expect(screen.getByTestId('queue')).toHaveTextContent('private');
});
it('allows a read-only delegate to inspect dashboard but never starts a queue stock read', async () => {
  mockActive = otherOwner;
  mockWrite = false;
  setup('both');
  await waitFor(() =>
    expect(screen.getByTestId('dashboard')).toHaveTextContent('Example vial')
  );
  expect(dashboard).toHaveBeenCalledTimes(1);
  expect(dashboard).toHaveBeenCalledWith(otherOwner, expect.any(AbortSignal));
  expect(currentDashboard.scope.canWrite).toBe(false);
  expect(currentQueue.data).toBeUndefined();
  expect(pens).not.toHaveBeenCalled();
});
it('does not read dashboard or pens for a closed preparation row', async () => {
  mockExpanded = false;
  setup();
  await waitFor(() => expect(currentQueue.scope.ready).toBe(true));
  expect(dashboard).not.toHaveBeenCalled();
  expect(pens).not.toHaveBeenCalled();
});
it('revalidates the fresh dashboard then returns the exact matching existing vial rather than the first pen', async () => {
  const exact = dashboardPen({ label: 'Exact owned vial' });
  pens.mockResolvedValue([
    dashboardPen({ id: courseIds.step, label: 'Other stock' }),
    dashboardPen({
      medication_id: courseIds.revision2,
      label: 'Wrong medication',
    }),
    exact,
  ]);
  setup();
  await waitFor(() =>
    expect(screen.getByTestId('queue')).toHaveTextContent(dashboardStockId)
  );
  expect(dashboard).toHaveBeenCalledTimes(1);
  expect(pens).toHaveBeenCalledTimes(1);
  expect(dashboard.mock.invocationCallOrder[0]!).toBeLessThan(
    pens.mock.invocationCallOrder[0]!
  );
  expect(currentQueue.data).toEqual({ row: queueItem(), pen: exact });
  expect(pens.mock.calls[0]![1]).toBe(dashboard.mock.calls[0]![1]);
  expect(dashboard).toHaveBeenCalledWith(
    courseIds.owner,
    expect.any(AbortSignal)
  );
  expect(pens).toHaveBeenCalledWith(courseIds.med, expect.any(AbortSignal));
});
it.each([
  { name: 'missing queue row', rows: [] },
  {
    name: 'same stock ID attached to another medication',
    rows: [queueItem({ medication_id: courseIds.revision2 })],
  },
  {
    name: 'different stock ID',
    rows: [queueItem({ stock_id: courseIds.step })],
  },
])(
  'does not call listPens after fresh eligibility reports $name',
  async ({ rows }) => {
    dashboard.mockResolvedValue(dashboardFixture({ preparation_queue: rows }));
    setup();
    await waitFor(() =>
      expect(screen.getByTestId('queue')).toHaveTextContent('error')
    );
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(pens).not.toHaveBeenCalled();
    expect(currentQueue.data).toBeUndefined();
  }
);
it.each([
  {
    name: 'missing exact existing stock',
    records: [dashboardPen({ id: courseIds.step })],
  },
  {
    name: 'existing stock attached to another medication',
    records: [dashboardPen({ medication_id: courseIds.revision2 })],
  },
  { name: 'pen instead of vial', records: [dashboardPen({ kind: 'pen' })] },
  {
    name: 'formal preparation appeared between reads',
    records: [
      dashboardPen({
        preparation: medicationPreparationSchema.parse({
          id: courseIds.step,
          mode: 'reconstituted',
          mass_value: 10,
          mass_unit: 'mg',
          mass_mg: 10,
          concentration_mg_ml: 5,
          final_volume_ml: 2,
          prepared_date: '2026-11-16',
          created_at: '2026-11-16T12:00:00Z',
        }),
      }),
    ],
  },
])(
  'rejects a late incompatible existing record: $name',
  async ({ records }) => {
    pens.mockResolvedValue(records);
    setup();
    await waitFor(() =>
      expect(screen.getByTestId('queue')).toHaveTextContent('error')
    );
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(pens).toHaveBeenCalledTimes(1);
    expect(currentQueue.data).toBeUndefined();
  }
);
it('stops before listPens when the same user changes profile during the first fresh read', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationStockDashboard>>>();
  dashboard.mockImplementation((ownerId) =>
    ownerId === courseIds.owner
      ? pending.promise
      : Promise.resolve(dashboardFixture({ preparation_queue: [] }))
  );
  const { tree, rerender } = setup();
  await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(1));
  const retainedScope = currentQueue.scope;
  const sameUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(sameUser);
  expect(retainedScope.isCurrent()).toBe(false);
  await waitFor(() =>
    expect(dashboard).toHaveBeenCalledWith(otherOwner, expect.any(AbortSignal))
  );
  await act(async () => pending.resolve(dashboardFixture()));
  expect(pens).not.toHaveBeenCalled();
  expect(currentQueue.data).toBeUndefined();
  expect(screen.getByTestId('queue')).not.toHaveTextContent(dashboardStockId);
});
it('fails closed on same-UUID cache clearing while a fresh queue read is pending', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationStockDashboard>>>();
  dashboard.mockReturnValue(pending.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(1));
  const retainedScope = currentQueue.scope;
  act(() => client.clear());
  expect(retainedScope.isCurrent()).toBe(false);
  await act(async () => pending.resolve(dashboardFixture()));
  rerender(tree());
  expect(screen.getByTestId('queue')).toHaveTextContent('private');
  expect(currentQueue.data).toBeUndefined();
  expect(pens).not.toHaveBeenCalled();
  expect(dashboard).toHaveBeenCalledTimes(1);
});
it('hides a late dashboard-only response from the previous active profile', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationStockDashboard>>>();
  dashboard.mockImplementation((ownerId) =>
    ownerId === courseIds.owner
      ? pending.promise
      : Promise.resolve(
          dashboardFixture({
            preparation_queue: [queueItem({ label: 'Current owner vial' })],
          })
        )
  );
  const { tree, rerender } = setup('dashboard');
  await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(1));
  const retainedScope = currentDashboard.scope;
  mockActive = otherOwner;
  rerender(tree());
  expect(retainedScope.isCurrent()).toBe(false);
  await waitFor(() =>
    expect(screen.getByTestId('dashboard')).toHaveTextContent(
      'Current owner vial'
    )
  );
  await act(async () =>
    pending.resolve(
      dashboardFixture({
        preparation_queue: [queueItem({ label: 'Previous owner vial' })],
      })
    )
  );
  expect(screen.getByTestId('dashboard')).toHaveTextContent(
    'Current owner vial'
  );
  expect(screen.getByTestId('dashboard')).not.toHaveTextContent(
    'Previous owner vial'
  );
  expect(pens).not.toHaveBeenCalled();
});

it('freshly revalidates a cached exact vial on reopen with production cache defaults before mounting the wizard', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 60,
        refetchOnMount: true,
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <MedicationPreparationQueue
        meds={[{ ...courseMedication, type_id: 'injection' }]}
      />
    </QueryClientProvider>
  );
  await screen.findByText(/^Prepare ›$/);
  const expand = () => {
    const details = screen.getByText(/^Prepare ›$/).closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
  };
  expand();
  await screen.findByText('Validated inline wizard');
  expect(dashboard).toHaveBeenCalledTimes(2);
  expect(pens).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel inline preparation' })
  );
  expect(screen.queryByText('Validated inline wizard')).not.toBeInTheDocument();
  const freshDashboard =
    deferred<Awaited<ReturnType<typeof getMedicationStockDashboard>>>();
  const freshPens = deferred<Awaited<ReturnType<typeof listPens>>>();
  dashboard.mockReturnValueOnce(freshDashboard.promise);
  pens.mockReturnValueOnce(freshPens.promise);
  expand();
  await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking this existing vial'
  );
  expect(screen.queryByText('Validated inline wizard')).not.toBeInTheDocument();
  expect(pens).toHaveBeenCalledTimes(1);
  await act(async () => freshDashboard.resolve(dashboardFixture()));
  await waitFor(() => expect(pens).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Validated inline wizard')).not.toBeInTheDocument();
  await act(async () => freshPens.resolve([dashboardPen()]));
  await screen.findByText('Validated inline wizard');
  expect(pens.mock.calls[1]![0]).toBe(courseIds.med);
});
