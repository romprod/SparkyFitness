import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpApiError } from '@/api/api';
import MedicationCourseEditor from '@/pages/Medications/MedicationCourseEditor';
import {
  courseFixture,
  courseMedication,
  courseIds,
  courseReview,
} from '@/tests/fixtures/medicationCourses';
import type {
  CourseAdvanceProposal,
  MedicationCourseReviewInput,
  MedicationCourseReview,
  MedicationBlend,
} from '@workspace/shared';
let mockRxReady = false;
const mockRxId = '00000000-0000-4000-8000-000000000071';
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptions: () => ({
    scope: {
      ready: mockRxReady,
      canWrite: mockRxReady,
      isCurrent: () => mockRxReady,
    },
    query: { isError: false, isFetching: false },
    data: {
      prescriptions: [
        {
          id: mockRxId,
          medication_id: '00000000-0000-4000-8000-000000000002',
          source: 'Recorded Rx',
          status: 'expired',
          expiration: null,
        },
      ],
    },
  }),
}));
const mockReview = jest.fn<
  Promise<MedicationCourseReview>,
  [string, string | null, MedicationCourseReviewInput]
>();
const mockCreate = jest.fn(),
  mockEdit = jest.fn(),
  mockRevise = jest.fn();
let mockCurrent = true;
const candidate = {
  schedule_id: courseIds.legacy,
  rule: { schedule_type_id: 'daily' as const, time_of_day: '09:00' },
  fingerprint: 'legacy-1',
  already_handed_off: false,
};
const mockHandoffRefetch = jest.fn(async () => ({
  data: { rules: [candidate], today: '2026-11-16', timezone: 'Europe/London' },
}));
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  HttpApiError: jest.requireActual('@/api/api').HttpApiError,
  useMedicationCourseActions: () => ({
    review: mockReview,
    create: mockCreate,
    edit: mockEdit,
    revise: mockRevise,
  }),
  useCourseHandoffRules: () => ({
    data: {
      rules: [candidate],
      today: '2026-11-16',
      timezone: 'Europe/London',
    },
    refetch: mockHandoffRefetch,
    isLoading: false,
    isError: false,
  }),
  invalidateMedicationCourses: jest.fn(),
}));
const mockDevices = { syringes: [], default_syringe_id: null } as {
  syringes: Array<{
    id: string;
    name: string;
    device_type?: 'syringe' | 'pen' | 'pump';
  }>;
  default_syringe_id: string | null;
};
jest.mock('@/hooks/Medications/useMedicationInventoryForecast', () => ({
  useMedicationForecastDevices: () => ({ data: mockDevices, isError: false }),
}));
let mockBlends: MedicationBlend[] = [];
let mockPens: Array<Record<string, unknown>> = [];
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({
    data: mockBlends,
    query: { isLoading: false, isError: false },
  }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationTitration: () => ({ data: [] }),
  useMedicationPens: () => ({ data: mockPens }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timeFormat: 'HH:mm',
    formatDate: (day: string) => `Formatted ${day}`,
  }),
}));
const scope = {
  ready: true,
  actorId: courseIds.owner,
  ownerId: courseIds.owner,
  generation: 1,
  key: 'owner:scope',
  canWrite: true,
  isCurrent: () => mockCurrent,
};
const close = jest.fn(),
  refresh = jest.fn();
