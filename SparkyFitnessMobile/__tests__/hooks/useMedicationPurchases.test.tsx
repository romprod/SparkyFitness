import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  useMedicationCostsAccess,
  useMedicationCostAnalytics,
  useMedicationPurchases,
  useMedicationPurchase,
  useMedicationPurchaseEditorData,
  useMedicationVialCosts,
  useMedicationPurchaseMutations,
} from '../../src/hooks/useMedicationPurchases';
import * as api from '../../src/services/api/medicationPurchasesApi';
import { createTestQueryClient, createQueryWrapper } from './queryTestUtils';
const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
jest.mock('../../src/services/api/medicationPurchasesApi', () => ({
  getMedicationCostIdentity: jest.fn(),
  getMedicationCostAnalytics: jest.fn(),
  listMedicationPurchases: jest.fn(async () => ({ purchases: [] })),
  getMedicationPurchase: jest.fn(),
  getMedicationPurchaseEditorData: jest.fn(async () => ({
    medications: [],
    vials: [],
  })),
  getMedicationVialCosts: jest.fn(async () => ({ vials: [] })),
  createMedicationPurchase: jest.fn(),
  updateMedicationPurchase: jest.fn(),
  deleteMedicationPurchase: jest.fn(),
}));
jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: () => {},
}));
beforeEach(() => jest.clearAllMocks());
test('unknown or delegated identity makes zero financial requests, including stock/editor endpoints', async () => {
  let resolve!: (v: api.MedicationCostIdentity) => void;
  jest.mocked(api.getMedicationCostIdentity).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(
    () => {
      const access = useMedicationCostsAccess();
      useMedicationPurchases(access.ownerId);
      useMedicationCostAnalytics(access.ownerId, '12');
      useMedicationPurchase(access.ownerId, 'invoice');
      useMedicationPurchaseEditorData(access.ownerId);
      useMedicationVialCosts(access.ownerId);
      return access;
    },
    { wrapper: createQueryWrapper(client) }
  );
  expect(api.listMedicationPurchases).not.toHaveBeenCalled();
  await act(async () => {
    resolve({
      authenticatedUserId: owner,
      activeUserId: other,
      configId: 'server',
      serverUrl: 'https://example.test',
    });
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.ownerId).toBeNull();
  expect(api.listMedicationPurchases).not.toHaveBeenCalled();
  expect(api.getMedicationCostAnalytics).not.toHaveBeenCalled();
  expect(api.getMedicationPurchase).not.toHaveBeenCalled();
  expect(api.getMedicationPurchaseEditorData).not.toHaveBeenCalled();
  expect(api.getMedicationVialCosts).not.toHaveBeenCalled();
  unmount();
  client.clear();
});
test('self identity gates owner-specific queries and cache clear invalidates the old scope even if the same account returns', async () => {
  jest.mocked(api.getMedicationCostIdentity).mockResolvedValue({
    authenticatedUserId: owner,
    activeUserId: owner,
    configId: 'server',
    serverUrl: 'https://example.test',
  });
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(
    () => {
      const access = useMedicationCostsAccess();
      useMedicationPurchases(access.ownerId);
      return access;
    },
    { wrapper: createQueryWrapper(client) }
  );
  await waitFor(() =>
    expect(api.listMedicationPurchases).toHaveBeenCalledWith(
      { ownerId: owner, configId: 'server', serverUrl: 'https://example.test' },
      expect.any(AbortSignal)
    )
  );
  const original = result.current.isCurrent;
  const originalKey = result.current.scopeKey;
  act(() => client.clear());
  expect(original()).toBe(false);
  await waitFor(() => expect(result.current.ownerId).toBe(owner));
  expect(result.current.scopeKey).not.toBe(originalKey);
  expect(original()).toBe(false);
  unmount();
  client.clear();
});
test('a create pending across account clear rejects its old result and cannot submit under a replacement owner', async () => {
  jest.mocked(api.getMedicationCostIdentity).mockResolvedValue({
    authenticatedUserId: owner,
    activeUserId: owner,
    configId: 'server',
    serverUrl: 'https://example.test',
  });
  let resolve!: (v: unknown) => void;
  jest.mocked(api.createMedicationPurchase).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(
    () => {
      const access = useMedicationCostsAccess();
      const mutations = useMedicationPurchaseMutations(
        access.ownerId ?? '',
        access.isCurrent
      );
      return { access, mutations };
    },
    { wrapper: createQueryWrapper(client) }
  );
  await waitFor(() => expect(result.current.access.ownerId).toBe(owner));
  const oldCreate = result.current.mutations.create;
  let pending!: Promise<unknown>;
  act(() => {
    pending = oldCreate
      .mutateAsync({
        expected_owner_id: owner,
        operation_id: owner,
        ordered_date: '2026-11-15',
        items: [
          {
            kind: 'consumable',
            description: 'Example needles',
            quantity: 1,
            unit_cost: '0',
            vial_ids: [],
          },
        ],
      })
      .catch((error) => error);
  });
  await waitFor(() =>
    expect(api.createMedicationPurchase).toHaveBeenCalledTimes(1)
  );
  act(() => client.clear());
  await act(async () => {
    resolve({ id: 'old-result' });
    expect(await pending).toBeInstanceOf(Error);
  });
  expect(result.current.mutations.create.data).toBeUndefined();
  unmount();
  client.clear();
});

test('instance switch with identical owner UUID drops financial data before reloading the other instance', async () => {
  const first = {
      authenticatedUserId: owner,
      activeUserId: owner,
      configId: 'server-a',
      serverUrl: 'https://a.example.test',
    },
    second = {
      ...first,
      configId: 'server-b',
      serverUrl: 'https://b.example.test',
    };
  let resolveIdentity!: (identity: api.MedicationCostIdentity) => void;
  jest
    .mocked(api.getMedicationCostIdentity)
    .mockResolvedValueOnce(first)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveIdentity = done;
        })
    );
  jest
    .mocked(api.listMedicationPurchases)
    .mockImplementation(async (context) => ({
      purchases: [
        {
          id: `invoice-${context.configId}`,
        } as import('@workspace/shared').MedicationPurchaseView,
      ],
    }));
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(
    () => {
      const access = useMedicationCostsAccess();
      const list = useMedicationPurchases(access.ownerId);
      return { ...access, list: list.data };
    },
    { wrapper: createQueryWrapper(client) }
  );
  await waitFor(() =>
    expect(result.current.list?.purchases[0]?.id).toBe('invoice-server-a')
  );
  const oldScope = result.current.isCurrent;
  act(() => client.clear());
  expect(oldScope()).toBe(false);
  expect(result.current.list).toBeUndefined();
  expect(result.current.ownerId).toBeNull();
  await waitFor(() =>
    expect(api.getMedicationCostIdentity).toHaveBeenCalledTimes(2)
  );
  await act(async () => resolveIdentity(second));
  await waitFor(() =>
    expect(result.current.list?.purchases[0]?.id).toBe('invoice-server-b')
  );
  expect(oldScope()).toBe(false);
  unmount();
  client.clear();
});

