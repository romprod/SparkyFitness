import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type {
  MedicationPrescriptionCostAnalytics,
  MedicationPrescriptionVialCosts,
} from '@workspace/shared';
import {
  medicationPurchaseKeys,
  useMedicationPurchaseScope,
  useMedicationCostAnalytics,
  useMedicationVialCosts,
} from '@/hooks/useMedicationPurchases';
import * as api from '@/api/Medications/purchaseService';
import { emptyCostBreakdown } from '@/tests/fixtures/medicationCostBreakdown';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockLoading = false,
  mockEnabled = true;
let mockRequestedOwner: string | undefined;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
  getMedicationCostAnalyticsWithPrescriptionEstimates: jest.fn(),
  getMedicationVialCostsWithPrescriptionEstimates: jest.fn(),
  getMedicationCostAnalytics: jest.fn(),
  getMedicationVialCosts: jest.fn(),
}));
const identity = jest.mocked(api.getMedicationPurchaseIdentity);
const analytics = jest.mocked(
  api.getMedicationCostAnalyticsWithPrescriptionEstimates
);
const vials = jest.mocked(api.getMedicationVialCostsWithPrescriptionEstimates);
const report = (): MedicationPrescriptionCostAnalytics => ({
  ...emptyCostBreakdown,
  waste: { ...emptyCostBreakdown.waste, rows: [] },
  window: { key: '12', from_date: '2025-11-17', to_date: '2026-11-17' },
  rows: [],
  cost_basis: 'with_prescription_estimates',
  accounted: [],
});
const prices = (): MedicationPrescriptionVialCosts => ({
  cost_basis: 'with_prescription_estimates',
  vials: [],
});
let scope: ReturnType<typeof useMedicationPurchaseScope>;
let current: ReturnType<typeof useMedicationCostAnalytics>;
let currentVials: ReturnType<typeof useMedicationVialCosts>;
function Probe() {
  const proof = useMedicationPurchaseScope();
  const results = useMedicationCostAnalytics(
    mockRequestedOwner ?? proof.ownerId,
    '12',
    mockEnabled
  );
  const stock = useMedicationVialCosts(
    mockRequestedOwner ?? proof.ownerId,
    mockEnabled
  );
  useEffect(() => {
    scope = proof;
    current = results;
    currentVials = stock;
  }, [proof, results, stock]);
  return (
    <>
      <output data-testid="analytics">
        {results.data?.cost_basis ?? 'private'}
      </output>
      <output data-testid="vials">{stock.data?.cost_basis ?? 'private'}</output>
    </>
  );
}
function setup(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
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
const noFallback = () => {
  expect(api.getMedicationCostAnalytics).not.toHaveBeenCalled();
  expect(api.getMedicationVialCosts).not.toHaveBeenCalled();
};
const noFinancialReads = () => {
  expect(analytics).not.toHaveBeenCalled();
  expect(vials).not.toHaveBeenCalled();
  noFallback();
};
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockLoading = false;
  mockEnabled = true;
  mockRequestedOwner = undefined;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockUser.activeUserId,
  }));
  analytics.mockReset().mockResolvedValue(report());
  vials.mockReset().mockResolvedValue(prices());
  jest.mocked(api.getMedicationCostAnalytics).mockReset();
  jest.mocked(api.getMedicationVialCosts).mockReset();
});
it('waits for fresh authoritative self proof and blocks manual reads until it resolves', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof api.getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  setup();
  await act(async () => {
    await current.refetch();
    await currentVials.refetch();
  });
  noFinancialReads();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() =>
    expect(currentVials.data?.cost_basis).toBe('with_prescription_estimates')
  );
  expect(analytics).toHaveBeenCalledWith(
    courseIds.owner,
    '12',
    expect.any(AbortSignal)
  );
  expect(vials).toHaveBeenCalledWith(courseIds.owner, expect.any(AbortSignal));
  noFallback();
});
it('makes zero identity/financial requests when already delegated', () => {
  mockUser.activeUserId = otherOwner;
  setup();
  expect(identity).not.toHaveBeenCalled();
  noFinancialReads();
});
it.each([
  {
    name: 'wrong authenticated actor',
    proof: { authenticatedUserId: otherOwner, activeUserId: courseIds.owner },
  },
  {
    name: 'self-looking delegated fallback',
    proof: { authenticatedUserId: courseIds.owner, activeUserId: otherOwner },
  },
])('does not price data when proof names $name', async ({ proof }) => {
  identity.mockResolvedValue(proof);
  const { client } = setup();
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[2] === 'identity' && query.state.status === 'success'
        )
    ).toBe(true)
  );
  noFinancialReads();
});
it('makes no financial reads after proof errors', async () => {
  identity.mockRejectedValue(new Error('Identity unavailable'));
  const { client } = setup();
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[2] === 'identity' && query.state.status === 'error'
        )
    ).toBe(true)
  );
  noFinancialReads();
});
it('blocks a caller-supplied different owner even when self proof is valid', async () => {
  mockRequestedOwner = otherOwner;
  setup();
  await waitFor(() => expect(scope.ready).toBe(true));
  await act(async () => {
    await current.refetch();
    await currentVials.refetch();
  });
  noFinancialReads();
});
it('isolates invoice-only analytics/vial caches from the expanded mode while preserving old cached data', async () => {
  const pending =
    deferred<
      Awaited<
        ReturnType<
          typeof api.getMedicationCostAnalyticsWithPrescriptionEstimates
        >
      >
    >();
  const pendingVials =
    deferred<
      Awaited<
        ReturnType<typeof api.getMedicationVialCostsWithPrescriptionEstimates>
      >
    >();
  analytics.mockReturnValue(pending.promise);
  vials.mockReturnValue(pendingVials.promise);
  const { client } = setup();
  const legacy = { ...emptyCostBreakdown, window: report().window, rows: [] },
    oldVials = { vials: [] };
  act(() => {
    client.setQueryData(
      medicationPurchaseKeys.analytics(courseIds.owner, '12'),
      legacy
    );
    client.setQueryData(
      medicationPurchaseKeys.vials(courseIds.owner),
      oldVials
    );
  });
  await waitFor(() => expect(analytics).toHaveBeenCalledTimes(1));
  expect(current.data).toBeUndefined();
  expect(currentVials.data).toBeUndefined();
  await act(async () => {
    pending.resolve(report());
    pendingVials.resolve(prices());
  });
  await waitFor(() =>
    expect(current.data?.cost_basis).toBe('with_prescription_estimates')
  );
  expect(
    client.getQueryData(
      medicationPurchaseKeys.analyticsWithPrescriptionEstimates(
        courseIds.owner,
        '12',
        scope.generation
      )
    )
  ).toEqual(report());
  expect(
    client.getQueryData(
      medicationPurchaseKeys.vialsWithPrescriptionEstimates(
        courseIds.owner,
        scope.generation
      )
    )
  ).toEqual(prices());
  expect(
    client.getQueryData(medicationPurchaseKeys.analytics(courseIds.owner, '12'))
  ).toEqual(legacy);
  noFallback();
});
it('does not substitute a committed cache after an opted read fails', async () => {
  analytics.mockRejectedValue(new Error('Echo missing'));
  vials.mockRejectedValue(new Error('Echo missing'));
  const { client } = setup();
  act(() => {
    client.setQueryData(
      medicationPurchaseKeys.analytics(courseIds.owner, '12'),
      { invoiceOnly: true }
    );
    client.setQueryData(medicationPurchaseKeys.vials(courseIds.owner), {
      invoiceOnly: true,
    });
  });
  await waitFor(() => expect(currentVials.isError).toBe(true));
  expect(current.data).toBeUndefined();
  expect(currentVials.data).toBeUndefined();
  noFallback();
});
it('cancels both opted requests and hides late results after a same-object switch away from self', async () => {
  const pending =
    deferred<
      Awaited<
        ReturnType<
          typeof api.getMedicationCostAnalyticsWithPrescriptionEstimates
        >
      >
    >();
  const pendingVials =
    deferred<
      Awaited<
        ReturnType<typeof api.getMedicationVialCostsWithPrescriptionEstimates>
      >
    >();
  analytics.mockReturnValue(pending.promise);
  vials.mockReturnValue(pendingVials.promise);
  const { tree, rerender } = setup();
  await waitFor(() => expect(vials).toHaveBeenCalledTimes(1));
  const retained = scope,
    signal = analytics.mock.calls[0]![2]!,
    vialSignal = vials.mock.calls[0]![1]!;
  mockUser.activeUserId = otherOwner;
  rerender(tree());
  expect(retained.isCurrent()).toBe(false);
  expect(signal.aborted).toBe(true);
  expect(vialSignal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(report());
    pendingVials.resolve(prices());
  });
  expect(current.data).toBeUndefined();
  expect(currentVials.data).toBeUndefined();
  expect(analytics).toHaveBeenCalledTimes(1);
  noFallback();
});
it('fails closed on same-UUID cache clearing and rejects retained manual refetches', async () => {
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(currentVials.data).toBeDefined());
  const retained = scope;
  act(() => client.clear());
  expect(retained.isCurrent()).toBe(false);
  rerender(tree());
  await act(async () => {
    await current.refetch();
    await currentVials.refetch();
  });
  expect(current.data).toBeUndefined();
  expect(currentVials.data).toBeUndefined();
  expect(analytics).toHaveBeenCalledTimes(1);
  expect(vials).toHaveBeenCalledTimes(1);
});
it('uses a fresh generation namespace and masks previous-session placeholders for a new same-UUID auth object', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, placeholderData: keepPreviousData },
    },
  });
  const { tree, rerender } = setup(client);
  await waitFor(() => expect(currentVials.data).toBeDefined());
  const retained = scope;
  const pending =
    deferred<
      Awaited<
        ReturnType<
          typeof api.getMedicationCostAnalyticsWithPrescriptionEstimates
        >
      >
    >();
  const pendingVials =
    deferred<
      Awaited<
        ReturnType<typeof api.getMedicationVialCostsWithPrescriptionEstimates>
      >
    >();
  analytics.mockReturnValue(pending.promise);
  vials.mockReturnValue(pendingVials.promise);
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  rerender(tree());
  expect(retained.isCurrent()).toBe(false);
  await waitFor(() => expect(vials).toHaveBeenCalledTimes(2));
  expect(scope.generation).not.toBe(retained.generation);
  expect(current.data).toBeUndefined();
  expect(currentVials.data).toBeUndefined();
  await act(async () => {
    pending.resolve(report());
    pendingVials.resolve(prices());
  });
  await waitFor(() => expect(currentVials.data).toBeDefined());
});