function setup(
  mode: 'create' | 'handoff' | 'edit' | 'revise' = 'create',
  course = courseFixture(),
  med = courseMedication,
  advance?: CourseAdvanceProposal
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MedicationCourseEditor
        med={med}
        today="2026-11-16"
        timezone="Europe/London"
        scope={scope}
        mode={mode}
        {...(mode === 'edit' || mode === 'revise'
          ? { course, revision: course.revisions[0] }
          : {})}
        {...(advance ? { advance } : {})}
        onClose={close}
        onRefresh={refresh}
      />
    </QueryClientProvider>
  );
}
const review = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
const acknowledge = () => {
  const box = screen.queryByRole('checkbox', {
    name: /Versioned plans appear in the website checklist/,
  });
  if (box) fireEvent.click(box);
};
beforeEach(() => {
  mockRxReady = false;
  mockCurrent = true;
  mockDevices.syringes = [];
  mockDevices.default_syringe_id = null;
  mockBlends = [];
  mockPens = [];
  close.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  mockCreate.mockReset();
  mockEdit.mockReset();
  mockRevise.mockReset();
  mockCreate.mockResolvedValue({});
  mockEdit.mockResolvedValue({});
  mockRevise.mockResolvedValue({});
  mockReview.mockReset();
  mockReview.mockImplementation(async (_med, _id, input) =>
    courseReview(input, { expected_version: input.expected_version })
  );
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000099',
  });
});
it('reviews authored exact values with website-only information and no extra non-handoff acknowledgement', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Planned amount (optional)'), {
    target: { value: '0.123456789012345678901' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(screen.getByRole('button', { name: 'Confirm course' })).toBeEnabled();
  expect(screen.getByText('Plan timezone: Europe/London')).toBeInTheDocument();
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0]![0]).toMatchObject({
    target_dose: '0.123456789012345678901',
    operation_id: expect.any(String),
    expected_version: 0,
    native_reminder_limitation_acknowledged: false,
    review_fingerprint: 'review-1',
  });
  expect(mockEdit).not.toHaveBeenCalled();
});
it('explicit handoff captures only selected legacy fingerprints and explains the cutover', async () => {
  setup('handoff');
  fireEvent.click(screen.getByRole('checkbox', { name: /Daily at/ }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy selected rules into this course' })
  );
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(screen.getByRole('button', { name: 'Confirm course' })).toBeDisabled();
  expect(
    screen.getByText(/selected legacy rules end before/)
  ).toBeInTheDocument();
  expect(mockReview.mock.calls[0]![2].handoff).toEqual({
    cutover_day: '2026-11-16',
    selected_rules: [
      { schedule_id: courseIds.legacy, fingerprint: 'legacy-1' },
    ],
  });
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0]![0].handoff.selected_rules).toHaveLength(1);
});
it('retains the operation and locks edits through an unknown result and later deterministic error', async () => {
  mockCreate
    .mockRejectedValueOnce(new Error('lost response'))
    .mockRejectedValueOnce(new HttpApiError('conflict', 409))
    .mockResolvedValueOnce({});
  setup();
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await screen.findByRole('button', { name: 'Retry same operation' });
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  const original = mockCreate.mock.calls[0]![0];
  fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: 'Retry same operation' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry same operation' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3));
  expect(mockCreate.mock.calls.map((call) => call[0])).toEqual([
    original,
    original,
    original,
  ]);
});
it('stale409 keeps authored values and requires explicit refresh and review, never autosubmits', async () => {
  mockCreate.mockRejectedValueOnce(new HttpApiError('stale plan', 409));
  setup();
  fireEvent.change(screen.getByLabelText('Course name'), {
    target: { value: 'Retained authored name' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await screen.findByRole('button', { name: 'Refresh current data' });
  expect(screen.getByLabelText('Course name')).toHaveValue(
    'Retained authored name'
  );
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current data' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Review changes' })).toBeEnabled()
  );
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockReview).toHaveBeenCalledTimes(1);
});
it('requires a revision for delivered material edits and does not submit an in-place edit', async () => {
  mockReview.mockImplementation(async (_med, _id, input) =>
    courseReview(input, {
      expected_version: 1,
      requires_revision: true,
      material_changes: ['schedule'],
    })
  );
  setup('edit');
  review();
  await screen.findByText(/These changes require a new revision/);
  expect(screen.getByRole('button', { name: 'Confirm course' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Revise course' }));
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-11-16');
  expect(mockEdit).not.toHaveBeenCalled();
});
it('requires an explicit resume/reopen before revising a paused delivered course', async () => {
  const c = courseFixture();
  c.revisions[0]!.status = 'paused';
  mockReview.mockImplementation(async (_m, _i, input) =>
    courseReview(input, { expected_version: 1, requires_revision: true })
  );
  setup('edit', c);
  review();
  await screen.findByText(/Resume or reopen the current tip explicitly/);
  expect(
    screen.queryByRole('button', { name: 'Revise course' })
  ).not.toBeInTheDocument();
  expect(mockEdit).not.toHaveBeenCalled();
});
it('adopts carried phases as editable values and fingerprints the final explicit re-review', async () => {
  const c = courseFixture();
  c.revisions[0]!.steps = [
    {
      id: courseIds.step,
      user_id: courseIds.owner,
      revision_id: courseIds.revision,
      step_index: 0,
      dose: '250',
      dose_unit: 'mcg',
      duration_days: 14,
      notes: null,
    },
  ];
  let reviews = 0;
  mockReview.mockImplementation(async (_m, _i, input) =>
    courseReview(input, {
      expected_version: 1,
      review_fingerprint: `review-${++reviews}`,
      resumed_dose: '250',
      resumed_dose_unit: 'mcg',
      carried_steps: [
        { dose: '250', dose_unit: 'mcg', duration_days: 7, notes: null },
      ],
      phase_progress_known: true,
    })
  );
  setup('revise', c);
  review();
  await screen.findByText(/Remaining phases copied/);
  expect(
    screen.getByLabelText('Phase 1 duration in days (blank is open-ended)')
  ).toHaveValue(7);
  expect(
    screen.queryByRole('button', { name: 'Confirm course' })
  ).not.toBeInTheDocument();
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(screen.getByText(/Proposed resumed dose/)).toHaveTextContent(
    '250 mcg'
  );
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await waitFor(() => expect(mockRevise).toHaveBeenCalled());
  expect(mockRevise.mock.calls[0]![1]).toMatchObject({
    review_fingerprint: 'review-2',
    steps: [{ dose: '250', dose_unit: 'mcg', duration_days: 7, notes: null }],
  });
});
it('permits a backdated successor strictly after old start without imposing today as minimum', async () => {
  setup('revise');
  expect(screen.getByLabelText('Start date')).toHaveAttribute(
    'min',
    '2026-11-02'
  );
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-11-02' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2].start_date).toBe('2026-11-02');
});
it('ignores a late review after the active profile becomes invalid', async () => {
  let resolve!: (value: MedicationCourseReview) => void;
  mockReview.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  setup();
  review();
  await waitFor(() => expect(mockReview).toHaveBeenCalled());
  const input = mockReview.mock.calls[0]![2];
  mockCurrent = false;
  await act(async () => resolve(courseReview(input)));
  expect(
    screen.queryByRole('button', { name: 'Confirm course' })
  ).not.toBeInTheDocument();
  expect(mockCreate).not.toHaveBeenCalled();
});
it('keeps multiple separately authored schedule rules in the reviewed rule array', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  fireEvent.change(screen.getByLabelText('Rule 1 dose override'), {
    target: { value: '0.2' },
  });
  fireEvent.change(screen.getByLabelText('Rule 2 dose override'), {
    target: { value: '0.3' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2].rules).toMatchObject([
    { schedule_type_id: 'daily', dose_amount: '0.2' },
    { schedule_type_id: 'daily', dose_amount: '0.3' },
  ]);
  expect(mockCreate).not.toHaveBeenCalled();
});
it('preserves a nullable global cycle anchor and each original rule anchor when revising', async () => {
  const course = courseFixture();
  const revision = course.revisions[0]!;
  revision.cycle_anchor_date = null;
  revision.rules[0] = {
    ...revision.rules[0]!,
    schedule_type_id: 'cyclic',
    cycle_on_days: 3,
    cycle_off_days: 4,
    anchor_date: '2026-10-01',
  };
  setup('revise', course);
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).toMatchObject({
    start_date: '2026-11-16',
    cycle_anchor_date: null,
    rules: [{ anchor_date: '2026-10-01' }],
  });
});

it('shows reviewed effective cyclic dates with heterogeneous anchors, resolved defaults and global precedence', async () => {
  const course = courseFixture();
  const revision = course.revisions[0]!;
  const base = {
    ...revision.rules[0]!,
    schedule_type_id: 'cyclic' as const,
    cycle_on_days: 3,
    cycle_off_days: 4,
  };
  revision.rules = [
    { ...base, anchor_date: '2026-10-01', start_date: '2026-09-01' },
    { ...base, anchor_date: null, start_date: '2026-10-02' },
    { ...base, anchor_date: null, start_date: null },
    { ...base, anchor_date: null, start_date: null },
  ];
  mockReview.mockImplementation(async (_med, _id, input) => {
    const result = courseReview(input, {
      expected_version: input.expected_version,
    });
    // The server normalizes a preserved legacy effective anchor into its review.
    result.plan.rules[2]!.anchor_date = '2020-01-01';
    return result;
  });
  const view = setup('edit', course);
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  for (const day of ['2026-10-01', '2026-10-02', '2020-01-01', '2026-11-01'])
    expect(
      screen.getByText(`Formatted ${day}`, { exact: false })
    ).toBeInTheDocument();
  expect(screen.getAllByText(/Effective cycle date/)).toHaveLength(4);
  view.unmount();
  revision.cycle_anchor_date = '2026-08-01';
  setup('edit', course);
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(screen.getAllByText(/Formatted 2026-08-01/)).toHaveLength(4);
  expect(screen.queryByText(/Formatted 2020-01-01/)).not.toBeInTheDocument();
});

it('retains a deleted explicit device until an explicit preferred choice, without selecting the first saved device', async () => {
  const course = courseFixture();
  course.revisions[0]!.device_choice = 'explicit';
  course.revisions[0]!.device_id = null;
  mockDevices.syringes = [
    { id: courseIds.rule, name: 'First device', device_type: 'syringe' },
  ];
  setup('edit', course, { ...courseMedication, type_id: 'injection' });
  expect(
    screen.getByRole('combobox', { name: 'Forecast device (optional)' })
  ).toHaveTextContent('Missing saved device');
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).not.toHaveProperty('device_id');
  expect(screen.getByText(/Device basis:/)).toHaveTextContent(
    'No usable saved device'
  );
});
it('reviews the authoritative named preferred device without adding an inferred plan binding', async () => {
  mockDevices.syringes = [
    { id: courseIds.rule, name: 'First device', device_type: 'syringe' },
    { id: courseIds.legacy, name: 'Preferred example', device_type: 'pen' },
    { id: courseIds.step, name: 'Nasal only', device_type: 'pump' },
  ];
  mockDevices.default_syringe_id = courseIds.legacy;
  mockReview.mockImplementation(async (_med, _id, input) =>
    courseReview(input, {
      device_binding: {
        choice: 'preferred',
        device_id: courseIds.legacy,
        device_name: 'Preferred example',
        source: 'preferred',
      },
    })
  );
  setup('create', courseFixture(), {
    ...courseMedication,
    type_id: 'injection',
  });
  expect(
    screen.getByRole('combobox', { name: 'Forecast device (optional)' })
  ).toHaveTextContent('Preferred example');
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).not.toHaveProperty('device_id');
  expect(screen.getByText(/Device basis:/)).toHaveTextContent(
    'Preferred example · Saved preferred device'
  );
});

