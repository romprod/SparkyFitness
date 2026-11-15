import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMedicationPurchases,
  useMedicationPurchaseScope,
} from '@/hooks/useMedicationPurchases';
import * as api from '@/api/Medications/purchaseService';
let mockUser = { id: 'owner', activeUserId: 'owner' };
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  listMedicationPurchases: jest.fn(),
  getMedicationPurchaseIdentity: jest.fn(),
}));
const list = jest.mocked(api.listMedicationPurchases);
function Probe() {
  const scope = useMedicationPurchaseScope();
  const q = useMedicationPurchases(scope.ownerId, scope.ready);
  return (
    <p>
      {scope.ready
        ? `ready:${q.data?.purchases.length ?? 'loading'}`
        : 'private'}
    </p>
  );
}
beforeEach(() => {
  mockUser = { id: 'owner', activeUserId: 'owner' };
  list.mockReset();
  list.mockResolvedValue({ purchases: [] });
  jest.mocked(api.getMedicationPurchaseIdentity).mockReset();
  jest
    .mocked(api.getMedicationPurchaseIdentity)
    .mockImplementation(async () => ({
      authenticatedUserId: mockUser.id,
      activeUserId: mockUser.activeUserId,
    }));
});
it('never requests financial endpoints while acting for another profile', () => {
  mockUser = { id: 'owner', activeUserId: 'delegate' };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
});
it('drops financial readiness synchronously on clear before active identity has refreshed', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const { rerender } = render(tree());
  await screen.findByText('ready:0');
  expect(list).toHaveBeenCalledWith('owner');
  act(() => client.clear());
  expect(screen.getByText('private')).toBeInTheDocument();
  rerender(tree());
  expect(list).toHaveBeenCalledTimes(1);
  mockUser = { id: 'owner', activeUserId: 'delegate' };
  rerender(tree());
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(1);
  mockUser = { id: 'owner', activeUserId: 'owner' };
  rerender(tree());
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});

it('waits for delayed authoritative self identity before any financial request', async () => {
  let resolve!: (value: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  jest.mocked(api.getMedicationPurchaseIdentity).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  await act(async () =>
    resolve({ authenticatedUserId: 'owner', activeUserId: 'owner' })
  );
  await screen.findByText('ready:0');
  expect(list).toHaveBeenCalledTimes(1);
});

it('makes zero financial requests when a self-looking session resolves to a delegated identity', async () => {
  let resolve!: (value: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  jest.mocked(api.getMedicationPurchaseIdentity).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  expect(list).not.toHaveBeenCalled();
  await act(async () =>
    resolve({ authenticatedUserId: 'owner', activeUserId: 'delegate' })
  );
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
});

it('fails closed when identity verification is unavailable', async () => {
  jest
    .mocked(api.getMedicationPurchaseIdentity)
    .mockRejectedValueOnce(new Error('Synthetic identity unavailable'));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error')
  );
  expect(list).not.toHaveBeenCalled();
  expect(screen.getByText('private')).toBeInTheDocument();
});

it('ignores a late identity result after clear until a fresh identity generation is verified', async () => {
  let resolve!: (value: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  jest.mocked(api.getMedicationPurchaseIdentity).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const { rerender } = render(tree());
  act(() => client.clear());
  await act(async () =>
    resolve({ authenticatedUserId: 'owner', activeUserId: 'owner' })
  );
  rerender(tree());
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  mockUser = { id: 'owner', activeUserId: 'owner' };
  rerender(tree());
  await screen.findByText('ready:0');
  expect(api.getMedicationPurchaseIdentity).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(1);
});

it('does not accept proof for a different authenticated account', async () => {
  jest.mocked(api.getMedicationPurchaseIdentity).mockResolvedValueOnce({
    authenticatedUserId: 'different-actor',
    activeUserId: 'owner',
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe('success')
  );
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
});
