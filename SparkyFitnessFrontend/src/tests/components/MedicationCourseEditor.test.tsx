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
  MedicationCourseReviewInput,
  MedicationCourseReview,
} from '@workspace/shared';
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
jest.mock('@/hooks/useMedications', () => ({
  useMedicationTitration: () => ({ data: [] }),
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
  med = courseMedication
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
  mockCurrent = true;
  mockDevices.syringes = [];
  mockDevices.default_syringe_id = null;
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