it('sends explicit null only when the user chooses preferred after a missing explicit selection', async () => {
  const course = courseFixture();
  course.revisions[0]!.device_choice = 'explicit';
  course.revisions[0]!.device_id = null;
  setup('edit', course, { ...courseMedication, type_id: 'injection' });
  fireEvent.pointerDown(
    screen.getByRole('combobox', { name: 'Forecast device (optional)' }),
    { button: 0, ctrlKey: false }
  );
  fireEvent.click(
    await screen.findByRole('option', { name: 'Use saved preferred device' })
  );
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).toHaveProperty('device_id', null);
});
it('offers only route-compatible devices and preserves an explicitly chosen real identifier in review', async () => {
  mockDevices.syringes = [
    { id: courseIds.rule, name: 'Injection device', device_type: 'syringe' },
    { id: courseIds.step, name: 'Saved pump', device_type: 'pump' },
  ];
  setup('create', courseFixture(), {
    ...courseMedication,
    type_id: 'nasal_spray',
  });
  fireEvent.pointerDown(
    screen.getByRole('combobox', { name: 'Forecast device (optional)' }),
    { button: 0, ctrlKey: false }
  );
  expect(
    screen.queryByRole('option', { name: 'Injection device' })
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('option', { name: 'Saved pump' }));
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).toHaveProperty(
    'device_id',
    courseIds.step
  );
});

