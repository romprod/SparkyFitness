import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { medicationInventoryForecastResponseSchema } from '@workspace/shared';
import {
  useMedicationInventoryForecast,
  useMedicationReorderDefaults,
} from '@/hooks/Medications/useMedicationInventoryForecast';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import {
  getMedicationInventoryForecast,
  getMedicationReorderDefaults,
  saveMedicationReorderDefaults,
} from '@/api/Medications/inventoryForecastService';
import { medicationInventoryKeys } from '@/api/keys/medicationInventory';
import { courseIds } from '@/tests/fixtures/medicationCourses';
import { inventoryForecastFixture } from '@/tests/fixtures/medicationInventoryForecast';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser: { id: string; activeUserId: string } | null;
let mockActive = courseIds.owner;
let mockLoading = false;
let mockRead = true;
let mockWrite = true;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: mockLoading }),
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
jest.mock('@/api/Medications/inventoryForecastService', () => ({
  getMedicationInventoryForecast: jest.fn(),
  getMedicationReorderDefaults: jest.fn(),
  saveMedicationReorderDefaults: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const forecast = jest.mocked(getMedicationInventoryForecast);
const defaults = jest.mocked(getMedicationReorderDefaults);
const saveDefaults = jest.mocked(saveMedicationReorderDefaults);
let currentForecast: ReturnType<typeof useMedicationInventoryForecast>;
let currentDefaults: ReturnType<typeof useMedicationReorderDefaults>;
function Probe() {
  const forecastState = useMedicationInventoryForecast();
  const defaultsState = useMedicationReorderDefaults();
  useEffect(() => {
    currentForecast = forecastState;
    currentDefaults = defaultsState;
  }, [forecastState, defaultsState]);
  return (
    <>
      <output data-testid="forecast">
        {forecastState.scope.ready
          ? (forecastState.data?.medications[0]?.name ?? 'loading')
          : 'private'}
      </output>
      <output data-testid="defaults">
        {defaultsState.scope.ready
          ? defaultsState.data
            ? `${defaultsState.data.lead_days}/${defaultsState.data.buffer_days}`
            : 'loading'
          : 'private'}
      </output>
    </>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
const expectNoPrivateReads = () => {
  expect(forecast).not.toHaveBeenCalled();
  expect(defaults).not.toHaveBeenCalled();
  expect(saveDefaults).not.toHaveBeenCalled();
};
beforeEach(() => {
  // A new auth object is a fresh session generation for the real scope hook.
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockLoading = false;
  mockRead = true;
  mockWrite = true;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser!.id,
    activeUserId: mockActive,
  }));
  forecast.mockReset().mockResolvedValue(inventoryForecastFixture());
  defaults.mockReset().mockResolvedValue({ lead_days: 14, buffer_days: 3 });
  saveDefaults.mockReset().mockImplementation(async (body) => body);
});

it('makes zero forecast/default reads until authoritative actor/profile identity resolves', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  setup();
  expect(screen.getByTestId('forecast')).toHaveTextContent('private');
  expect(screen.getByTestId('defaults')).toHaveTextContent('private');
  expectNoPrivateReads();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('14/3')
  );
  expect(forecast).toHaveBeenCalledWith(
    courseIds.owner,
    expect.any(AbortSignal)
  );
  expect(defaults).toHaveBeenCalledWith(
    courseIds.owner,
    expect.any(AbortSignal)
  );
  expect(screen.getByTestId('forecast')).toHaveTextContent(
    'Example prepared medication'
  );
});
it.each([
  {
    name: 'wrong actor',
    proof: { authenticatedUserId: otherOwner, activeUserId: courseIds.owner },
  },
  {
    name: 'wrong active profile',
    proof: { authenticatedUserId: courseIds.owner, activeUserId: otherOwner },
  },
])(
  'makes zero forecast/default reads when identity confirms $name',
  async ({ proof }) => {
    identity.mockResolvedValue(proof);
    const { client } = setup();
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
    expect(screen.getByTestId('forecast')).toHaveTextContent('private');
    expect(screen.getByTestId('defaults')).toHaveTextContent('private');
    expectNoPrivateReads();
    await expect(
      currentDefaults.save({ lead_days: 0, buffer_days: 0 })
    ).rejects.toThrow('active profile changed');
    expect(saveDefaults).not.toHaveBeenCalled();
  }
);
it('makes zero forecast/default reads after an authoritative identity error', async () => {
  identity.mockRejectedValue(new Error('Identity unavailable'));
  const { client } = setup();
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[0] === 'medication-course-scope' &&
            query.state.status === 'error'
        )
    ).toBe(true)
  );
  expectNoPrivateReads();
  expect(screen.getByTestId('forecast')).toHaveTextContent('private');
  expect(screen.getByTestId('defaults')).toHaveTextContent('private');
});
it.each(['loading', 'signed out', 'without medication read'] as const)(
  'does not request identity or private reads while %s',
  (state) => {
    if (state === 'loading') mockLoading = true;
    if (state === 'signed out') mockUser = null;
    if (state === 'without medication read') {
      mockRead = false;
      mockWrite = false;
    }
    setup();
    expect(identity).not.toHaveBeenCalled();
    expectNoPrivateReads();
  }
);
it('allows a medication-read delegate forecast but blocks all self-only defaults reads and writes', async () => {
  mockActive = otherOwner;
  mockWrite = false;
  setup();
  await waitFor(() =>
    expect(screen.getByTestId('forecast')).toHaveTextContent(
      'Example prepared medication'
    )
  );
  expect(currentForecast.scope.canWrite).toBe(false);
  expect(forecast).toHaveBeenCalledWith(otherOwner, expect.any(AbortSignal));
  expect(defaults).not.toHaveBeenCalled();
  expect(currentDefaults.scope.ready).toBe(false);
  expect(currentDefaults.scope.isCurrent()).toBe(false);
  await expect(
    currentDefaults.save({ lead_days: 0, buffer_days: 0 })
  ).rejects.toThrow('active profile changed');
  expect(saveDefaults).not.toHaveBeenCalled();
});
it('passes the proven self owner to an explicit zero-valued defaults save and updates that owner cache', async () => {
  const { client } = setup();
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('14/3')
  );
  // A background read after save reflects the server result rather than undoing it.
  defaults.mockResolvedValue({ lead_days: 0, buffer_days: 0 });
  await act(async () => {
    await currentDefaults.save({ lead_days: 0, buffer_days: 0 });
  });
  expect(saveDefaults).toHaveBeenCalledWith(
    { lead_days: 0, buffer_days: 0 },
    courseIds.owner
  );
  expect(
    client.getQueryData([
      ...medicationInventoryKeys.all,
      currentDefaults.scope.key,
      'defaults',
    ])
  ).toEqual({ lead_days: 0, buffer_days: 0 });
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('0/0')
  );
});
it('invalidates retained same-user callbacks on profile flip and hides a late older-profile forecast', async () => {
  const oldRead =
    deferred<Awaited<ReturnType<typeof getMedicationInventoryForecast>>>();
  forecast.mockReturnValueOnce(oldRead.promise);
  const newForecast = inventoryForecastFixture();
  newForecast.medications[0]!.name = 'Current delegated forecast';
  forecast.mockResolvedValue(newForecast);
  const { tree, rerender } = setup();
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('14/3')
  );
  const retainedScope = currentForecast.scope;
  const retainedSave = currentDefaults.save;
  expect(retainedScope.isCurrent()).toBe(true);
  const originalUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(originalUser);
  expect(retainedScope.isCurrent()).toBe(false);
  await expect(retainedSave({ lead_days: 0, buffer_days: 0 })).rejects.toThrow(
    'active profile changed'
  );
  await waitFor(() =>
    expect(screen.getByTestId('forecast')).toHaveTextContent(
      'Current delegated forecast'
    )
  );
  const oldForecast = inventoryForecastFixture();
  oldForecast.medications[0]!.name = 'Old owner private forecast';
  await act(async () => oldRead.resolve(oldForecast));
  expect(screen.getByTestId('forecast')).not.toHaveTextContent(
    'Old owner private forecast'
  );
  expect(screen.getByTestId('defaults')).toHaveTextContent('private');
  expect(defaults).toHaveBeenCalledTimes(1);
  expect(saveDefaults).not.toHaveBeenCalled();
});
it('makes the same UUID proof noncurrent after cache clear and discards a late read', async () => {
  const oldRead =
    deferred<Awaited<ReturnType<typeof getMedicationInventoryForecast>>>();
  forecast.mockReturnValueOnce(oldRead.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('14/3')
  );
  const retainedScope = currentForecast.scope;
  const retainedSave = currentDefaults.save;
  const sameUuid = mockUser!.id;
  act(() => client.clear());
  expect(mockUser!.id).toBe(sameUuid);
  expect(retainedScope.isCurrent()).toBe(false);
  await act(async () => oldRead.resolve(inventoryForecastFixture()));
  rerender(tree());
  expect(screen.getByTestId('forecast')).toHaveTextContent('private');
  expect(screen.getByTestId('defaults')).toHaveTextContent('private');
  expect(forecast).toHaveBeenCalledTimes(1);
  expect(defaults).toHaveBeenCalledTimes(1);
  await expect(retainedSave({ lead_days: 0, buffer_days: 0 })).rejects.toThrow(
    'active profile changed'
  );
  expect(saveDefaults).not.toHaveBeenCalled();
});
it('does not reconcile a late previous-self save into the new owner cache or current view', async () => {
  const pendingSave =
    deferred<Awaited<ReturnType<typeof saveMedicationReorderDefaults>>>();
  saveDefaults.mockReturnValue(pendingSave.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('14/3')
  );
  const oldKey = [
    ...medicationInventoryKeys.all,
    currentDefaults.scope.key,
    'defaults',
  ];
  const settled = currentDefaults.save({ lead_days: 0, buffer_days: 0 }).then(
    () => 'unexpected success',
    (error: Error) => error
  );
  await waitFor(() => expect(saveDefaults).toHaveBeenCalledTimes(1));
  mockUser = { id: otherOwner, activeUserId: otherOwner };
  mockActive = otherOwner;
  defaults.mockResolvedValue({ lead_days: 7, buffer_days: 8 });
  const nextForecast = inventoryForecastFixture();
  nextForecast.medications[0]!.name = 'New self forecast';
  forecast.mockResolvedValue(nextForecast);
  rerender(tree());
  await waitFor(() =>
    expect(screen.getByTestId('defaults')).toHaveTextContent('7/8')
  );
  const newKey = [
    ...medicationInventoryKeys.all,
    currentDefaults.scope.key,
    'defaults',
  ];
  expect(newKey).not.toEqual(oldKey);
  await act(async () => pendingSave.resolve({ lead_days: 0, buffer_days: 0 }));
  expect(await settled).toBeInstanceOf(Error);
  expect(client.getQueryData(oldKey)).toEqual({
    lead_days: 14,
    buffer_days: 3,
  });
  expect(client.getQueryData(newKey)).toEqual({ lead_days: 7, buffer_days: 8 });
  expect(screen.getByTestId('defaults')).toHaveTextContent('7/8');
  expect(screen.getByTestId('forecast')).toHaveTextContent('New self forecast');
  expect(saveDefaults).toHaveBeenCalledWith(
    { lead_days: 0, buffer_days: 0 },
    courseIds.owner
  );
});

