import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type { MedicationPrescription } from '@workspace/shared';
import {
  useMedicationPrescriptions,
  useMedicationPrescription,
  useMedicationPrescriptionActions,
} from '@/hooks/Medications/useMedicationPrescriptions';
import { medicationCourseKeys } from '@/hooks/Medications/useMedicationCourses';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import * as api from '@/api/Medications/prescriptionService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner,
  mockLoading = false,
  mockRead = true,
  mockWrite = true,
  mockEnabled = true,
  mockDetailEnabled = false;
let mockId: string | null = courseIds.legacy;
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
jest.mock('@/api/Medications/prescriptionService', () => ({
  listMedicationPrescriptions: jest.fn(),
  getMedicationPrescription: jest.fn(),
  createMedicationPrescription: jest.fn(),
  updateMedicationPrescription: jest.fn(),
  deleteMedicationPrescription: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const list = jest.mocked(api.listMedicationPrescriptions),
  detail = jest.mocked(api.getMedicationPrescription),
  create = jest.mocked(api.createMedicationPrescription),
  update = jest.mocked(api.updateMedicationPrescription),
  remove = jest.mocked(api.deleteMedicationPrescription);
const row = (
  ownerId = courseIds.owner,
  name = 'Private self record'
): MedicationPrescription => ({
  id: courseIds.legacy,
  user_id: ownerId,
  medication_id: courseIds.med,
  medication_name: name,
  source: null,
  prescriber: null,
  pharmacy: null,
  dose_instructions: null,
  cost: '0',
  currency: 'AUD',
  quantity: 0,
  refills_authorized: null,
  refills_remaining: 0,
  date_written: null,
  next_refill: null,
  expiration: null,
  lead_time_days: 0,
  status: 'active',
  version: 1,
  created_at: '2026-11-17T12:00:00Z',
  updated_at: '2026-11-17T12:00:00Z',
});
const createBody = {
  operation_id: courseIds.step,
  medication_id: courseIds.med,
};
const changeBody = { operation_id: courseIds.step, expected_version: 1 };
const receipt = { id: courseIds.legacy, version: 1, deleted: false };
let current: ReturnType<typeof useMedicationPrescriptions>;
let currentDetail: ReturnType<typeof useMedicationPrescription>;
let actions: ReturnType<typeof useMedicationPrescriptionActions>;
function Probe() {
  const state = useMedicationPrescriptions(mockEnabled);
  const exact = useMedicationPrescription(mockId, mockDetailEnabled);
  const commands = useMedicationPrescriptionActions(state.scope);
  useEffect(() => {
    current = state;
    currentDetail = exact;
    actions = commands;
  }, [state, exact, commands]);
  return (
    <>
      <output data-testid="list">
        {state.data
          ? (state.data.prescriptions[0]?.medication_name ?? 'empty')
          : 'private'}
      </output>
      <output data-testid="detail">
        {exact.data?.prescription.medication_name ?? 'private'}
      </output>
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
const noWrites = () => {
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
};
const noRx = () => {
  expect(list).not.toHaveBeenCalled();
  expect(detail).not.toHaveBeenCalled();
  noWrites();
};
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockLoading = false;
  mockRead = true;
  mockWrite = true;
  mockEnabled = true;
  mockDetailEnabled = false;
  mockId = courseIds.legacy;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  list.mockReset().mockResolvedValue({ prescriptions: [row()] });
  detail.mockReset().mockResolvedValue({ prescription: row() });
  create.mockReset().mockResolvedValue(receipt);
  update.mockReset().mockResolvedValue({ ...receipt, version: 2 });
  remove
    .mockReset()
    .mockResolvedValue({ ...receipt, version: null, deleted: true });
});
it('makes zero Rx requests including retained/manual reads and writes while authoritative self proof is unresolved', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  mockDetailEnabled = true;
  setup();
  await act(async () => {
    await current.query.refetch();
    await currentDetail.query.refetch();
  });
  await expect(actions.create(createBody)).rejects.toThrow(
    'active profile changed'
  );
  noRx();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() =>
    expect(currentDetail.data?.prescription.id).toBe(courseIds.legacy)
  );
  expect(current.scope.ready).toBe(true);
  expect(current.scope.key).toBeTruthy();
  expect(current.scope.ownerId).toBe(courseIds.owner);
  expect(list).toHaveBeenCalledWith(courseIds.owner, expect.any(AbortSignal));
  expect(detail).toHaveBeenCalledWith(
    courseIds.owner,
    courseIds.legacy,
    expect.any(AbortSignal)
  );
});
it.each([
  {
    name: 'wrong actor',
    proof: { authenticatedUserId: otherOwner, activeUserId: courseIds.owner },
  },
  {
    name: 'ambiguous self fallback',
    proof: { authenticatedUserId: courseIds.owner, activeUserId: otherOwner },
  },
])(
  'blocks all Rx endpoints after authoritative $name proof',
  async ({ proof }) => {
    identity.mockResolvedValue(proof);
    mockDetailEnabled = true;
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
    await expect(actions.update(courseIds.legacy, changeBody)).rejects.toThrow(
      'active profile changed'
    );
    await expect(actions.remove(courseIds.legacy, changeBody)).rejects.toThrow(
      'active profile changed'
    );
    noRx();
  }
);
it('rejects all Rx requests in a delegated profile despite medication read/write permission', async () => {
  mockActive = otherOwner;
  mockDetailEnabled = true;
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
  expect(current.scope.ready).toBe(false);
  expect(current.scope.isCurrent()).toBe(false);
  expect(current.scope.canWrite).toBe(false);
  await act(async () => {
    await current.query.refetch();
    await currentDetail.query.refetch();
  });
  await expect(actions.create(createBody)).rejects.toThrow(
    'active profile changed'
  );
  noRx();
});
it('makes no Rx requests after identity errors', async () => {
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
  noRx();
});
it.each(['auth loading', 'without read permission'] as const)(
  'does not even request proof while %s',
  (state) => {
    if (state === 'auth loading') mockLoading = true;
    else {
      mockRead = false;
      mockWrite = false;
    }
    setup();
    expect(identity).not.toHaveBeenCalled();
    noRx();
  }
);
it('allows a read-only self record view but rejects every write', async () => {
  mockWrite = false;
  setup();
  await screen.findByText('Private self record');
  expect(current.scope.canWrite).toBe(false);
  await expect(actions.create(createBody)).rejects.toThrow(
    'active profile changed'
  );
  await expect(actions.update(courseIds.legacy, changeBody)).rejects.toThrow(
    'active profile changed'
  );
  await expect(actions.remove(courseIds.legacy, changeBody)).rejects.toThrow(
    'active profile changed'
  );
  noWrites();
});
it('retains exact raw create/update retry bodies and operation identity in guarded calls', async () => {
  setup();
  await screen.findByText('Private self record');
  const raw = { ...createBody, cost: '0.0000', quantity: '0' };
  await act(async () => {
    await actions.create(raw);
    await actions.create(raw);
    await actions.update(courseIds.legacy, changeBody);
  });
  expect(create).toHaveBeenNthCalledWith(1, courseIds.owner, raw);
  expect(create).toHaveBeenNthCalledWith(2, courseIds.owner, raw);
  expect(create.mock.calls[0]![1]).toBe(raw);
  expect(create.mock.calls[1]![1]).toBe(raw);
  expect(update).toHaveBeenCalledWith(
    courseIds.owner,
    courseIds.legacy,
    changeBody
  );
});
it('refreshes Rx, pens and course link families after delete without touching physical cached values or identity proof', async () => {
  const { client } = setup();
  await screen.findByText('Private self record');
  const physical = { remainingMg: 10, volumeMl: 2 };
  client.setQueryData(['medication-pens', courseIds.med], physical);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  list.mockResolvedValue({ prescriptions: [] });
  await act(async () => {
    await actions.remove(courseIds.legacy, changeBody);
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['medication-prescriptions'],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['medication-pens'] });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: medicationCourseKeys.all,
  });
  expect(client.getQueryData(['medication-pens', courseIds.med])).toEqual(
    physical
  );
  expect(identity).toHaveBeenCalledTimes(1);
  await screen.findByText('empty');
});
it('does not retry or invalidate/refetch automatically after a stale CAS response', async () => {
  const conflict = Object.assign(new Error('Stale version'), { status: 409 });
  update.mockRejectedValue(conflict);
  const { client } = setup();
  await screen.findByText('Private self record');
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await expect(actions.update(courseIds.legacy, changeBody)).rejects.toBe(
    conflict
  );
  expect(update).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
});
it('cancels disabled private reads and hides late responses', async () => {
  const pendingList =
    deferred<Awaited<ReturnType<typeof api.listMedicationPrescriptions>>>();
  const pendingDetail =
    deferred<Awaited<ReturnType<typeof api.getMedicationPrescription>>>();
  list.mockReturnValue(pendingList.promise);
  detail.mockReturnValue(pendingDetail.promise);
  mockDetailEnabled = true;
  const { tree, rerender } = setup();
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(1));
  const signal = list.mock.calls[0]![1]!;
  const exactSignal = detail.mock.calls[0]![2]!;
  mockEnabled = false;
  mockDetailEnabled = false;
  rerender(tree());
  expect(signal.aborted).toBe(true);
  expect(exactSignal.aborted).toBe(true);
  await act(async () => {
    pendingList.resolve({ prescriptions: [row()] });
    pendingDetail.resolve({ prescription: row() });
  });
  expect(current.data).toBeUndefined();
  expect(currentDetail.data).toBeUndefined();
});
it('invalidates retained callbacks and hides late Rx rows when the same user switches to a delegate profile', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof api.listMedicationPrescriptions>>>();
  list.mockReturnValue(pending.promise);
  const { tree, rerender } = setup();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  const retained = current.scope,
    oldActions = actions,
    sameUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(sameUser);
  expect(retained.isCurrent()).toBe(false);
  await expect(oldActions.create(createBody)).rejects.toThrow(
    'active profile changed'
  );
  await act(async () => pending.resolve({ prescriptions: [row()] }));
  expect(current.data).toBeUndefined();
  expect(screen.getByTestId('list')).toHaveTextContent('private');
  expect(list).toHaveBeenCalledTimes(1);
  noWrites();
});
it('does not reconcile a late self mutation result into a switched-profile view or invalidate its caches', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof api.createMedicationPrescription>>>();
  create.mockReturnValue(pending.promise);
  const { client, tree, rerender } = setup();
  await screen.findByText('Private self record');
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const settled = actions.create(createBody).then(
    () => 'unexpected success',
    (error: Error) => error
  );
  mockActive = otherOwner;
  rerender(tree());
  await act(async () => pending.resolve(receipt));
  expect(await settled).toBeInstanceOf(Error);
  expect(invalidate).not.toHaveBeenCalled();
  expect(current.data).toBeUndefined();
});
it('fails closed after same-UUID cache clearing without starting another Rx request', async () => {
  const { client, tree, rerender } = setup();
  await screen.findByText('Private self record');
  const retained = current.scope,
    oldActions = actions;
  act(() => client.clear());
  expect(retained.isCurrent()).toBe(false);
  rerender(tree());
  await act(async () => {
    await current.query.refetch();
  });
  await expect(oldActions.remove(courseIds.legacy, changeBody)).rejects.toThrow(
    'active profile changed'
  );
  expect(current.data).toBeUndefined();
  expect(list).toHaveBeenCalledTimes(1);
  noWrites();
});
it('uses a new generation for a new same-UUID session without exposing previous-session records', async () => {
  const { tree, rerender } = setup();
  await screen.findByText('Private self record');
  const retained = current.scope;
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  rerender(tree());
  expect(retained.isCurrent()).toBe(false);
  expect(current.data).toBeUndefined();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(current.scope.generation).not.toBe(retained.generation);
});
it('does not expose another owner or wrong-ID record even if an API mock bypasses validation', async () => {
  list.mockResolvedValue({ prescriptions: [row(otherOwner)] });
  detail.mockResolvedValue({ prescription: { ...row(), id: courseIds.step } });
  mockDetailEnabled = true;
  setup();
  await waitFor(() => expect(currentDetail.query.isSuccess).toBe(true));
  expect(current.data).toBeUndefined();
  expect(currentDetail.data).toBeUndefined();
});
it('withholds previous-generation placeholder records while a fresh self read is pending', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, placeholderData: keepPreviousData },
    },
  });
  const { tree, rerender } = setup(client);
  await screen.findByText('Private self record');
  const next =
    deferred<Awaited<ReturnType<typeof api.listMedicationPrescriptions>>>();
  list.mockReturnValue(next.promise);
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  rerender(tree());
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(current.query.isPlaceholderData).toBe(true);
  expect(current.data).toBeUndefined();
  await act(async () =>
    next.resolve({
      prescriptions: [row(courseIds.owner, 'Fresh session record')],
    })
  );
  await screen.findByText('Fresh session record');
});
it('provides fresh exact detail on explicit reload and never substitutes cached stale detail after an error', async () => {
  mockDetailEnabled = true;
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300000, refetchOnMount: true },
    },
  });
  const { tree, rerender } = setup(client);
  await waitFor(() => expect(currentDetail.data?.prescription.version).toBe(1));
  mockDetailEnabled = false;
  rerender(tree());
  const pending =
    deferred<Awaited<ReturnType<typeof api.getMedicationPrescription>>>();
  detail.mockReturnValue(pending.promise);
  mockDetailEnabled = true;
  rerender(tree());
  await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
  expect(currentDetail.data).toBeUndefined();
  await act(async () =>
    pending.resolve({ prescription: { ...row(), version: 2 } })
  );
  await waitFor(() => expect(currentDetail.data?.prescription.version).toBe(2));
  mockDetailEnabled = false;
  rerender(tree());
  detail.mockRejectedValue(new Error('Not found'));
  mockDetailEnabled = true;
  rerender(tree());
  await waitFor(() => expect(currentDetail.query.isError).toBe(true));
  expect(currentDetail.data).toBeUndefined();
});

it.each(['create', 'update', 'remove'] as const)(
  'reprices derived estimate caches after successful owner-current Rx %s without invalidating financial identity',
  async (command) => {
    const { client } = setup();
    await screen.findByText('Private self record');
    const proofKey = ['medication-purchases', courseIds.owner, 'identity', 1];
    const estimateKey = [
      'medication-purchases',
      courseIds.owner,
      'analytics',
      '12',
      'with_prescription_estimates',
      1,
    ];
    const vialKey = [
      'medication-purchases',
      courseIds.owner,
      'vials',
      'with_prescription_estimates',
      1,
    ];
    client.setQueryData(proofKey, {
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    });
    client.setQueryData(estimateKey, {
      capturedEstimate: 'unchanged until read',
    });
    client.setQueryData(vialKey, { capturedRate: 'unchanged until read' });
    await act(async () => {
      if (command === 'create') await actions.create(createBody);
      if (command === 'update')
        await actions.update(courseIds.legacy, changeBody);
      if (command === 'remove')
        await actions.remove(courseIds.legacy, changeBody);
    });
    expect(client.getQueryState(estimateKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(vialKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(proofKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData(vialKey)).toEqual({
      capturedRate: 'unchanged until read',
    });
  }
);