it('leaves weekly duration fields blank and keeps the daily schedule anchor distinct from the read-only weekly anchor', () => {
  setup();
  expect(screen.getByLabelText('Run for (weeks)')).toHaveValue('');
  expect(screen.getByLabelText('Then break (weeks)')).toHaveValue('');
  expect(
    screen.getByLabelText('Schedule cycle anchor (optional)')
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText('Weekly cycle anchor')
  ).not.toBeInTheDocument();
});
it.each(['0', '-1', '1.5', '2weeks', '1e1', '105'])(
  'rejects invalid weekly duration %s without truncating or posting',
  (value) => {
    setup();
    fireEvent.change(screen.getByLabelText('Run for (weeks)'), {
      target: { value },
    });
    expect(screen.getByLabelText('Run for (weeks)')).toHaveValue(value);
    expect(
      screen.getByRole('button', { name: 'Review changes' })
    ).toBeDisabled();
    expect(mockReview).not.toHaveBeenCalled();
  }
);
it('requires an on-duration for a break and reviews only server-derived weekly dates', async () => {
  mockReview.mockImplementation(async (_med, _id, input) =>
    courseReview(input, {
      cycle_plan_preview: {
        on_weeks: 1,
        off_weeks: 2,
        anchor_date: '2026-10-01',
        planned_stop_date: '2026-10-07',
        next_restart_date: '2026-10-22',
        timezone: 'Pacific/Auckland',
        advisory: true,
      },
    })
  );
  setup();
  fireEvent.change(screen.getByLabelText('Then break (weeks)'), {
    target: { value: '2' },
  });
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Run for (weeks)'), {
    target: { value: '1' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).toMatchObject({
    course_cycle_on_weeks: 1,
    course_cycle_off_weeks: 2,
  });
  expect(screen.getByText('Formatted 2026-10-07')).toBeInTheDocument();
  expect(screen.getByText('Formatted 2026-10-22')).toBeInTheDocument();
  expect(screen.getByText(/Pacific\/Auckland/)).toBeInTheDocument();
  expect(
    screen.getByText(/Saving them does not stop scheduled doses/)
  ).toBeInTheDocument();
});
it('preserves authored weekly metadata on revise while never submitting managed weekly anchor or family state', async () => {
  const course = courseFixture();
  Object.assign(course.revisions[0]!, {
    course_cycle_on_weeks: 3,
    course_cycle_off_weeks: 2,
    course_cycle_anchor_date: '2026-10-01',
    cycle_anchor_date: '2025-01-01',
    phase_family_id: courseIds.revision,
  });
  setup('revise', course);
  expect(screen.getByLabelText('Run for (weeks)')).toHaveValue('3');
  expect(screen.getByLabelText('Then break (weeks)')).toHaveValue('2');
  expect(screen.getByText(/Formatted 2026-10-01/)).toBeInTheDocument();
  expect(screen.getByLabelText('Schedule cycle anchor (optional)')).toHaveValue(
    '2025-01-01'
  );
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  const body = mockReview.mock.calls[0]![2];
  expect(body).toMatchObject({
    course_cycle_on_weeks: 3,
    course_cycle_off_weeks: 2,
    cycle_anchor_date: '2025-01-01',
  });
  expect(body).not.toHaveProperty('course_cycle_anchor_date');
  expect(body).not.toHaveProperty('phase_family_id');
});
it('clears weekly metadata only through explicit blank fields', async () => {
  const course = courseFixture();
  Object.assign(course.revisions[0]!, {
    course_cycle_on_weeks: 3,
    course_cycle_off_weeks: 2,
  });
  setup('edit', course);
  fireEvent.change(screen.getByLabelText('Run for (weeks)'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Then break (weeks)'), {
    target: { value: '' },
  });
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(mockReview.mock.calls[0]![2]).toMatchObject({
    course_cycle_on_weeks: null,
    course_cycle_off_weeks: null,
  });
});

