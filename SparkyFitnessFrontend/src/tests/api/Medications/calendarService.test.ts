import { ZodError } from 'zod';
import type {
  MedicationLogWeekResponse,
  MedicationLogWeekActual,
  MedicationInjectionRead,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import {
  getMedicationLogWeek,
  getMedicationCalendarInjection,
} from '@/api/Medications/calendarService';
import { courseIds } from '@/tests/fixtures/medicationCourses';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
const laneId = `medication:${courseIds.med}`;
const actual = (): MedicationLogWeekActual => ({
  key: `injection:${courseIds.legacy}`,
  id: courseIds.legacy,
  source_kind: 'injection',
  lane_id: laneId,
  medication_id: courseIds.med,
  medication_name: 'Recorded medication',
  status: 'taken',
  entry_date: '2026-11-17',
  occurred_at: '2026-11-16T23:10:00Z',
  dose_amount: '0.1234567890123456789',
  dose_unit: 'mg',
  dose_mg_exact: '0.1234567890123456789',
  schedule_id: null,
  course_origin: true,
  course_revision_id: courseIds.revision,
  course_rule_id: courseIds.rule,
  course_step_id: null,
  course_slot_key: 'explicit-slot',
  scheduled_day: '2026-11-16',
  scheduled_for: null,
  notes: null,
  site: null,
  administration_route: 'injection',
});
const week = (): MedicationLogWeekResponse => ({
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
      id: laneId,
      medication_id: courseIds.med,
      name: 'Recorded medication',
      is_supplement: false,
    },
  ],
  planned_slots: [
    {
      id: 'explicit-slot',
      lane_id: laneId,
      medication_id: courseIds.med,
      plan_kind: 'managed',
      timezone: 'Pacific/Auckland',
      scheduled_day: '2026-11-16',
      scheduled_for: null,
      time_of_day: null,
      status: 'taken',
      dose_amount: '9.9999999999999999',
      dose_unit: 'mg',
      dose_qualification: 'configured',
      course_id: courseIds.course,
      course_revision_id: courseIds.revision,
      course_rule_id: courseIds.rule,
      course_step_id: null,
      course_slot_key: 'explicit-slot',
      course_expected_version: 3,
      schedule_id: null,
    },
  ],
  actuals: [actual()],
  fulfilled_slots: [{ planned_id: 'explicit-slot', actual: actual() }],
  coverage: [
    {
      lane_id: laneId,
      course_id: courseIds.course,
      timezone: 'Pacific/Auckland',
      day: '2026-11-16',
      coverage: 'partial',
    },
  ],
});
const injection = (): MedicationInjectionRead => ({
  id: courseIds.legacy,
  medication_id: courseIds.med,
  user_id: courseIds.owner,
  pen_id: null,
  preparation_id: null,
  injected_at: '2026-11-16T23:10:00Z',
  entry_date: '2026-11-17',
  site: null,
  administration_route: 'injection',
  dose_mg: '0.1234567890123456789',
  dose_mg_exact: '0.1234567890123456789',
  volume_ml: '0.01234567890123456789',
  syringe_units: null,
  dose_input_unit: 'mg',
  syringe_id: null,
  notes: null,
  source: 'manual',
  custom_fields: {},
  created_at: '2026-11-17T12:00:00Z',
  updated_at: '2026-11-17T12:00:00Z',
  scheduled_for: null,
  course_revision_id: courseIds.revision,
  course_rule_id: courseIds.rule,
  course_step_id: null,
  scheduled_day: '2026-11-16',
  course_slot_key: 'explicit-slot',
  course_origin: true,
  medication_name_snapshot: 'Recorded medication',
});
beforeEach(() => request.mockReset());
it('reads one owner-bound exact Monday week with signal and preserves native values and distinct recorded/scheduled dates', async () => {
  const result = week();
  const signal = new AbortController().signal;
  request.mockResolvedValue(result);
  await expect(
    getMedicationLogWeek(courseIds.owner, '2026-11-16', signal)
  ).resolves.toEqual(result);
  expect(request).toHaveBeenCalledWith('/v2/medications/calendar/week', {
    method: 'GET',
    params: { expected_owner_id: courseIds.owner, week_start: '2026-11-16' },
    signal,
    suppressErrorToast: true,
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it('lets the server choose the current Monday when no start is supplied', async () => {
  request.mockResolvedValue(week());
  await getMedicationLogWeek(courseIds.owner);
  expect(request.mock.calls[0]![1]!.params).toEqual({
    expected_owner_id: courseIds.owner,
    week_start: undefined,
  });
});
it.each(['2026-11-17', '2026-02-30'])(
  'rejects invalid or non-Monday input %s without normalising or issuing a read',
  async (date) => {
    await expect(
      getMedicationLogWeek(courseIds.owner, date)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).not.toHaveBeenCalled();
  }
);
it('retains an outside-week exact fulfilment only as a reference rather than moving it into actuals', async () => {
  const result = week();
  result.actuals = [];
  result.fulfilled_slots[0]!.actual = {
    ...actual(),
    entry_date: '2026-11-23',
    occurred_at: null,
  };
  request.mockResolvedValue(result);
  const response = await getMedicationLogWeek(courseIds.owner, '2026-11-16');
  expect(response).toEqual(result);
  expect(response.actuals).toEqual([]);
});
it('keeps same-UUID entry and injection actuals distinct by recorded source kind', async () => {
  const result = week();
  result.actuals.push({
    ...actual(),
    key: `entry:${courseIds.legacy}`,
    source_kind: 'entry',
    course_origin: null,
    course_revision_id: null,
    course_rule_id: null,
    course_slot_key: null,
    scheduled_day: null,
  });
  request.mockResolvedValue(result);
  const response = await getMedicationLogWeek(courseIds.owner, '2026-11-16');
  expect(response.actuals.map((row) => row.key)).toEqual([
    `injection:${courseIds.legacy}`,
    `entry:${courseIds.legacy}`,
  ]);
});
it('preserves unknown actual clocks and orphan lanes without current medication fallback', async () => {
  const result = week();
  const orphanId = `orphan:injection:${courseIds.legacy}`;
  result.lanes = [
    { id: orphanId, medication_id: null, name: '', is_supplement: null },
  ];
  result.planned_slots = [];
  result.fulfilled_slots = [];
  result.coverage = [];
  result.actuals = [
    {
      ...actual(),
      medication_id: null,
      lane_id: orphanId,
      occurred_at: null,
      dose_amount: null,
      dose_unit: null,
      dose_mg_exact: null,
    },
  ];
  request.mockResolvedValue(result);
  await expect(
    getMedicationLogWeek(courseIds.owner, '2026-11-16')
  ).resolves.toEqual(result);
});
it.each([
  {
    name: 'incomplete seven-day window',
    value: () => ({ ...week(), days: week().days.slice(0, 6) }),
  },
  {
    name: 'duplicate actual identity',
    value: () => ({ ...week(), actuals: [actual(), actual()] }),
  },
  {
    name: 'invented historical instant',
    value: () => ({
      ...week(),
      actuals: [{ ...actual(), occurred_at: 'not-an-instant' }],
    }),
  },
  {
    name: 'nonexact fulfilment attribution',
    value: () => ({
      ...week(),
      fulfilled_slots: [
        {
          planned_id: 'explicit-slot',
          actual: { ...actual(), course_slot_key: 'another-slot' },
        },
      ],
    }),
  },
  {
    name: 'editor internals in the bounded weekly summary',
    value: () => ({
      ...week(),
      actuals: [{ ...actual(), pen_id: courseIds.step }],
    }),
  },
  {
    name: 'future phase guessed amount',
    value: () => ({
      ...week(),
      planned_slots: [
        {
          ...week().planned_slots[0],
          dose_qualification: 'future_phase_unknown',
          dose_amount: '1',
        },
      ],
    }),
  },
])(
  'rejects $name through the strict shared weekly schema',
  async ({ value }) => {
    request.mockResolvedValue(value());
    await expect(
      getMedicationLogWeek(courseIds.owner, '2026-11-16')
    ).rejects.toBeInstanceOf(ZodError);
  }
);
it('reads the full exact injection only through its own owner-bound GET and preserves physical text precision', async () => {
  const result = injection();
  const signal = new AbortController().signal;
  request.mockResolvedValue(result);
  await expect(
    getMedicationCalendarInjection(courseIds.owner, courseIds.legacy, signal)
  ).resolves.toEqual(result);
  expect(request).toHaveBeenCalledWith(
    `/v2/medications/injections/${courseIds.legacy}`,
    {
      method: 'GET',
      params: { expected_owner_id: courseIds.owner },
      signal,
      suppressErrorToast: true,
    }
  );
});
it('retains genuinely unknown medication/time on a fresh injection instead of casting a legacy non-null shape', async () => {
  const result = {
    ...injection(),
    medication_id: null,
    injected_at: null,
    dose_mg: null,
    dose_mg_exact: null,
    volume_ml: null,
  };
  request.mockResolvedValue(result);
  await expect(
    getMedicationCalendarInjection(courseIds.owner, courseIds.legacy)
  ).resolves.toEqual(result);
});
it.each([{ id: courseIds.step }, { user_id: courseIds.step }])(
  'rejects an otherwise valid exact injection with mismatched requested identity %p',
  async (patch) => {
    request.mockResolvedValue({ ...injection(), ...patch });
    await expect(
      getMedicationCalendarInjection(courseIds.owner, courseIds.legacy)
    ).rejects.toThrow('does not match');
  }
);
it('cannot substitute a weekly actual summary for the full injection correction record', async () => {
  request.mockResolvedValue(actual());
  await expect(
    getMedicationCalendarInjection(courseIds.owner, courseIds.legacy)
  ).rejects.toBeInstanceOf(ZodError);
});
it('propagates foreign/missing injection 404 without retry or a summary fallback', async () => {
  const error = Object.assign(new Error('Not found'), { status: 404 });
  request.mockRejectedValue(error);
  await expect(
    getMedicationCalendarInjection(courseIds.owner, courseIds.legacy)
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});
