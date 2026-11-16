import { ZodError } from 'zod';
import {
  medicationCourseDueSchema,
  medicationCourseHistorySchema,
  medicationCourseMutationResultSchema,
  medicationCoursePlanInputSchema,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import * as service from '@/api/Medications/courseService';
import {
  courseFixture,
  courseIds,
  courseReview,
} from '@/tests/fixtures/medicationCourses';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const call = jest.mocked(apiCall);
const root = '/v2/medication-courses';
const today = '2026-11-16';
const timezone = 'Europe/London';
const operationId = '00000000-0000-4000-8000-000000000009';
const actualId = '00000000-0000-4000-8000-000000000010';
const plan = medicationCoursePlanInputSchema.parse({
  name: 'Authored plan',
  start_date: '2026-11-15',
  target_dose: '1',
  dose_unit: 'mg',
  dose_basis: 'per_injection',
  rules: [{ schedule_type_id: 'daily', time_of_day: '09:00' }],
  steps: [],
});
const mutationFields = { operation_id: operationId, expected_version: 1 };
const receipt = medicationCourseMutationResultSchema.parse({
  course_id: courseIds.course,
  revision_id: courseIds.revision,
  version: 2,
  operation_id: operationId,
});
const handoff = {
  cutover_day: '2026-11-16',
  selected_rules: [
    { schedule_id: courseIds.legacy, fingerprint: 'rule-review-1' },
  ],
};
const reviewBody = { ...plan, expected_version: 0, handoff };
const review = courseReview(plan);
const createBody = {
  ...plan,
  ...mutationFields,
  expected_version: 0,
  medication_id: courseIds.med,
  // Deliberately retain authored precision/notation in the outgoing request.
  target_dose: '1.2300e-400',
  handoff,
  native_reminder_limitation_acknowledged: true,
  review_fingerprint: 'review-1',
};
const editBody = { ...plan, ...mutationFields };
const reviseBody = { ...editBody, review_fingerprint: 'review-2' };
const statusBody = { ...mutationFields, status: 'paused' as const };
const due = medicationCourseDueSchema.parse({
  courses: [courseFixture()],
  today,
  timezone,
  slots: [
    {
      course_id: courseIds.course,
      medication_id: courseIds.med,
      schedule_type_id: 'daily',
      course_revision_id: courseIds.revision,
      course_rule_id: courseIds.rule,
      course_step_id: null,
      course_slot_key: 'explicit-slot-1',
      course_expected_version: 1,
      scheduled_day: '2026-11-15',
      time_of_day: '09:00',
      scheduled_for: '2026-11-15T09:00:00Z',
      per_dose_amount: '1e-400',
      authored_dose: '1e-400',
      dose_unit: 'mg',
      dose_basis: 'per_injection',
      phase_progress_known: true,
    },
  ],
  fulfilled_slots: [
    {
      course_revision_id: courseIds.revision,
      course_rule_id: courseIds.rule,
      course_slot_key: 'explicit-slot-1',
      scheduled_day: '2026-11-15',
      status: 'taken',
      source_kind: 'injection',
      entry_id: actualId,
      occurred_at: '2026-11-16T10:11:12.345Z',
      entry_date: '2026-11-16',
    },
  ],
});
const history = medicationCourseHistorySchema.parse({
  course: courseFixture(),
  from_date: '2026-11-15',
  to_date: today,
  today,
  timezone,
  adherence: {
    captured_at: '2026-11-16T10:11:12.345Z',
    taken: 0,
    missed: 0,
    pending: 0,
    skipped: 0,
    pct: null,
    days: [],
  },
  actuals: [
    {
      id: actualId,
      course_origin: true,
      source_kind: 'injection',
      course_revision_id: courseIds.revision,
      course_rule_id: courseIds.rule,
      course_step_id: null,
      course_slot_key: 'explicit-slot-1',
      scheduled_day: '2026-11-15',
      scheduled_for: '2026-11-15T09:00:00Z',
      entry_date: '2026-11-16',
      occurred_at: '2026-11-16T10:11:12.345Z',
      status: 'taken',
      medication_name: 'Example medication',
      dose_amount: null,
      dose_unit: null,
      dose_mg_exact: '1e-400',
      volume_ml: null,
      site: null,
      notes: null,
      administration_route: null,
    },
  ],
});

beforeEach(() => call.mockReset());

it('lists validated courses with medication filter and the caller abort signal', async () => {
  const response = { courses: [courseFixture()], today, timezone };
  const signal = new AbortController().signal;
  call.mockResolvedValue(response);
  await expect(
    service.listMedicationCourses(courseIds.med, signal)
  ).resolves.toEqual(response);
  expect(call).toHaveBeenCalledWith(root, {
    method: 'GET',
    params: { medication_id: courseIds.med },
    signal,
    suppressErrorToast: true,
  });
});
it('keeps an omitted medication filter omitted rather than inventing an owner or medication', async () => {
  call.mockResolvedValue({ courses: [], today, timezone });
  await service.listMedicationCourses(undefined);
  expect(call).toHaveBeenCalledWith(
    root,
    expect.objectContaining({ params: { medication_id: undefined } })
  );
});
it('reads handoff rules from the medication-specific canonical endpoint', async () => {
  const response = {
    rules: [
      {
        schedule_id: courseIds.legacy,
        rule: plan.rules[0],
        fingerprint: 'fingerprint-1',
        already_handed_off: false,
      },
    ],
    today,
    timezone,
  };
  const signal = new AbortController().signal;
  call.mockResolvedValue(response);
  await expect(
    service.getCourseHandoffRules(courseIds.med, signal)
  ).resolves.toEqual(response);
  expect(call).toHaveBeenCalledWith(
    `${root}/medications/${courseIds.med}/handoff-rules`,
    { method: 'GET', signal, suppressErrorToast: true }
  );
});
it.each([
  [null, `${root}/medications/${courseIds.med}/create-review`],
  [courseIds.course, `${root}/${courseIds.course}/review`],
])(
  'reviews course %s without mutating or rewriting the reviewed plan',
  async (courseId, endpoint) => {
    const signal = new AbortController().signal;
    call.mockResolvedValue(review);
    await expect(
      service.reviewMedicationCourse(
        courseIds.med,
        courseId,
        reviewBody,
        signal
      )
    ).resolves.toEqual(review);
    expect(call).toHaveBeenCalledWith(endpoint, {
      method: 'POST',
      body: reviewBody,
      signal,
      suppressErrorToast: true,
    });
    expect(call.mock.calls[0]![1]!.body).toBe(reviewBody);
  }
);

const mutations = [
  {
    name: 'create',
    method: 'POST',
    endpoint: root,
    body: createBody,
    run: () => service.createMedicationCourse(createBody),
  },
  {
    name: 'edit',
    method: 'PUT',
    endpoint: `${root}/${courseIds.course}`,
    body: editBody,
    run: () => service.editMedicationCourse(courseIds.course, editBody),
  },
  {
    name: 'revise',
    method: 'POST',
    endpoint: `${root}/${courseIds.course}/revise`,
    body: reviseBody,
    run: () => service.reviseMedicationCourse(courseIds.course, reviseBody),
  },
  {
    name: 'status',
    method: 'POST',
    endpoint: `${root}/${courseIds.course}/status`,
    body: statusBody,
    run: () => service.setMedicationCourseStatus(courseIds.course, statusBody),
  },
  {
    name: 'delete course',
    method: 'DELETE',
    endpoint: `${root}/${courseIds.course}`,
    body: mutationFields,
    run: () =>
      service.deleteMedicationCourse(courseIds.course, null, mutationFields),
  },
  {
    name: 'delete revision',
    method: 'DELETE',
    endpoint: `${root}/${courseIds.course}/revisions/${courseIds.revision}`,
    body: mutationFields,
    run: () =>
      service.deleteMedicationCourse(
        courseIds.course,
        courseIds.revision,
        mutationFields
      ),
  },
];
it.each(mutations)(
  '$name sends canonical method/path and exact concurrency body, returning the JSON receipt',
  async ({ run, method, endpoint, body }) => {
    call.mockResolvedValue(receipt);
    await expect(run()).resolves.toEqual(receipt);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(endpoint, {
      method,
      body,
      suppressErrorToast: true,
    });
    expect(call.mock.calls[0]![1]!.body).toBe(body);
  }
);
it.each(mutations)(
  '$name rejects an unexpected empty/204 response rather than manufacturing a receipt',
  async ({ run }) => {
    call.mockResolvedValue(undefined);
    await expect(run()).rejects.toBeInstanceOf(ZodError);
    expect(call).toHaveBeenCalledTimes(1);
  }
);
it('preserves the exact authored decimal string, selected handoff fingerprints and operation ID on create', async () => {
  call.mockResolvedValue(receipt);
  await service.createMedicationCourse(createBody);
  expect(call.mock.calls[0]![1]!.body).toMatchObject({
    target_dose: '1.2300e-400',
    operation_id: operationId,
    review_fingerprint: 'review-1',
    handoff,
    native_reminder_limitation_acknowledged: true,
  });
});
it.each([
  null,
  '',
  { course_id: courseIds.course, version: 2, operation_id: operationId },
])('rejects incomplete delete receipt %p', async (response) => {
  call.mockResolvedValue(response);
  await expect(
    service.deleteMedicationCourse(courseIds.course, null, mutationFields)
  ).rejects.toBeInstanceOf(ZodError);
});
it('propagates a stale conflict without retrying a mutation', async () => {
  const conflict = Object.assign(new Error('Stale version'), { status: 409 });
  call.mockRejectedValue(conflict);
  await expect(
    service.editMedicationCourse(courseIds.course, editBody)
  ).rejects.toBe(conflict);
  expect(call).toHaveBeenCalledTimes(1);
});

it('reads validated history and preserves separate actual time/day and planned slot attribution', async () => {
  const signal = new AbortController().signal;
  call.mockResolvedValue(history);
  await expect(
    service.getMedicationCourseHistory(courseIds.course, signal)
  ).resolves.toEqual(history);
  expect(call).toHaveBeenCalledWith(`${root}/${courseIds.course}/history`, {
    method: 'GET',
    signal,
    suppressErrorToast: true,
  });
});
it('reads canonical dues with requested date/signal and preserves cross-day fulfilment', async () => {
  const signal = new AbortController().signal;
  call.mockResolvedValue(due);
  await expect(
    service.getMedicationCourseDue('2026-11-15', signal)
  ).resolves.toEqual(due);
  expect(call).toHaveBeenCalledWith(`${root}/due`, {
    method: 'GET',
    params: { date: '2026-11-15' },
    signal,
    suppressErrorToast: true,
  });
});
it('rejects dues missing required authoritative fulfilled_slots', async () => {
  const { fulfilled_slots: _fulfilledSlots, ...missingFulfilment } = due;
  call.mockResolvedValue(missingFulfilment);
  await expect(
    service.getMedicationCourseDue('2026-11-15')
  ).rejects.toBeInstanceOf(ZodError);
});
it.each([
  {
    name: 'list invalid owner identity',
    response: {
      courses: [{ ...courseFixture(), user_id: 'invalid-uuid' }],
      today,
      timezone,
    },
    run: () => service.listMedicationCourses(undefined),
  },
  {
    name: 'handoff missing fingerprint',
    response: {
      rules: [
        {
          schedule_id: courseIds.legacy,
          rule: plan.rules[0],
          already_handed_off: false,
        },
      ],
      today,
      timezone,
    },
    run: () => service.getCourseHandoffRules(courseIds.med),
  },
  {
    name: 'review missing confirmation fingerprint',
    response: { ...review, review_fingerprint: '' },
    run: () => service.reviewMedicationCourse(courseIds.med, null, reviewBody),
  },
  {
    name: 'history invalid actual tracking day',
    response: {
      ...history,
      actuals: [{ ...history.actuals[0], entry_date: '2026-02-30' }],
    },
    run: () => service.getMedicationCourseHistory(courseIds.course),
  },
  {
    name: 'due invalid fulfilment source kind',
    response: {
      ...due,
      fulfilled_slots: [{ ...due.fulfilled_slots[0], source_kind: 'guessed' }],
    },
    run: () => service.getMedicationCourseDue('2026-11-15'),
  },
])(
  'rejects malformed $name responses through the real shared schemas',
  async ({ response, run }) => {
    call.mockResolvedValue(response);
    await expect(run()).rejects.toBeInstanceOf(ZodError);
  }
);