it('sends an explicitly selected same-medication prescription into reviewed plan input without changing dose rules', () => {
  mockRxReady = true;
  setup();
  fireEvent.change(screen.getByLabelText('Prescription (optional)'), {
    target: { value: mockRxId },
  });
  review();
  expect(mockReview.mock.calls[0]![2].prescription_id).toBe(mockRxId);
  expect(mockReview.mock.calls[0]![2].rules).toEqual([
    { schedule_type_id: 'daily', time_of_day: null },
  ]);
});
it('works out the amount per administration for a per-week plan', () => {
  const base = courseFixture();
  setup(
    'edit',
    courseFixture({
      revisions: [
        {
          ...base.revisions[0]!,
          dose_basis: 'per_week',
          target_dose: '1',
          rules: [
            {
              ...base.revisions[0]!.rules[0]!,
              schedule_type_id: 'specific_days',
              days_of_week: [1, 4],
            },
          ],
        },
      ],
    })
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    '≈ 0.5 mg per administration at 2×/week'
  );
});
it('blocks review of a per-week plan with no known weekly frequency, and says why', () => {
  const base = courseFixture();
  setup(
    'edit',
    courseFixture({
      revisions: [
        {
          ...base.revisions[0]!,
          dose_basis: 'per_week',
          rules: [{ ...base.revisions[0]!.rules[0]!, schedule_type_id: 'prn' }],
        },
      ],
    })
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Set a weekly schedule first. Per-week dosing needs a known injection frequency.'
  );
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeDisabled();
});
it('shows the planned last dose and restart as the cycle weeks are typed', () => {
  setup('edit');
  fireEvent.change(screen.getByLabelText('Run for (weeks)'), {
    target: { value: '4' },
  });
  expect(
    screen.getByText(/Planned last dose: Formatted 2026-11-28\./)
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Then break (weeks)'), {
    target: { value: '2' },
  });
  expect(
    screen.getByText(
      /Planned last dose: Formatted 2026-11-28\. The next cycle starts Formatted 2026-12-13\./
    )
  ).toBeInTheDocument();
});
it('shows no per-administration line for a per-administration plan', () => {
  setup('edit');
  expect(screen.queryByText(/per administration at/)).not.toBeInTheDocument();
});
it('seeds a suggested phase advance and keeps it through the review instead of restoring the current phase', async () => {
  const c = courseFixture();
  const step = (
    id: string,
    index: number,
    dose: string,
    days: number | null
  ) => ({
    id,
    user_id: courseIds.owner,
    revision_id: courseIds.revision,
    step_index: index,
    dose,
    dose_unit: 'mg',
    duration_days: days,
    notes: null,
  });
  c.revisions[0]!.steps = [
    step('00000000-0000-4000-8000-0000000000a1', 0, '0.25', 28),
    step('00000000-0000-4000-8000-0000000000a2', 1, '0.5', 28),
    step('00000000-0000-4000-8000-0000000000a3', 2, '1', null),
  ];
  const advance: CourseAdvanceProposal = {
    from_phase: 1,
    to_phase: 2,
    phase_count: 3,
    matched_dose: '0.5',
    matched_dose_unit: 'mg',
    shortened: true,
    steps: [
      { dose: '0.5', dose_unit: 'mg', duration_days: 21, notes: null },
      { dose: '1', dose_unit: 'mg', duration_days: null, notes: null },
    ],
  };
  // The server's own carry-forward would put the plan back on its current phase.
  mockReview.mockImplementation(async (_m, _i, input) =>
    courseReview(input, {
      expected_version: 1,
      review_fingerprint: 'review-advance',
      carried_steps: [
        { dose: '0.25', dose_unit: 'mg', duration_days: 14, notes: null },
        { dose: '0.5', dose_unit: 'mg', duration_days: 28, notes: null },
        { dose: '1', dose_unit: 'mg', duration_days: null, notes: null },
      ],
      phase_progress_known: true,
    })
  );
  setup('revise', c, courseMedication, advance);
  expect(screen.getByTestId('advance-note')).toHaveTextContent(
    'Phase 2 of 3 is loaded because your latest dose matched it. The dose you took counts as the first dose of that phase, so it is one dose shorter. Check the phases and the start date, then review.'
  );
  expect(
    screen.getByLabelText('Phase 1 duration in days (blank is open-ended)')
  ).toHaveValue(21);
  review();
  await screen.findByRole('button', { name: 'Confirm course' });
  expect(screen.queryByText(/Remaining phases copied/)).not.toBeInTheDocument();
  expect(mockReview.mock.calls[0]![2].steps).toEqual(advance.steps);
  acknowledge();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm course' }));
  await waitFor(() => expect(mockRevise).toHaveBeenCalled());
  expect(mockRevise.mock.calls[0]![1]).toMatchObject({
    steps: advance.steps,
  });
});
it('shows no advance note when the revise draft was opened normally', () => {
  setup('revise');
  expect(screen.queryByTestId('advance-note')).not.toBeInTheDocument();
});
function phasedCourse() {
  const c = courseFixture();
  const step = (
    id: string,
    index: number,
    dose: string,
    days: number | null
  ) => ({
    id,
    user_id: courseIds.owner,
    revision_id: courseIds.revision,
    step_index: index,
    dose,
    dose_unit: 'mg',
    duration_days: days,
    notes: null,
  });
  c.revisions[0]!.steps = [
    step('00000000-0000-4000-8000-0000000000b1', 0, '1', 7),
    step('00000000-0000-4000-8000-0000000000b2', 1, '2', 14),
    step('00000000-0000-4000-8000-0000000000b3', 2, '4', null),
  ];
  return c;
}
const phaseDoses = () =>
  [1, 2, 3].map(
    (n) => (screen.getByLabelText(`Phase ${n} dose`) as HTMLInputElement).value
  );
