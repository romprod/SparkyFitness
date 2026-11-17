import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  addDays,
  type MedicationCourseTimelineResponse,
} from '@workspace/shared';
import {
  medicationCourseKeys,
  useMedicationCourseTimeline,
} from '@/hooks/Medications/useMedicationCourses';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import { getMedicationCourseTimeline } from '@/api/Medications/courseService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner;
let mockRead = true;
let mockWrite = true;
let mockOpen = true;
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
jest.mock('@/api/Medications/courseService', () => ({
  getMedicationCourseTimeline: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const timeline = jest.mocked(getMedicationCourseTimeline);
const fixture = (
  name = 'Current profile plan'
): MedicationCourseTimelineResponse => ({
  as_of: '2026-11-17T12:34:56.789Z',
  today: '2026-11-17',
  timezone: 'Europe/London',
  window: { start_date: '2026-10-25', end_date: '2027-03-13', days: 140 },
  today_offset: 23,
  week_ticks: Array.from({ length: 20 }, (_, index) => ({
    day: addDays('2026-10-25', index * 7),
    offset: index * 7,
  })),
  overlap: Array.from({ length: 140 }, (_, index) => ({
    day: addDays('2026-10-25', index),
    planned_on: 0,
    projected_on: 0,
  })),
  rows: [
    {
      course_id: courseIds.course,
      revision_id: courseIds.revision,
      revision_no: 1,
      name,
      medication_id: courseIds.med,
      medication_name: 'Example medication',
      timezone: 'Europe/London',
      local_today: '2026-11-17',
      status: 'active',
      bucket: 'active',
      is_current_tip: true,
      medication_active: true,
      version: 1,
      start_date: '2026-11-01',
      end_date: null,
      closed_date: null,
      open_end: true,
      overlap_eligible: true,
      segments: [],
      limitations: [],
    },
  ],
});
let current: ReturnType<typeof useMedicationCourseTimeline>;
function Probe() {
  const state = useMedicationCourseTimeline(mockOpen);
  useEffect(() => {
    current = state;
  }, [state]);
  return <output>{state.data?.rows[0]?.name ?? 'private'}</output>;
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
  mockOpen = true;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  timeline.mockReset().mockResolvedValue(fixture());
});
it('waits for authoritative identity and blocks manual refetch while proof is unresolved', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  setup();
  await act(async () => {
    await current.query.refetch();
  });
  expect(timeline).not.toHaveBeenCalled();
  expect(current.data).toBeUndefined();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await screen.findByText('Current profile plan');
  expect(timeline).toHaveBeenCalledWith(
    courseIds.owner,
    expect.any(AbortSignal)
  );
});
it('does not request or expose timeline data while the dialog is closed, including a manual refetch', async () => {
  mockOpen = false;
  const { tree, rerender } = setup();
  await waitFor(() => expect(current.scope.ready).toBe(true));
  await act(async () => {
    await current.query.refetch();
  });
  expect(timeline).not.toHaveBeenCalled();
  expect(current.data).toBeUndefined();
  mockOpen = true;
  rerender(tree());
  await screen.findByText('Current profile plan');
  expect(timeline).toHaveBeenCalledTimes(1);
  mockOpen = false;
  rerender(tree());
  expect(current.data).toBeUndefined();
  expect(screen.getByText('private')).toBeInTheDocument();
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
  'makes no timeline request after authoritative proof names the $name',
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
    expect(timeline).not.toHaveBeenCalled();
    expect(current.data).toBeUndefined();
  }
);
it('keeps authoritative proof errors private without requesting the timeline', async () => {
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
  expect(timeline).not.toHaveBeenCalled();
  expect(current.data).toBeUndefined();
});
it('does not request even identity when medication read permission is absent', () => {
  mockRead = false;
  mockWrite = false;
  setup();
  expect(identity).not.toHaveBeenCalled();
  expect(timeline).not.toHaveBeenCalled();
});
it('allows a medication-read delegate and binds its proven active profile', async () => {
  mockActive = otherOwner;
  mockWrite = false;
  setup();
  await screen.findByText('Current profile plan');
  expect(current.scope.canWrite).toBe(false);
  expect(timeline).toHaveBeenCalledWith(otherOwner, expect.any(AbortSignal));
});
it('cancels the forwarded request on dialog close and hides a late reply', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationCourseTimeline>>>();
  timeline.mockReturnValue(pending.promise);
  const { tree, rerender } = setup();
  await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
  const signal = timeline.mock.calls[0]![1]!;
  expect(signal.aborted).toBe(false);
  mockOpen = false;
  rerender(tree());
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => pending.resolve(fixture('Late closed-dialog plan')));
  expect(current.data).toBeUndefined();
  expect(screen.queryByText('Late closed-dialog plan')).not.toBeInTheDocument();
});
it('invalidates a same-user prior-profile scope, cancels its request and hides late rows', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationCourseTimeline>>>();
  timeline.mockImplementation((owner) =>
    owner === courseIds.owner
      ? pending.promise
      : Promise.resolve(fixture('New active profile plan'))
  );
  const { tree, rerender } = setup();
  await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
  const retained = current.scope;
  const signal = timeline.mock.calls[0]![1]!;
  const sameUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(sameUser);
  expect(retained.isCurrent()).toBe(false);
  await screen.findByText('New active profile plan');
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(fixture('Old owner rows')));
  expect(screen.getByText('New active profile plan')).toBeInTheDocument();
  expect(screen.queryByText('Old owner rows')).not.toBeInTheDocument();
});
it('fails closed on same-UUID cache clearing and does not display late timeline rows', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationCourseTimeline>>>();
  timeline.mockReturnValue(pending.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
  const retained = current.scope;
  act(() => client.clear());
  expect(retained.isCurrent()).toBe(false);
  await act(async () => pending.resolve(fixture('Cleared-session rows')));
  rerender(tree());
  expect(current.data).toBeUndefined();
  expect(screen.queryByText('Cleared-session rows')).not.toBeInTheDocument();
  expect(timeline).toHaveBeenCalledTimes(1);
});
it('starts a fresh namespace for a new auth generation with the same user UUID', async () => {
  const { tree, rerender } = setup();
  await screen.findByText('Current profile plan');
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
  await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
  expect(current.scope.generation).not.toBe(retained.generation);
});

it('shows same-scope cached timeline immediately on reopen under production cache defaults, then refreshes on course-family invalidation', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300000, refetchOnMount: true },
    },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByText('Current profile plan');
  const retainedKey = current.scope.key;
  expect(timeline).toHaveBeenCalledTimes(1);
  mockOpen = false;
  view.rerender(tree());
  expect(current.data).toBeUndefined();
  expect(screen.getByText('private')).toBeInTheDocument();
  mockOpen = true;
  view.rerender(tree());
  expect(current.scope.key).toBe(retainedKey);
  expect(screen.getByText('Current profile plan')).toBeInTheDocument();
  expect(current.data?.rows[0]?.name).toBe('Current profile plan');
  expect(timeline).toHaveBeenCalledTimes(1);
  timeline.mockResolvedValue(fixture('Updated course-family plan'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: medicationCourseKeys.all });
  });
  await screen.findByText('Updated course-family plan');
  expect(current.data?.rows[0]?.name).toBe('Updated course-family plan');
  expect(timeline).toHaveBeenCalledTimes(2);
});
