import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDiaryMedicationCharts } from '@/hooks/Diary/useDiaryMedicationCharts';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import { listMedications } from '@/api/Medications/medicationService';
import type { Medication } from '@/types/medications';
let mockUser = { id: 'actor', activeUserId: 'actor' };
let mockPermission = true;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockUser.activeUserId,
    hasPermission: (p: string) => mockPermission && p === 'reports',
  }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
}));
jest.mock('@/api/Medications/medicationService', () => ({
  listMedications: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const list = jest.mocked(listMedications);
const med = (id: string, fields: Partial<Medication> = {}) =>
  ({
    id,
    user_id: mockUser.activeUserId,
    name: 'semaglutide',
    is_active: true,
    is_glp1: true,
    custom_fields: {},
    ...fields,
  }) as Medication;
function Probe() {
  const meds = useDiaryMedicationCharts();
  return <p>{meds.map((m) => m.id).join(',') || 'none'}</p>;
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  return { client, tree, ...render(tree()) };
}
beforeEach(() => {
  mockUser = { id: 'actor', activeUserId: 'actor' };
  mockPermission = true;
  identity.mockReset();
  list.mockReset();
  identity.mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockUser.activeUserId,
  }));
  list.mockResolvedValue([med('one')]);
});
it('waits for authoritative identity before any medication read', async () => {
  let resolve!: (v: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  identity.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  setup();
  expect(list).not.toHaveBeenCalled();
  await act(async () =>
    resolve({ authenticatedUserId: 'actor', activeUserId: 'actor' })
  );
  await screen.findByText('one');
});
it('permits report-authorized delegation and retains unresolved diagnostic candidates but filters inactive, unflagged and wrong-owner rows', async () => {
  mockUser = { id: 'actor', activeUserId: 'delegate' };
  list.mockResolvedValue([
    med('one'),
    med('two'),
    med('inactive', { is_active: false }),
    med('flag', { is_glp1: false }),
    med('unknown', { name: 'unknown' }),
    med('foreign', { user_id: 'other' }),
  ]);
  setup();
  await screen.findByText('one,two,unknown');
});
it('Diary-only access requests neither identity nor medication data', () => {
  mockPermission = false;
  setup();
  expect(identity).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});
it('fails closed on identity error or wrong active profile', async () => {
  identity.mockResolvedValue({
    authenticatedUserId: 'actor',
    activeUserId: 'other',
  });
  setup();
  await waitFor(() => expect(identity).toHaveBeenCalled());
  expect(list).not.toHaveBeenCalled();
});
it('hides immediately on clear, rejects late old completion, and requires fresh user generation', async () => {
  let resolve!: (v: Medication[]) => void;
  list.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { client, rerender, tree } = setup();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  act(() => client.clear());
  await act(async () =>
    resolve([med('late', { name: 'Unresolved old profile' })])
  );
  expect(screen.getByText('none')).toBeInTheDocument();
  rerender(tree());
  expect(list).toHaveBeenCalledTimes(1);
  mockUser = { id: 'actor', activeUserId: 'delegate' };
  list.mockResolvedValue([med('new', { name: 'Unresolved new profile' })]);
  rerender(tree());
  await screen.findByText('new');
  expect(screen.queryByText('late')).not.toBeInTheDocument();
});
it('removing an inactive generation never revokes current proof', async () => {
  const { client, rerender, tree } = setup();
  await screen.findByText('one');
  const oldKeys = client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
  mockUser = { id: 'actor', activeUserId: 'actor' };
  list.mockResolvedValue([med('fresh')]);
  rerender(tree());
  await screen.findByText('fresh');
  act(() =>
    oldKeys.forEach((queryKey) =>
      client.removeQueries({ queryKey, exact: true })
    )
  );
  expect(screen.getByText('fresh')).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(2);
});
it('identity failure never starts medication queries', async () => {
  identity.mockRejectedValue(new Error('identity unavailable'));
  const { client } = setup();
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error')
  );
  expect(list).not.toHaveBeenCalled();
  expect(screen.getByText('none')).toBeInTheDocument();
});

it('retains all-unresolved active GLP-1 candidates for an omission-only widget', async () => {
  list.mockResolvedValue([
    med('unknown-a', { name: 'Unlisted A' }),
    med('unknown-b', { name: 'Unlisted B' }),
  ]);
  setup();
  await screen.findByText('unknown-a,unknown-b');
});