it('moves a phase down and up in the draft, renumbering and disabling the ends', () => {
  setup('edit', phasedCourse());
  expect(phaseDoses()).toEqual(['1', '2', '4']);
  expect(
    screen.getByRole('button', { name: 'Move phase 1 up' })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Move phase 3 down' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move phase 1 down' }));
  expect(phaseDoses()).toEqual(['2', '1', '4']);
  expect(
    screen.getByLabelText('Phase 1 duration in days (blank is open-ended)')
  ).toHaveValue(14);
  fireEvent.click(screen.getByRole('button', { name: 'Move phase 3 up' }));
  expect(phaseDoses()).toEqual(['2', '4', '1']);
  // The open-ended phase is now in the middle: the chart warns that the last is never reached.
  expect(screen.getByText(/never reached/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move phase 3 up' }));
  expect(phaseDoses()).toEqual(['2', '1', '4']);
  expect(refresh).not.toHaveBeenCalled();
  expect(mockEdit).not.toHaveBeenCalled();
  expect(mockRevise).not.toHaveBeenCalled();
});
it('reviews the reordered phases in order and shows the order change', async () => {
  mockReview.mockImplementation(async (_m, _i, input) =>
    courseReview(input, {
      expected_version: input.expected_version,
      material_changes: ['steps'],
      requires_revision: true,
    })
  );
  setup('edit', phasedCourse());
  fireEvent.click(screen.getByRole('button', { name: 'Move phase 1 down' }));
  review();
  await screen.findByText(/Phase order or duration/);
  expect(mockReview.mock.calls[0]![2].steps.map((s) => s.dose)).toEqual([
    '2',
    '1',
    '4',
  ]);
  expect(screen.getByText(/Phase 1: 2 mg · 14 days/)).toBeInTheDocument();
});

