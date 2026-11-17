import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type {
  MedicationLogWeekResponse,
  MedicationInjectionRead,
} from '@workspace/shared';
import {
  useMedicationLogWeek,
  useMedicationCalendarInjection,
} from '@/hooks/Medications/useMedicationLogWeek';
import { medicationCourseKeys } from '@/hooks/Medications/useMedicationCourses';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import {
  getMedicationLogWeek,
  getMedicationCalendarInjection,
} from '@/api/Medications/calendarService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner;
let mockRead = true,
  mockReports = false,
  mockWrite = true,
  mockEnabled = true,
  mockEditOpen = false;
let mockWeekStart: string | undefined = '2026-11-16';
let mockInjectionId: string | null | undefined = courseIds.legacy;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockActive,
    hasPermission: (permission: string) =>
      permission === 'reports'
        ? mockReports
        : permission === 'can_manage_medications' && mockRead,
    hasWritePermission: () => mockWrite,
  }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
}));
jest.mock('@/api/Medications/calendarService', () => ({
  getMedicationLogWeek: jest.fn(),
  getMedicationCalendarInjection: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const getWeek = jest.mocked(getMedicationLogWeek);
const getInjection = jest.mocked(getMedicationCalendarInjection);
const week = (
  name = 'Current profile calendar'
): MedicationLogWeekResponse => ({
  as_of: '2026-11-17T12:00:00Z',
  today: '2026-11-17',
  timezone: 'Europe/London',
  week_start: '2026-11-16',
  days: [
    '2026-11-16',
    '2026-11-17',
    '2026-11-18',
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
    '2026-11-22',
  ],
  lanes: [
    {
      id: `medication:${courseIds.med}`,
      medication_id: courseIds.med,
      name,
      is_supplement: false,
    },
  ],
  planned_slots: [],
  actuals: [],
  fulfilled_slots: [],
  coverage: [],
});
const injection = (ownerId = courseIds.owner): MedicationInjectionRead => ({
  id: courseIds.legacy,
  medication_id: courseIds.med,
  user_id: ownerId,
  pen_id: null,
  preparation_id: null,
  injected_at: null,
  entry_date: '2026-11-17',
  site: null,
  administration_route: 'injection',
  dose_mg: null,
  dose_mg_exact: null,
  volume_ml: null,
  syringe_units: null,
  dose_input_unit: null,
  syringe_id: null,
  notes: null,
  source: 'manual',
  custom_fields: {},
  created_at: '2026-11-17T12:00:00Z',
  updated_at: '2026-11-17T12:00:00Z',
  scheduled_for: null,
  course_revision_id: null,
  course_rule_id: null,
  course_step_id: null,
  scheduled_day: null,
  course_slot_key: null,
  course_origin: null,
  medication_name_snapshot: 'Recorded medication',
});
let currentWeek: ReturnType<typeof useMedicationLogWeek>;
let currentInjection: ReturnType<typeof useMedicationCalendarInjection>;
function Probe() {
  const weekly = useMedicationLogWeek(mockWeekStart, mockEnabled);
  const exact = useMedicationCalendarInjection(mockInjectionId, mockEditOpen);
  useEffect(() => {
    currentWeek = weekly;
    currentInjection = exact;
  }, [weekly, exact]);
  return (
    <>
      <output data-testid="week">
        {weekly.data?.lanes[0]?.name ?? 'private'}
      </output>
      <output data-testid="injection">{exact.data?.id ?? 'private'}</output>
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
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockRead = true;
  mockReports = false;
  mockWrite = true;
  mockEnabled = true;
  mockEditOpen = false;
  mockWeekStart = '2026-11-16';
  mockInjectionId = courseIds.legacy;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  getWeek.mockReset().mockResolvedValue(week());
  getInjection.mockReset().mockResolvedValue(injection());
});
it('blocks weekly and selected injection reads including manual refetch until authoritative identity resolves', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  mockEditOpen = true;
  setup();
  await act(async () => {
    await currentWeek.query.refetch();
    await currentInjection.query.refetch();
  });
  expect(getWeek).not.toHaveBeenCalled();
  expect(getInjection).not.toHaveBeenCalled();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await waitFor(() => expect(currentInjection.data?.id).toBe(courseIds.legacy));
  expect(getWeek).toHaveBeenCalledWith(
    courseIds.owner,
    '2026-11-16',
    expect.any(AbortSignal)
  );
  expect(getInjection).toHaveBeenCalledWith(
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
    name: 'wrong profile',
    proof: { authenticatedUserId: courseIds.owner, activeUserId: otherOwner },
  },
])(
  'blocks both private reads when proof names the $name',
  async ({ proof }) => {
    mockEditOpen = true;
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
    expect(getWeek).not.toHaveBeenCalled();
    expect(getInjection).not.toHaveBeenCalled();
  }
);
it('does not read after authoritative identity errors', async () => {
  identity.mockRejectedValue(new Error('Identity unavailable'));
  mockEditOpen = true;
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
  expect(getWeek).not.toHaveBeenCalled();
  expect(getInjection).not.toHaveBeenCalled();
});
it('keeps full correction reads lazy until an actual is selected for Edit', async () => {
  const { tree, rerender } = setup();
  await screen.findByText('Current profile calendar');
  expect(getInjection).not.toHaveBeenCalled();
  mockEditOpen = true;
  rerender(tree());
  await waitFor(() => expect(currentInjection.data?.id).toBe(courseIds.legacy));
  expect(getInjection).toHaveBeenCalledTimes(1);
});
it.each([null, undefined])(
  'blocks disabled/closed manual reads and missing selected injection identity %p',
  async (missingId) => {
    mockEnabled = false;
    mockEditOpen = false;
    const { tree, rerender } = setup();
    await waitFor(() => expect(currentWeek.scope.ready).toBe(true));
    await act(async () => {
      await currentWeek.query.refetch();
      await currentInjection.query.refetch();
    });
    expect(getWeek).not.toHaveBeenCalled();
    expect(getInjection).not.toHaveBeenCalled();
    mockEditOpen = true;
    mockInjectionId = missingId;
    rerender(tree());
    expect(getInjection).not.toHaveBeenCalled();
    expect(currentInjection.data).toBeUndefined();
  }
);
it('allows delegated medication reads without inventing write authority', async () => {
  mockActive = otherOwner;
  mockWrite = false;
  setup();
  await screen.findByText('Current profile calendar');
  expect(getWeek).toHaveBeenCalledWith(
    otherOwner,
    '2026-11-16',
    expect.any(AbortSignal)
  );
  expect(currentWeek.scope.canWrite).toBe(false);
  expect(getInjection).not.toHaveBeenCalled();
});
it('preserves existing reports-read permission but makes no request without either read permission', async () => {
  mockRead = false;
  mockReports = true;
  mockWrite = false;
  const view = setup();
  await screen.findByText('Current profile calendar');
  expect(currentWeek.scope.canWrite).toBe(false);
  view.unmount();
  getWeek.mockClear();
  identity.mockClear();
  mockReports = false;
  setup();
  expect(getWeek).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
});
it.each([{ id: courseIds.step }, { user_id: otherOwner }])(
  'hides a fresh but mismatched exact injection payload %p even when the API mock bypasses validation',
  async (patch) => {
    mockEditOpen = true;
    getInjection.mockResolvedValue({ ...injection(), ...patch });
    setup();
    await waitFor(() => expect(currentInjection.query.isSuccess).toBe(true));
    expect(currentInjection.data).toBeUndefined();
  }
);
it('hides a validly shaped weekly payload for a different requested Monday', async () => {
  mockWeekStart = '2026-11-23';
  setup();
  await waitFor(() => expect(currentWeek.query.isSuccess).toBe(true));
  expect(currentWeek.data).toBeUndefined();
});
it('cancels forwarded signals and hides both late results when their views close', async () => {
  const weekly = deferred<Awaited<ReturnType<typeof getMedicationLogWeek>>>();
  const exact =
    deferred<Awaited<ReturnType<typeof getMedicationCalendarInjection>>>();
  getWeek.mockReturnValue(weekly.promise);
  getInjection.mockReturnValue(exact.promise);
  mockEditOpen = true;
  const { tree, rerender } = setup();
  await waitFor(() => expect(getInjection).toHaveBeenCalledTimes(1));
  const weekSignal = getWeek.mock.calls[0]![2]!;
  const exactSignal = getInjection.mock.calls[0]![2]!;
  mockEnabled = false;
  mockEditOpen = false;
  rerender(tree());
  expect(weekSignal.aborted).toBe(true);
  expect(exactSignal.aborted).toBe(true);
  await act(async () => {
    weekly.resolve(week('Late private calendar'));
    exact.resolve(injection());
  });
  expect(currentWeek.data).toBeUndefined();
  expect(currentInjection.data).toBeUndefined();
});
it('invalidates retained same-user profile scope and discards late old-owner week/detail results', async () => {
  const weekly = deferred<Awaited<ReturnType<typeof getMedicationLogWeek>>>();
  const exact =
    deferred<Awaited<ReturnType<typeof getMedicationCalendarInjection>>>();
  getWeek.mockImplementation((owner) =>
    owner === courseIds.owner
      ? weekly.promise
      : Promise.resolve(week('New active profile'))
  );
  getInjection.mockImplementation((owner) =>
    owner === courseIds.owner
      ? exact.promise
      : Promise.reject(new Error('Not found'))
  );
  mockEditOpen = true;
  const { tree, rerender } = setup();
  await waitFor(() => expect(getInjection).toHaveBeenCalledTimes(1));
  const retained = currentWeek.scope;
  const sameUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(sameUser);
  expect(retained.isCurrent()).toBe(false);
  await screen.findByText('New active profile');
  await act(async () => {
    weekly.resolve(week('Old private calendar'));
    exact.resolve(injection());
  });
  expect(screen.getByText('New active profile')).toBeInTheDocument();
  expect(currentInjection.data).toBeUndefined();
});
it('fails closed after same-UUID cache clearing and blocks retained refetches', async () => {
  const weekly = deferred<Awaited<ReturnType<typeof getMedicationLogWeek>>>();
  getWeek.mockReturnValue(weekly.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(getWeek).toHaveBeenCalledTimes(1));
  const retained = currentWeek.scope;
  act(() => client.clear());
  expect(retained.isCurrent()).toBe(false);
  await act(async () => weekly.resolve(week('Cleared-session calendar')));
  rerender(tree());
  await act(async () => {
    await currentWeek.query.refetch();
  });
  expect(currentWeek.data).toBeUndefined();
  expect(getWeek).toHaveBeenCalledTimes(1);
});
it('never exposes previous-profile placeholder rows while the new profile read is pending', async () => {
  const next = deferred<Awaited<ReturnType<typeof getMedicationLogWeek>>>();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, placeholderData: keepPreviousData },
    },
  });
  const { tree, rerender } = setup(client);
  await screen.findByText('Current profile calendar');
  getWeek.mockReturnValue(next.promise);
  mockActive = otherOwner;
  rerender(tree());
  await waitFor(() =>
    expect(getWeek).toHaveBeenCalledWith(
      otherOwner,
      '2026-11-16',
      expect.any(AbortSignal)
    )
  );
  expect(currentWeek.query.isPlaceholderData).toBe(true);
  expect(currentWeek.data).toBeUndefined();
  await act(async () => next.resolve(week('New proof-owned calendar')));
  await screen.findByText('New proof-owned calendar');
});
it('reuses same-scope readonly week cache but requires a fresh exact injection on every Edit reopen with production cache defaults', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300000, refetchOnMount: true },
    },
  });
  const { tree, rerender } = setup(client);
  await screen.findByText('Current profile calendar');
  mockEnabled = false;
  rerender(tree());
  expect(currentWeek.data).toBeUndefined();
  mockEnabled = true;
  rerender(tree());
  expect(currentWeek.data?.lanes[0]?.name).toBe('Current profile calendar');
  expect(getWeek).toHaveBeenCalledTimes(1);
  mockEditOpen = true;
  rerender(tree());
  await waitFor(() => expect(currentInjection.data?.id).toBe(courseIds.legacy));
  mockEditOpen = false;
  rerender(tree());
  const fresh =
    deferred<Awaited<ReturnType<typeof getMedicationCalendarInjection>>>();
  getInjection.mockReturnValue(fresh.promise);
  mockEditOpen = true;
  rerender(tree());
  await waitFor(() => expect(getInjection).toHaveBeenCalledTimes(2));
  expect(currentInjection.data).toBeUndefined();
  await act(async () =>
    fresh.resolve({ ...injection(), notes: 'Fresh correction read' })
  );
  await waitFor(() =>
    expect(currentInjection.data?.notes).toBe('Fresh correction read')
  );
});
it('does not reuse cached correction data after an exact-read 404 on reopen', async () => {
  mockEditOpen = true;
  const { tree, rerender } = setup();
  await waitFor(() => expect(currentInjection.data?.id).toBe(courseIds.legacy));
  mockEditOpen = false;
  rerender(tree());
  getInjection.mockRejectedValue(
    Object.assign(new Error('Not found'), { status: 404 })
  );
  mockEditOpen = true;
  rerender(tree());
  await waitFor(() => expect(currentInjection.query.isError).toBe(true));
  expect(currentInjection.data).toBeUndefined();
  expect(getInjection).toHaveBeenCalledTimes(2);
});
it('refreshes week reads through the existing course-family mutation invalidation', async () => {
  const { client } = setup();
  await screen.findByText('Current profile calendar');
  getWeek.mockResolvedValue(week('Updated actual calendar'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: medicationCourseKeys.all });
  });
  await screen.findByText('Updated actual calendar');
  expect(getWeek).toHaveBeenCalledTimes(2);
});
