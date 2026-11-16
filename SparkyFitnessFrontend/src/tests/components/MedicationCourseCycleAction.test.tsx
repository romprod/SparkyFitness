import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MedicationCourseCycleAction from '@/pages/Medications/MedicationCourseCycleAction';
import { courseFixture, courseIds } from '@/tests/fixtures/medicationCourses';
import {
  cycleReviewFixture,
  cycleStateFixture,
  cycleMutationFixture,
} from '@/tests/fixtures/medicationCourseCycles';
import { HttpApiError } from '@/api/api';
const mockReview = jest.fn(),
  mockEnd = jest.fn(),
  mockStart = jest.fn(),
  mockInvalidate = jest.fn();
let mockCurrent = true;
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
  useMedicationCourseActions: () => ({
    cycleReview: mockReview,
    cycleEnd: mockEnd,
    cycleStart: mockStart,
  }),
  invalidateMedicationCourses: (...args: unknown[]) => mockInvalidate(...args),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'UTC',
    formatDate: (day: string) => `Date ${day}`,
  }),
}));
const scope = {
  ready: true,
  actorId: courseIds.owner,
  ownerId: courseIds.owner,
  generation: 1,
  key: 'actor:owner:1',
  canWrite: true,
  isCurrent: () => mockCurrent,
};
const close = jest.fn(),
  refresh = jest.fn();