describe('blend components across the ladder', () => {
  const blendOf = (): MedicationBlend => ({
    blend_medication_id: courseMedication.id,
    name: 'Example medication',
    components: [
      {
        component_medication_id: '00000000-0000-4000-8000-0000000000a1',
        name: 'Alpha',
        mass_mg: '5',
        source: 'label',
        sort_index: 0,
      },
      {
        component_medication_id: '00000000-0000-4000-8000-0000000000a2',
        name: 'Beta',
        mass_mg: '5',
        source: 'assumed',
        sort_index: 1,
      },
    ],
  });
  const withSteps = (
    steps: Array<{ dose: string; unit: string; days: number | null }>,
    basis: 'per_injection' | 'per_week' = 'per_injection'
  ) => {
    const base = courseFixture();
    return courseFixture({
      revisions: [
        {
          ...base.revisions[0]!,
          dose_basis: basis,
          steps: steps.map((step, index) => ({
            id: courseIds.step,
            user_id: courseIds.owner,
            revision_id: courseIds.revision,
            step_index: index,
            dose: step.dose,
            dose_unit: step.unit,
            duration_days: step.days,
            notes: null,
          })),
        },
      ],
    });
  };

  it('shows the derived per-component table and caption for a blend', () => {
    mockBlends = [blendOf()];
    setup(
      'edit',
      withSteps([
        { dose: '200', unit: 'mcg', days: 14 },
        { dose: '300', unit: 'mcg', days: null },
      ])
    );
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Blend dose');
    expect(table).toHaveTextContent('Alpha (mcg)');
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('1200 mcg100100');
    expect(rows[1]).toHaveTextContent('14 d');
    expect(rows[2]).toHaveTextContent('2300 mcg150150');
    expect(rows[2]).toHaveTextContent('maintenance');
    expect(
      screen.getByText(
        /Component masses are derived from the Example medication vendor ratio \(Assumed\); the blend is one vial — components are not dosed separately\./
      )
    ).toBeInTheDocument();
  });

  it('shows nothing for a medicine that is not a blend', () => {
    setup('edit', withSteps([{ dose: '200', unit: 'mcg', days: null }]));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Blend components across the ladder')
    ).not.toBeInTheDocument();
  });

  it('divides a per-week phase into a per-administration dose first', () => {
    mockBlends = [blendOf()];
    setup(
      'edit',
      withSteps([{ dose: '1400', unit: 'mcg', days: null }], 'per_week')
    );
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('200 mcg100100');
  });

  it('needs the in-use vial concentration for mL, else dashes', () => {
    mockBlends = [blendOf()];
    const plan = withSteps([{ dose: '0.5', unit: 'ml', days: null }]);
    const { unmount } = setup('edit', plan);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('0.5 ml——');
    unmount();
    mockPens = [
      { id: 'p1', status: 'in_use', concentration_mg_ml: 2, opened_at: null },
    ];
    setup('edit', plan);
    // 0.5 mL x 2 mg/mL = 1 mg = 1000 mcg
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('0.5 ml500500');
  });

  it('leaves units doses as dashes, never a guessed number', () => {
    mockBlends = [blendOf()];
    mockPens = [
      { id: 'p1', status: 'in_use', concentration_mg_ml: 2, opened_at: null },
    ];
    setup('edit', withSteps([{ dose: '20', unit: 'units', days: null }]));
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('20 units——');
  });
});

