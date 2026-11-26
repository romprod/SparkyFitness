import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type {
  MedicationStack,
  MedicationStackScheduleReview,
  MedicationStackScheduleReviewMember,
} from '@workspace/shared';
import MedicationStackScheduleDialog from '@/pages/Medications/MedicationStackScheduleDialog';

const mockReview = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
jest.mock('@/hooks/Medications/useStackSchedule', () => ({
  useReviewStackScheduleMutation: () => ({
    mutate: mockReview,
    isPending: false,
  }),
  useSaveStackScheduleMutation: () => ({ mutate: mockSave, isPending: false }),
  useClearStackScheduleMutation: () => ({
    mutate: mockClear,
    isPending: false,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timeFormat: 'HH:mm',
    formatDate: (day: string) => `Formatted ${day}`,
  }),
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let uuidCount = 0;
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () =>
        `00000000-0000-4000-9000-${String(++uuidCount).padStart(12, '0')}`,
    },
    configurable: true,
  });
});

const stack = (patch: Partial<MedicationStack> = {}): MedicationStack => ({
  id: id(100),
  name: 'Morning stack',
  notes: null,
  created_at: '2026-11-19T00:00:00.000Z',
  schedule: null,
  members: [
    {
      medication_id: id(1),
      name: 'Alpha',
      is_supplement: false,
      is_active: true,
    },
  ],
  ...patch,
});
const timing = (patch: object = {}) => ({
  schedule_type_id: 'daily',
  time_of_day: null,
  days_of_week: null,
  interval_days: null,
  cycle_on_days: null,
  cycle_off_days: null,
  start_date: null,
  ...patch,
});
const member = (
  n: number,
  name: string,
  patch: Partial<MedicationStackScheduleReviewMember> = {}
): MedicationStackScheduleReviewMember => ({
  medication_id: id(n),
  name,
  action: 'edit',
  current_timing: [timing({ schedule_type_id: 'weekly', days_of_week: [1] })],
  new_timing: timing({ time_of_day: '08:00' }),
  reason: null,
  reason_stack_name: null,
  blockers: [],
  warnings: [],
  needs_ack: false,
  ...patch,
});
const reviewOf = (
  members: MedicationStackScheduleReviewMember[],
  patch: Partial<MedicationStackScheduleReview> = {}
): MedicationStackScheduleReview => ({
  expected_version: 0,
  review_fingerprint: 'fp-1',
  today: '2026-11-26',
  effective_from: '2026-11-26',
  members,
  skipped_member_ids: [],
  ...patch,
});

const setup = (stackPatch: Partial<MedicationStack> = {}) => {
  const onClose = jest.fn();
  render(
    <MedicationStackScheduleDialog
      stack={stack(stackPatch)}
      onClose={onClose}
    />
  );
  return { onClose };
};
/** Let the review succeed with the given result. */
const reviewWith = (result: MedicationStackScheduleReview) =>
  mockReview.mockImplementation((_vars, options) => options.onSuccess(result));
const pick = (option: string) => {
  fireEvent.keyDown(screen.getByLabelText('How often'), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const next = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
const saveButton = () =>
  screen.getByRole('button', { name: 'Save stack schedule' });

beforeEach(() => {
  mockReview.mockReset();
  mockSave.mockReset();
  mockClear.mockReset();
});

it('names the dialog and says who it applies to', () => {
  setup();
  expect(screen.getByRole('dialog')).toHaveTextContent('Stack schedule');
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Applies to every plan in this stack.'
  );
});

it('reviews a daily schedule by default', () => {
  reviewWith(reviewOf([member(1, 'Alpha')]));
  setup();
  next();
  expect(mockReview).toHaveBeenCalledTimes(1);
  expect(mockReview.mock.calls[0]![0]).toEqual({
    id: id(100),
    body: {
      schedule: {
        schedule_type_id: 'daily',
        time_of_day: null,
        days_of_week: null,
        interval_days: null,
        cycle_on_days: null,
        cycle_off_days: null,
        start_date: null,
      },
    },
  });
});

it('specific days needs a weekday before it can be reviewed', () => {
  reviewWith(reviewOf([member(1, 'Alpha')]));
  setup();
  pick('Specific days');
  next();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Choose at least one weekday.'
  );
  expect(mockReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
  expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  next();
  expect(mockReview.mock.calls[0]![0].body.schedule).toMatchObject({
    schedule_type_id: 'specific_days',
    days_of_week: [1, 4],
  });
});

it('every N days starts at 3, needs a start date and an interval of 2 or more', () => {
  reviewWith(reviewOf([member(1, 'Alpha')]));
  setup();
  pick('Every N days');
  expect(screen.getByLabelText('Days between doses')).toHaveValue(3);
  next();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Set a start date for interval / cycle schedules.'
  );
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-12-01' },
  });
  fireEvent.change(screen.getByLabelText('Days between doses'), {
    target: { value: '1' },
  });
  next();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter how many days between doses (2 or more).'
  );
  expect(mockReview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Days between doses'), {
    target: { value: '3' },
  });
  next();
  expect(mockReview.mock.calls[0]![0].body.schedule).toMatchObject({
    schedule_type_id: 'every_n_days',
    interval_days: 3,
    start_date: '2026-12-01',
  });
});

