import { ZodError } from 'zod';
import {
  medicationCourseCycleStateSchema,
  medicationCourseCycleReviewSchema,
  medicationCourseCycleMutationResultSchema,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import {
  getMedicationCourseCycle,
  reviewMedicationCourseCycle,
  endMedicationCourseCycle,
  startMedicationCourseCycle,
} from '@/api/Medications/courseService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
const root = `/v2/medication-courses/${courseIds.course}`;
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
  start_next_cycle: {
    allowed: false,
    reasons: ['No repeating break is configured.'],
  },
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
  review_fingerprint: 'cycle-review-1',
});
const actionBody = {
  operation_id: courseIds.legacy,
  expected_version: 3,
  review_fingerprint: 'cycle-review-1',
};
const boundaryBefore = {
  revision_id: courseIds.revision,
  status: 'active',
  start_date: '2026-11-01',
  end_date: null,
  weekly_anchor_date: '2026-11-01',
};
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
    before: boundaryBefore,
    after: { ...boundaryBefore, status: 'completed', end_date: '2026-11-14' },
  },
});
const started = medicationCourseCycleMutationResultSchema.parse({
  ...ended,
  action: 'start',
  revision_id: courseIds.revision2,
  activated_at: '2026-11-16T13:14:15.123Z',
  boundary_audit: {
    ...ended.boundary_audit,
    before: ended.boundary_audit.after,
    after: {
      revision_id: courseIds.revision2,
      status: 'active',
      start_date: '2026-11-16',
      end_date: '2026-11-29',
      weekly_anchor_date: '2026-11-16',
    },
  },
});
beforeEach(() => request.mockReset());

it('reads advisory cycle state with GET and the caller abort signal without scheduling an action', async () => {
  const signal = new AbortController().signal;
  request.mockResolvedValue(state);
  await expect(
    getMedicationCourseCycle(courseIds.course, signal)
  ).resolves.toEqual(state);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(`${root}/cycle`, {
    method: 'GET',
    signal,
    suppressErrorToast: true,
  });
});
it.each(['end', 'start'] as const)(
  'reviews explicit %s with only the requested action/version and signal',
  async (action) => {
    const body = { action, expected_version: 3 };
    const signal = new AbortController().signal;
    const response = { ...review, action };
    request.mockResolvedValue(response);
    await expect(
      reviewMedicationCourseCycle(courseIds.course, body, signal)
    ).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(`${root}/cycle-review`, {
      method: 'POST',
      body,
      signal,
      suppressErrorToast: true,
    });
    expect(request.mock.calls[0]![1]!.body).toBe(body);
  }
);
it('retains server conflict/unknown phase context and a null first due without resetting a phase', async () => {
  const response = {
    ...review,
    phase_continuity: 'unknown',
    can_commit: false,
    conflicts: [
      {
        code: 'stored_fact_conflict',
        message: 'Stored history conflicts with this boundary.',
      },
    ],
  };
  request.mockResolvedValue(response);
  await expect(
    reviewMedicationCourseCycle(courseIds.course, {
      action: 'end',
      expected_version: 3,
    })
  ).resolves.toEqual(response);
});
it.each([
  { action: 'end', run: endMedicationCourseCycle, response: ended },
  { action: 'start', run: startMedicationCourseCycle, response: started },
])(
  'commits %s using exact operation/version/fingerprint and returns immutable server boundary/activation facts',
  async ({ action, run, response }) => {
    request.mockResolvedValue(response);
    await expect(run(courseIds.course, actionBody)).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(`${root}/cycle-${action}`, {
      method: 'POST',
      body: actionBody,
      suppressErrorToast: true,
    });
    expect(request.mock.calls[0]![1]!.body).toBe(actionBody);
  }
);
it('keeps an exact operation retry unchanged instead of inserting a new day, anchor or operation ID', async () => {
  request.mockResolvedValue(started);
  await startMedicationCourseCycle(courseIds.course, actionBody);
  await startMedicationCourseCycle(courseIds.course, actionBody);
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  expect(request.mock.calls[1]![1]!.body).toEqual(actionBody);
});
it.each([
  {
    name: 'state with an invented nonadvisory flag',
    response: { ...state, advisory: false },
    run: () => getMedicationCourseCycle(courseIds.course),
  },
  {
    name: 'state with a zero cycle length',
    response: { ...state, on_weeks: 0 },
    run: () => getMedicationCourseCycle(courseIds.course),
  },
  {
    name: 'review without phase continuity',
    response: { ...review, phase_continuity: undefined },
    run: () =>
      reviewMedicationCourseCycle(courseIds.course, {
        action: 'end',
        expected_version: 3,
      }),
  },
  {
    name: 'review with malformed first-due day',
    response: {
      ...review,
      first_due: {
        scheduled_day: '2026-02-30',
        scheduled_for: null,
        time_of_day: null,
      },
    },
    run: () =>
      reviewMedicationCourseCycle(courseIds.course, {
        action: 'start',
        expected_version: 3,
      }),
  },
  {
    name: 'end receipt without retained boundary audit',
    response: { ...ended, boundary_audit: undefined },
    run: () => endMedicationCourseCycle(courseIds.course, actionBody),
  },
  {
    name: 'start receipt with an invalid activation instant',
    response: { ...started, activated_at: 'today' },
    run: () => startMedicationCourseCycle(courseIds.course, actionBody),
  },
])(
  'rejects $name through the actual shared response schemas',
  async ({ response, run }) => {
    request.mockResolvedValue(response);
    await expect(run()).rejects.toBeInstanceOf(ZodError);
  }
);
it.each([endMedicationCourseCycle, startMedicationCourseCycle])(
  'rejects an unexpected empty action receipt instead of manufacturing success',
  async (run) => {
    request.mockResolvedValue(undefined);
    await expect(run(courseIds.course, actionBody)).rejects.toBeInstanceOf(
      ZodError
    );
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it.each([
  () =>
    reviewMedicationCourseCycle(courseIds.course, {
      action: 'end',
      expected_version: 3,
    }),
  () => endMedicationCourseCycle(courseIds.course, actionBody),
  () => startMedicationCourseCycle(courseIds.course, actionBody),
])(
  'propagates a stale conflict without automatic review, operation replacement or retry',
  async (run) => {
    const error = Object.assign(new Error('Review changed'), { status: 409 });
    request.mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