describe('timing set by a stack schedule', () => {
  const stackId = '00000000-0000-4000-8000-0000000000a1';
  const binding = {
    stack: {
      id: stackId,
      name: 'Morning',
      notes: null,
      created_at: '2026-11-19T00:00:00.000Z',
      members: [
        {
          medication_id: courseIds.med,
          name: 'Example medication',
          is_supplement: false,
          is_active: true,
          schedule_status: 'following' as const,
          schedule_bound: true,
        },
      ],
    },
    schedule: {
      schedule_type_id: 'specific_days' as const,
      time_of_day: '20:00',
      days_of_week: [1, 4],
      interval_days: null,
      cycle_on_days: null,
      cycle_off_days: null,
      start_date: null,
      version: 2,
      updated_at: '2026-11-20T00:00:00Z',
    },
  };
  const setupBound = (mode: 'create' | 'edit' = 'create') => {
    const course = courseFixture();
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MedicationCourseEditor
          med={courseMedication}
          today="2026-11-16"
          timezone="Europe/London"
          scope={scope}
          mode={mode}
          stackBinding={{
            stack: { ...binding.stack, schedule: binding.schedule },
            schedule: binding.schedule,
          }}
          {...(mode === 'edit'
            ? { course, revision: course.revisions[0] }
            : {})}
          onClose={close}
          onRefresh={refresh}
        />
      </QueryClientProvider>
    );
  };

  it('shows the banner and locks the timing of a new plan, which starts from the stack', async () => {
    setupBound();
    expect(
      screen.getByText('Timing is set by the Morning stack.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 type')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thu' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.change(screen.getByLabelText('Rule 1 dose override'), {
      target: { value: '3' },
    });
    expect(screen.getByLabelText('Rule 1 dose override')).toHaveValue('3');
    review();
    await screen.findByRole('button', { name: 'Confirm course' });
    expect(mockReview.mock.calls[0]![2].rules[0]).toMatchObject({
      schedule_type_id: 'specific_days',
      days_of_week: [1, 4],
      time_of_day: '20:00',
      dose_amount: '3',
    });
  });

  it('locks timing but not the plan name when editing', () => {
    setupBound('edit');
    expect(
      screen.getByText('Timing is set by the Morning stack.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 type')).toBeDisabled();
    expect(screen.getByLabelText('Course name')).toBeEnabled();
  });

  it('opens the stack schedule from "Change on the stack"', () => {
    setupBound();
    fireEvent.click(
      screen.getByRole('button', { name: 'Change on the stack' })
    );
    expect(
      screen.getByRole('heading', { name: 'Stack schedule' })
    ).toBeInTheDocument();
  });

  it('shows no banner and leaves timing editable without a binding', () => {
    setup();
    expect(screen.queryByText(/Timing is set by/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 type')).toBeEnabled();
  });
});