it('hides a late self-defaults read after switching the same actor to a delegated profile', async () => {
  const pendingDefaults =
    deferred<Awaited<ReturnType<typeof getMedicationReorderDefaults>>>();
  defaults.mockReturnValueOnce(pendingDefaults.promise);
  const { tree, rerender } = setup();
  await waitFor(() =>
    expect(screen.getByTestId('forecast')).toHaveTextContent(
      'Example prepared medication'
    )
  );
  expect(screen.getByTestId('defaults')).toHaveTextContent('loading');
  const retainedScope = currentDefaults.scope;
  mockActive = otherOwner;
  rerender(tree());
  expect(retainedScope.isCurrent()).toBe(false);
  await waitFor(() =>
    expect(forecast).toHaveBeenCalledWith(otherOwner, expect.any(AbortSignal))
  );
  await act(async () =>
    pendingDefaults.resolve({ lead_days: 77, buffer_days: 88 })
  );
  expect(screen.getByTestId('defaults')).toHaveTextContent('private');
  expect(currentDefaults.data).toBeUndefined();
  expect(defaults).toHaveBeenCalledTimes(1);
  expect(saveDefaults).not.toHaveBeenCalled();
});

it('isolates the planned forecast from a fresh old committed cache while preserving the defaults cache key', async () => {
  const plannedRead =
    deferred<Awaited<ReturnType<typeof getMedicationInventoryForecast>>>();
  const defaultsRead =
    deferred<Awaited<ReturnType<typeof getMedicationReorderDefaults>>>();
  forecast.mockReturnValue(plannedRead.promise);
  defaults.mockReturnValue(defaultsRead.promise);
  const { client } = setup();
  const scopeKey = currentForecast.scope.key;
  const old = medicationInventoryForecastResponseSchema.parse(
    inventoryForecastFixture()
  );
  old.medications[0]!.name = 'Old committed cache';
  const oldKey = [...medicationInventoryKeys.all, scopeKey, 'forecast'];
  const defaultKey = [...medicationInventoryKeys.all, scopeKey, 'defaults'];
  act(() => {
    client.setQueryData(oldKey, old);
    client.setQueryData(defaultKey, { lead_days: 20, buffer_days: 0 });
  });
  await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));
  expect(currentForecast.data).toBeUndefined();
  expect(screen.getByTestId('forecast')).not.toHaveTextContent(
    'Old committed cache'
  );
  expect(screen.getByTestId('defaults')).toHaveTextContent('20/0');
  const planned = inventoryForecastFixture();
  planned.medications[0]!.name = 'Planned current response';
  await act(async () => plannedRead.resolve(planned));
  await waitFor(() =>
    expect(screen.getByTestId('forecast')).toHaveTextContent(
      'Planned current response'
    )
  );
  expect(
    client.getQueryData([
      ...medicationInventoryKeys.all,
      scopeKey,
      'forecast',
      'planned_cycles',
    ])
  ).toEqual(planned);
  expect(client.getQueryData(oldKey)).toEqual(old);
  expect(client.getQueryData(defaultKey)).toEqual({
    lead_days: 20,
    buffer_days: 0,
  });
});
it('does not fall back to a committed cache after the planned request fails', async () => {
  forecast.mockRejectedValue(new Error('Planned mode is unavailable'));
  const { client } = setup();
  const old = medicationInventoryForecastResponseSchema.parse(
    inventoryForecastFixture()
  );
  act(() =>
    client.setQueryData(
      [...medicationInventoryKeys.all, currentForecast.scope.key, 'forecast'],
      old
    )
  );
  await waitFor(() => expect(currentForecast.query.isError).toBe(true));
  expect(currentForecast.data).toBeUndefined();
  expect(forecast).toHaveBeenCalledTimes(1);
});
