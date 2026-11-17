import { ZodError } from 'zod';
import {
  addDays,
  type MedicationCourseTimelineResponse,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import { getMedicationCourseTimeline } from '@/api/Medications/courseService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
const response = (): MedicationCourseTimelineResponse => ({
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
      name: 'Example authored plan',
      medication_id: courseIds.med,
      medication_name: 'Example medication',
      timezone: 'Pacific/Auckland',
      local_today: '2026-11-18',
      status: 'active',
      bucket: 'active',
      is_current_tip: true,
      medication_active: true,
      version: 3,
      start_date: '2026-11-01',
      end_date: '2026-12-01',
      closed_date: null,
      open_end: false,
      overlap_eligible: true,
      segments: [
        {
          kind: 'authored_window',
          from: '2026-11-01',
          to: '2026-12-01',
          offset: 7,
          days: 31,
        },
      ],
      limitations: [],
    },
  ],
});
beforeEach(() => request.mockReset());
it('reads all-profile server geometry with canonical GET, expected owner and caller cancellation only', async () => {
  const result = response();
  result.rows.push({
    ...result.rows[0]!,
    course_id: courseIds.step,
    revision_id: courseIds.revision2,
    medication_id: courseIds.legacy,
    name: 'Another plan',
    medication_name: 'Another medication',
  });
  const signal = new AbortController().signal;
  request.mockResolvedValue(result);
  await expect(
    getMedicationCourseTimeline(courseIds.owner, signal)
  ).resolves.toEqual(result);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/v2/medication-courses/timeline', {
    method: 'GET',
    params: { expected_owner_id: courseIds.owner },
    signal,
    suppressErrorToast: true,
  });
});
it('preserves a canonical empty timeline instead of inventing a course or administration', async () => {
  const result = response();
  result.rows = [];
  request.mockResolvedValue(result);
  await expect(getMedicationCourseTimeline(courseIds.owner)).resolves.toEqual(
    result
  );
});
it('retains detached unknown boundary facts rather than filling a start or future bar', async () => {
  const result = response();
  result.rows = [
    {
      ...result.rows[0]!,
      medication_id: null,
      medication_active: null,
      status: 'completed',
      bucket: 'completed',
      overlap_eligible: false,
      start_date: null,
      end_date: null,
      segments: [],
      limitations: ['unknown_start', 'unknown_stop'],
    },
  ];
  request.mockResolvedValue(result);
  await expect(getMedicationCourseTimeline(courseIds.owner)).resolves.toEqual(
    result
  );
});
it.each([
  {
    name: 'missing viewing-window contract',
    value: () => ({ ...response(), window: undefined }),
  },
  {
    name: 'wrong fixed window size',
    value: () => ({
      ...response(),
      window: { ...response().window, days: 139 },
    }),
  },
  {
    name: 'misaligned server segment geometry',
    value: () => ({
      ...response(),
      rows: [
        {
          ...response().rows[0],
          segments: [
            {
              kind: 'authored_window',
              from: '2026-11-01',
              to: '2026-12-01',
              offset: 8,
              days: 31,
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'duplicate visible revision identity',
    value: () => ({
      ...response(),
      rows: [response().rows[0], response().rows[0]],
    }),
  },
  {
    name: 'incomplete overlap calendar',
    value: () => ({ ...response(), overlap: [] }),
  },
  {
    name: 'invalid week tick alignment',
    value: () => ({
      ...response(),
      week_ticks: response().week_ticks.map((tick, index) =>
        index === 1 ? { ...tick, offset: 8 } : tick
      ),
    }),
  },
  {
    name: 'unrequested actual-dose payload',
    value: () => ({ ...response(), actuals: [] }),
  },
  { name: 'empty response', value: () => undefined },
])(
  'rejects $name using the actual strict shared contract',
  async ({ value }) => {
    request.mockResolvedValue(value());
    await expect(
      getMedicationCourseTimeline(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it('propagates an owner mismatch without retry, cached empty fallback or a request for another profile', async () => {
  const error = Object.assign(new Error('Owner changed'), { status: 409 });
  request.mockRejectedValue(error);
  await expect(getMedicationCourseTimeline(courseIds.owner)).rejects.toBe(
    error
  );
  expect(request).toHaveBeenCalledTimes(1);
});