it('a cycle starts at 5 on and 2 off and needs both figures', () => {
  reviewWith(reviewOf([member(1, 'Alpha')]));
  setup();
  pick('Cycle on/off');
  expect(screen.getByLabelText('Days on')).toHaveValue(5);
  expect(screen.getByLabelText('Days off')).toHaveValue(2);
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-12-01' },
  });
  fireEvent.change(screen.getByLabelText('Days off'), {
    target: { value: '' },
  });
  next();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter days on and days off (1 or more each).'
  );
  expect(mockReview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Days off'), {
    target: { value: '2' },
  });
  next();
  expect(mockReview.mock.calls[0]![0].body.schedule).toMatchObject({
    schedule_type_id: 'cyclic',
    cycle_on_days: 5,
    cycle_off_days: 2,
  });
});

it('fills the form from the stack’s current schedule', () => {
  reviewWith(reviewOf([member(1, 'Alpha')], { expected_version: 2 }));
  setup({
    schedule: {
      schedule_type_id: 'specific_days',
      time_of_day: '20:00:00',
      days_of_week: [1, 4],
      interval_days: null,
      cycle_on_days: null,
      cycle_off_days: null,
      start_date: null,
      version: 2,
      updated_at: '2026-11-20T00:00:00Z',
    },
  });
  expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByRole('button', { name: 'Tue' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  next();
  expect(mockReview.mock.calls[0]![0].body.schedule).toMatchObject({
    time_of_day: '20:00',
    days_of_week: [1, 4],
  });
});

describe('review step', () => {
  const members = [
    member(1, 'Alpha'),
    member(2, 'Beta', {
      action: 'unchanged',
      current_timing: [timing({ time_of_day: '08:00' })],
    }),
    member(3, 'Gamma', { action: 'pending', current_timing: null }),
    member(4, 'Delta', {
      action: 'revise',
      current_timing: [
        timing({ schedule_type_id: 'every_n_days', interval_days: 3 }),
      ],
      warnings: ['Doses logged today keep their time.'],
    }),
    member(5, 'Epsilon', { action: 'skipped' }),
  ];

  it('shows today against new, the action and any warning', () => {
    reviewWith(reviewOf(members));
    setup();
    next();
    const row = (name: string) =>
      screen.getByRole('row', { name: new RegExp(name) });
    expect(row('Alpha')).toHaveTextContent('Mon');
    expect(row('Alpha')).toHaveTextContent('Daily at 08:00');
    expect(row('Alpha')).toHaveTextContent('Will change');
    expect(row('Beta')).toHaveTextContent('Same');
    expect(row('Gamma')).toHaveTextContent('No plan yet');
    expect(row('Gamma')).toHaveTextContent('Waiting for a plan');
    expect(row('Delta')).toHaveTextContent('Every 3 days');
    expect(row('Delta')).toHaveTextContent(
      'Will start a new revision on Formatted 2026-11-26'
    );
    expect(row('Delta')).toHaveTextContent(
      'Doses logged today keep their time.'
    );
    expect(row('Epsilon')).toHaveTextContent('Plan finished, left as is');
    expect(
      screen.getByText(/rewrites the timing of 2 plans/)
    ).toHaveTextContent(
      'Saving rewrites the timing of 2 plans. Doses and titration steps stay as they are. Doses already logged and your history stay as they are.'
    );
    expect(screen.getByLabelText('Effective from')).toHaveAttribute(
      'min',
      '2026-11-26'
    );
  });

  it('saves with the review’s version, fingerprint and date', () => {
    reviewWith(reviewOf([member(1, 'Alpha')], { expected_version: 3 }));
    const { onClose } = setup();
    next();
    mockSave.mockImplementation((_vars, options) => options.onSuccess());
    fireEvent.click(saveButton());
    const body = mockSave.mock.calls[0]![0].body;
    expect(body).toMatchObject({
      expected_version: 3,
      review_fingerprint: 'fp-1',
      effective_from: '2026-11-26',
      skipped_member_ids: [],
      acknowledged_member_ids: [],
    });
    expect(body.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for each several-slots acknowledgement before saving', () => {
    reviewWith(
      reviewOf([
        member(1, 'Alpha', { needs_ack: true }),
        member(2, 'Beta', { needs_ack: true }),
      ])
    );
    setup();
    next();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        'Alpha has several slots; the stack schedule replaces them with one'
      )
    );
    expect(saveButton()).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        'Beta has several slots; the stack schedule replaces them with one'
      )
    );
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    expect(mockSave.mock.calls[0]![0].body.acknowledged_member_ids).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('lists blocked members and needs the leave-out confirmation', () => {
    reviewWith(
      reviewOf(
        [
          member(1, 'Alpha'),
          member(2, 'Beta', {
            action: 'blocked',
            reason: 'paused',
            blockers: ['Beta is paused with logged doses.'],
          }),
        ],
        { skipped_member_ids: [id(2)] }
      )
    );
    setup();
    next();
    expect(screen.getByRole('row', { name: /Beta/ })).toHaveTextContent(
      'Left out: Beta is paused with logged doses.'
    );
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Leave these out for now: Beta'));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    expect(mockSave.mock.calls[0]![0].body.skipped_member_ids).toEqual([id(2)]);
  });

  it('reads the review again with the new date when the effective date moves later', () => {
    reviewWith(reviewOf([member(1, 'Alpha')]));
    setup();
    next();
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-12-05' },
    });
    expect(mockReview).toHaveBeenCalledTimes(2);
    expect(mockReview.mock.calls[1]![0].body.effective_from).toBe('2026-12-05');
  });

  it('does not review a date earlier than today', () => {
    reviewWith(reviewOf([member(1, 'Alpha')]));
    setup();
    next();
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-11-01' },
    });
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose today or a later day.'
    );
    expect(saveButton()).toBeDisabled();
  });

  it('keeps the draft and offers a fresh review after a 409', () => {
    reviewWith(reviewOf([member(1, 'Alpha')]));
    setup();
    pick('Specific days');
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }));
    next();
    mockSave.mockImplementationOnce((_vars, options) =>
      options.onError(
        Object.assign(new Error('Refresh and review again.'), { status: 409 })
      )
    );
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh and review again.'
    );
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    expect(mockReview).toHaveBeenCalledTimes(2);
    expect(mockReview.mock.calls[1]![0].body.schedule).toMatchObject({
      schedule_type_id: 'specific_days',
      days_of_week: [5],
    });
    expect(saveButton()).toBeEnabled();
  });

  it('reuses the operation id when the same save is retried', () => {
    reviewWith(reviewOf([member(1, 'Alpha')]));
    setup();
    next();
    mockSave.mockImplementationOnce((_vars, options) =>
      options.onError(new Error('Network down'))
    );
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    fireEvent.click(saveButton());
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave.mock.calls[1]![0].body.operation_id).toBe(
      mockSave.mock.calls[0]![0].body.operation_id
    );
  });
});

describe('removing the schedule', () => {
  const scheduled = {
    schedule: {
      schedule_type_id: 'daily' as const,
      time_of_day: '08:00',
      days_of_week: null,
      interval_days: null,
      cycle_on_days: null,
      cycle_off_days: null,
      start_date: null,
      version: 4,
      updated_at: '2026-11-20T00:00:00Z',
    },
  };

  it('is not offered when the stack has no schedule', () => {
    setup();
    expect(
      screen.queryByRole('button', { name: 'Remove schedule' })
    ).not.toBeInTheDocument();
  });

  it('asks first, then clears with the stored version', () => {
    const { onClose } = setup(scheduled);
    fireEvent.click(screen.getByRole('button', { name: 'Remove schedule' }));
    expect(mockClear).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', {
      name: 'Remove the stack schedule?',
    });
    mockClear.mockImplementation((_vars, options) => options.onSuccess());
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Remove schedule' })
    );
    expect(mockClear.mock.calls[0]![0]).toMatchObject({
      id: id(100),
      body: { expected_version: 4 },
    });
    expect(mockClear.mock.calls[0]![0].body.operation_id).toMatch(
      /^[0-9a-f-]{36}$/
    );
    expect(onClose).toHaveBeenCalled();
  });
});