test('a late report response for12months cannot replace the selected3month window', async () => {
  jest.mocked(api.getMedicationCostIdentity).mockResolvedValue({
    authenticatedUserId: owner,
    activeUserId: owner,
    configId: 'server',
    serverUrl: 'https://example.test',
  });
  let resolveOld!: (
    value: import('@workspace/shared').MedicationCostAnalytics
  ) => void;
  jest
    .mocked(api.getMedicationCostAnalytics)
    .mockImplementation(async (_context, window) =>
      window === '12'
        ? new Promise((done) => {
            resolveOld = done;
          })
        : {
            window: {
              key: window,
              from_date: '2026-01-01',
              to_date: '2026-11-15',
            },
            rows: [],
          }
    );
  const client = createTestQueryClient();
  const { result, rerender, unmount } = renderHook(
    ({
      window,
    }: {
      window: import('@workspace/shared').MedicationCostWindow;
    }) => {
      const access = useMedicationCostsAccess();
      return useMedicationCostAnalytics(access.ownerId, window);
    },
    { initialProps: { window: '12' }, wrapper: createQueryWrapper(client) }
  );
  await waitFor(() =>
    expect(api.getMedicationCostAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: owner }),
      '12',
      expect.any(AbortSignal)
    )
  );
  rerender({ window: '3' });
  await waitFor(() => expect(result.current.data?.window.key).toBe('3'));
  await act(async () =>
    resolveOld({
      window: { key: '12', from_date: '2025-11-15', to_date: '2026-11-15' },
      rows: [],
    })
  );
  expect(result.current.data?.window.key).toBe('3');
  unmount();
  client.clear();
});
