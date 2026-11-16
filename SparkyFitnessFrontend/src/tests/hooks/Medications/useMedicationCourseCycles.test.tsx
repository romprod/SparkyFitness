import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  medicationCourseCycleStateSchema,
  medicationCourseCycleReviewSchema,
  medicationCourseCycleMutationResultSchema,
} from '@workspace/shared';
import {
  useMedicationCourseCycle,
  useMedicationCourseActions,
} from '@/hooks/Medications/useMedicationCourses';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
import {
  getMedicationCourseCycle,
  reviewMedicationCourseCycle,
  endMedicationCourseCycle,
  startMedicationCourseCycle,
} from '@/api/Medications/courseService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

const otherOwner = '00000000-0000-4000-8000-000000000099';
let mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
let mockActive = courseIds.owner;
let mockRead = true;
let mockWrite = true;
let mockEnabled = true;
let mockCourseId = courseIds.course;
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
  getMedicationCourseCycle: jest.fn(),
  reviewMedicationCourseCycle: jest.fn(),
  endMedicationCourseCycle: jest.fn(),
  startMedicationCourseCycle: jest.fn(),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const getCycle = jest.mocked(getMedicationCourseCycle);
const reviewCycle = jest.mocked(reviewMedicationCourseCycle);
const endCycle = jest.mocked(endMedicationCourseCycle);
const startCycle = jest.mocked(startMedicationCourseCycle);
const state = medicationCourseCycleStateSchema.parse({
  course_id: courseIds.course,
  revision_id: courseIds.revision,
  version: 3,
  timezone: 'Europe/London',
  today: '2026-11-16',
  original_start_date: '2026-11-01',
  on_weeks: 2,
  off_weeks: null,
  anchor_date: '2026-11-01',
  phase: 'ended',
  planned_stop_date: '2026-11-14',
  next_restart_date: null,
  end_cycle: { allowed: true, reasons: [] },
  start_next_cycle: { allowed: false, reasons: [] },
  advisory: true,
});
const review = medicationCourseCycleReviewSchema.parse({
  action: 'end',
  cycle: state,
  effective_day: '2026-11-16',
  candidate_end_date: '2026-11-14',
  new_start_date: null,
  new_end_date: null,
  first_due: null,
  phase_continuity: 'retained',
  can_commit: true,
  conflicts: [],
  review_fingerprint: 'review-1',
});
const ended = medicationCourseCycleMutationResultSchema.parse({
  course_id: courseIds.course,
  revision_id: courseIds.revision,
  version: 4,
  operation_id: courseIds.legacy,
  action: 'end',
  effective_day: '2026-11-16',
  activated_at: null,
  boundary_audit: {
    at: '2026-11-16T13:14:15.123Z',
    timezone: 'Europe/London',
    before: {
      revision_id: courseIds.revision,
      status: 'active',
      start_date: '2026-11-01',
      end_date: null,
      weekly_anchor_date: '2026-11-01',
    },
    after: {
      revision_id: courseIds.revision,
      status: 'completed',
      start_date: '2026-11-01',
      end_date: '2026-11-14',
      weekly_anchor_date: '2026-11-01',
    },
  },
});
const body = {
  operation_id: courseIds.legacy,
  expected_version: 3,
  review_fingerprint: 'review-1',
};
let current: ReturnType<typeof useMedicationCourseCycle>;
let actions: ReturnType<typeof useMedicationCourseActions>;
function Probe() {
  const value = useMedicationCourseCycle(mockCourseId, mockEnabled);
  const commands = useMedicationCourseActions(value.scope);
  useEffect(() => {
    current = value;
    actions = commands;
  }, [value, commands]);
  return (
    <output>
      {!value.scope.ready ? 'private' : (value.data?.phase ?? 'waiting')}
    </output>
  );
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
const expectNoCommands = () => {
  expect(reviewCycle).not.toHaveBeenCalled();
  expect(endCycle).not.toHaveBeenCalled();
  expect(startCycle).not.toHaveBeenCalled();
};
beforeEach(() => {
  mockUser = { id: courseIds.owner, activeUserId: courseIds.owner };
  mockActive = courseIds.owner;
  mockRead = true;
  mockWrite = true;
  mockEnabled = true;
  mockCourseId = courseIds.course;
  identity.mockReset().mockImplementation(async () => ({
    authenticatedUserId: mockUser.id,
    activeUserId: mockActive,
  }));
  getCycle.mockReset().mockResolvedValue(state);
  reviewCycle.mockReset().mockResolvedValue(review);
  endCycle.mockReset().mockResolvedValue(ended);
  startCycle.mockReset().mockResolvedValue({
    ...ended,
    action: 'start',
    activated_at: '2026-11-16T13:14:15.123Z',
  });
});

it('waits for authoritative actor/profile identity before cycle reads and blocks commands while unresolved', async () => {
  const proof =
    deferred<Awaited<ReturnType<typeof getMedicationPurchaseIdentity>>>();
  identity.mockReturnValue(proof.promise);
  setup();
  expect(getCycle).not.toHaveBeenCalled();
  // A retained/manual refetch must not bypass the disabled query's proof gate.
  await act(async () => {
    await current.query.refetch();
  });
  expect(getCycle).not.toHaveBeenCalled();
  await expect(actions.cycleEnd(courseIds.course, body)).rejects.toThrow(
    'active profile changed'
  );
  expectNoCommands();
  await act(async () =>
    proof.resolve({
      authenticatedUserId: courseIds.owner,
      activeUserId: courseIds.owner,
    })
  );
  await screen.findByText('ended');
  expect(getCycle).toHaveBeenCalledWith(
    courseIds.course,
    expect.any(AbortSignal)
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
  'blocks cycle reads/actions after proof names the $name',
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
    expect(getCycle).not.toHaveBeenCalled();
    await expect(
      actions.cycleReview(courseIds.course, {
        action: 'end',
        expected_version: 3,
      })
    ).rejects.toThrow('active profile changed');
    await expect(actions.cycleStart(courseIds.course, body)).rejects.toThrow(
      'active profile changed'
    );
    expectNoCommands();
  }
);
it('keeps proof errors private without requesting cycle state', async () => {
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
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(getCycle).not.toHaveBeenCalled();
  expectNoCommands();
});
it.each(['disabled', 'missing course'] as const)(
  'does not read or manufacture state for a %s view',
  async (mode) => {
    if (mode === 'disabled') mockEnabled = false;
    else mockCourseId = '';
    setup();
    await waitFor(() => expect(current.scope.ready).toBe(true));
    expect(getCycle).not.toHaveBeenCalled();
    expect(current.data).toBeUndefined();
    expectNoCommands();
  }
);
it('allows delegated medication reads but prevents all cycle review/commit commands without write authority', async () => {
  mockActive = otherOwner;
  mockWrite = false;
  setup();
  await screen.findByText('ended');
  expect(current.scope.canWrite).toBe(false);
  await expect(
    actions.cycleReview(courseIds.course, {
      action: 'end',
      expected_version: 3,
    })
  ).rejects.toThrow('active profile changed');
  await expect(actions.cycleEnd(courseIds.course, body)).rejects.toThrow(
    'active profile changed'
  );
  await expect(actions.cycleStart(courseIds.course, body)).rejects.toThrow(
    'active profile changed'
  );
  expectNoCommands();
});
it('forwards exact reviewed arguments to explicit commands and returns server facts unchanged', async () => {
  setup();
  await screen.findByText('ended');
  const signal = new AbortController().signal;
  const reviewBody = { action: 'end' as const, expected_version: 3 };
  await expect(
    actions.cycleReview(courseIds.course, reviewBody, signal)
  ).resolves.toBe(review);
  await expect(actions.cycleEnd(courseIds.course, body)).resolves.toBe(ended);
  await actions.cycleStart(courseIds.course, body);
  expect(reviewCycle).toHaveBeenCalledWith(
    courseIds.course,
    reviewBody,
    signal
  );
  expect(endCycle).toHaveBeenCalledWith(courseIds.course, body);
  expect(startCycle).toHaveBeenCalledWith(courseIds.course, body);
  expect(reviewCycle.mock.calls[0]![1]).toBe(reviewBody);
  expect(startCycle.mock.calls[0]![1]).toBe(body);
});
it('does not expose a validly shaped response for another requested course ID', async () => {
  getCycle.mockResolvedValue({ ...state, course_id: courseIds.revision2 });
  setup();
  await waitFor(() => expect(current.query.isSuccess).toBe(true));
  expect(current.data).toBeUndefined();
  expect(screen.getByText('waiting')).toBeInTheDocument();
});
it('invalidates retained callbacks on a same-user profile flip and hides a late prior-profile cycle response', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationCourseCycle>>>();
  getCycle
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValue(new Error('Course is outside this profile'));
  const { tree, rerender } = setup();
  await waitFor(() => expect(getCycle).toHaveBeenCalledTimes(1));
  const retainedScope = current.scope;
  const retainedActions = actions;
  const sameUser = mockUser;
  mockActive = otherOwner;
  rerender(tree());
  expect(mockUser).toBe(sameUser);
  expect(retainedScope.isCurrent()).toBe(false);
  await expect(
    retainedActions.cycleEnd(courseIds.course, body)
  ).rejects.toThrow('active profile changed');
  await waitFor(() => expect(getCycle).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve(state));
  expect(current.data).toBeUndefined();
  expect(screen.queryByText('ended')).not.toBeInTheDocument();
  expectNoCommands();
});
it('fails closed on same-UUID cache clearing and prevents retained commands or late state display', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof getMedicationCourseCycle>>>();
  getCycle.mockReturnValue(pending.promise);
  const { client, tree, rerender } = setup();
  await waitFor(() => expect(getCycle).toHaveBeenCalledTimes(1));
  const retainedScope = current.scope;
  const retainedActions = actions;
  act(() => client.clear());
  expect(retainedScope.isCurrent()).toBe(false);
  await act(async () => pending.resolve(state));
  rerender(tree());
  expect(screen.getByText('private')).toBeInTheDocument();
  expect(current.data).toBeUndefined();
  await expect(
    retainedActions.cycleStart(courseIds.course, body)
  ).rejects.toThrow('active profile changed');
  expect(getCycle).toHaveBeenCalledTimes(1);
  expectNoCommands();
});
it('propagates a stale-review conflict once without retrying or silently refreshing a command', async () => {
  const conflict = Object.assign(new Error('Stale review'), { status: 409 });
  endCycle.mockRejectedValue(conflict);
  setup();
  await screen.findByText('ended');
  await expect(actions.cycleEnd(courseIds.course, body)).rejects.toBe(conflict);
  expect(endCycle).toHaveBeenCalledTimes(1);
  expect(reviewCycle).not.toHaveBeenCalled();
});