function setup(action: 'start' | 'end' = 'start', course = courseFixture()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MedicationCourseCycleAction
        course={course}
        revision={course.revisions[0]!}
        action={action}
        scope={scope}
        onClose={close}
        onRefresh={refresh}
      />
    </QueryClientProvider>
  );
}
const review = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Review cycle change' }));
beforeEach(() => {
  mockCurrent = true;
  close.mockReset();
  refresh.mockReset().mockResolvedValue(courseFixture());
  mockReview.mockReset().mockImplementation(async (_id, input) =>
    cycleReviewFixture({
      action: input.action,
      cycle: cycleStateFixture({ version: input.expected_version }),
      ...(input.action === 'end'
        ? {
            candidate_end_date: '2026-11-07',
            new_start_date: null,
            new_end_date: null,
          }
        : {}),
    })
  );
  mockEnd
    .mockReset()
    .mockResolvedValue(cycleMutationFixture({ action: 'end' }));
  mockStart.mockReset().mockResolvedValue(cycleMutationFixture());
  mockInvalidate.mockClear();
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: jest.fn(() => '00000000-0000-4000-8000-000000000099'),
  });
});
it('reviews canonical captured-zone dates before sending only operation/version/fingerprint on Start', async () => {
  const phased = courseFixture();
  Object.assign(phased.revisions[0]!, {
    phase_family_id: courseIds.revision,
    phase_origin_context: { start_date: '2026-11-01', end_date: null },
    steps: [
      {
        id: courseIds.step,
        user_id: courseIds.owner,
        revision_id: courseIds.revision,
        step_index: 0,
        dose: '0.25',
        dose_unit: 'mg',
        duration_days: 14,
        notes: null,
      },
    ],
  });
  setup('start', phased);
  expect(mockStart).not.toHaveBeenCalled();
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  expect(mockReview).toHaveBeenCalledWith(courseIds.course, {
    action: 'start',
    expected_version: 1,
  });
  expect(screen.getAllByText(/America\/New_York/).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Date 2026-11-16').length).toBeGreaterThan(0);
  expect(screen.getByText('Date 2026-11-22')).toBeInTheDocument();
  expect(screen.getByText(/phase progression is retained/)).toBeInTheDocument();
  expect(
    screen.getByText(/does not log a dose or fill earlier time slots/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  expect(mockStart.mock.calls[0]).toEqual([
    courseIds.course,
    {
      operation_id: expect.any(String),
      expected_version: 1,
      review_fingerprint: 'cycle-review-1',
    },
  ]);
  expect(mockEnd).not.toHaveBeenCalled();
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mockInvalidate).toHaveBeenCalled();
});
it('keeps a later stored-fact End conflict blocked instead of applying an adjusted date', async () => {
  mockReview.mockResolvedValue(
    cycleReviewFixture({
      action: 'end',
      candidate_end_date: '2026-11-07',
      can_commit: false,
      conflicts: [
        {
          code: 'stored_fact',
          message:
            'Recorded timing after this boundary prevents ending the cycle.',
        },
      ],
    })
  );
  setup('end');
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  expect(
    screen.getByText(
      'Recorded timing after this boundary prevents ending the cycle.'
    )
  ).toBeInTheDocument();
  expect(screen.getAllByText('Date 2026-11-07').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Confirm change' })).toBeDisabled();
  expect(mockEnd).not.toHaveBeenCalled();
});
it('allows a canonical nullable first due without inventing a dose or extending unchanged rules', async () => {
  mockReview.mockResolvedValue(
    cycleReviewFixture({ first_due: null, phase_continuity: 'not_applicable' })
  );
  setup();
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  expect(screen.getByText(/unchanged schedule bounds/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm change' })).toBeEnabled();
});
it('keeps the same operation through unknown and later deterministic errors without refreshing its day or fingerprint', async () => {
  mockStart
    .mockRejectedValueOnce(new Error('lost response'))
    .mockRejectedValueOnce(new HttpApiError('changed', 409))
    .mockResolvedValueOnce(cycleMutationFixture());
  setup();
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
  await screen.findByRole('button', { name: 'Retry same change' });
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same change' }));
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same change' }));
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(3));
  expect(mockStart.mock.calls[1]).toEqual(mockStart.mock.calls[0]);
  expect(mockStart.mock.calls[2]).toEqual(mockStart.mock.calls[0]);
  expect(mockReview).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});
it('requires explicit refresh and a new review after a known stale409, never auto-confirming', async () => {
  mockEnd.mockRejectedValueOnce(
    new HttpApiError('History changed; review again.', 409)
  );
  const latest = courseFixture({ version: 2 });
  refresh.mockResolvedValue(latest);
  setup('end');
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
  await screen.findByRole('button', { name: 'Refresh current data' });
  expect(
    screen.queryByRole('button', { name: 'Confirm change' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current data' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(mockEnd).toHaveBeenCalledTimes(1);
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  expect(mockReview.mock.calls[1]![1]).toEqual({
    action: 'end',
    expected_version: 2,
  });
  expect(mockEnd).toHaveBeenCalledTimes(1);
});
it('does not silently retarget a stale action to a successor tip', async () => {
  mockReview.mockRejectedValueOnce(new HttpApiError('stale', 409));
  refresh.mockResolvedValue(
    courseFixture({ current_revision_id: courseIds.revision2, version: 2 })
  );
  setup();
  review();
  await screen.findByRole('button', { name: 'Refresh current data' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current data' }));
  await screen.findByText(/no longer the current tip/);
  expect(mockStart).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Review cycle change' })
  ).toBeDisabled();
});
it('discards a delayed review after profile authority is lost', async () => {
  let resolve!: (result: ReturnType<typeof cycleReviewFixture>) => void;
  mockReview.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  setup();
  review();
  mockCurrent = false;
  await act(async () => resolve(cycleReviewFixture()));
  expect(
    screen.queryByRole('button', { name: 'Confirm change' })
  ).not.toBeInTheDocument();
  expect(mockStart).not.toHaveBeenCalled();
});
it('cannot issue a cycle operation after current proof changes, even from a previously reviewed dialog', async () => {
  setup();
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  mockCurrent = false;
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
  expect(mockStart).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('ignores a delayed command receipt after the active profile changes', async () => {
  let resolve!: (value: ReturnType<typeof cycleMutationFixture>) => void;
  mockStart.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  setup();
  review();
  await screen.findByRole('button', { name: 'Confirm change' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
  mockCurrent = false;
  await act(async () => resolve(cycleMutationFixture()));
  expect(close).not.toHaveBeenCalled();
  expect(mockInvalidate).not.toHaveBeenCalled();
});
