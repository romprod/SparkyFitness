import { act, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TodayMedications from '@/pages/Medications/TodayMedications';
import type {
  MedicationCourseDue,
  MedicationCourseExpectedSlot,
} from '@workspace/shared';
import type { MedicationEntry, MedicationDetail } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue?: string | Record<string, unknown>,
      options?: Record<string, unknown>
    ) =>
      typeof defaultValue === 'string'
        ? defaultValue.replace(/{{(\w+)}}/g, (_m, name: string) =>
            String(options?.[name] ?? '')
          )
        : _key,
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

let mockTimezone = 'Europe/Berlin';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: mockTimezone,
    timeFormat: 'HH:mm',
    formatTime: () => '',
  }),
}));

// ActiveUserContext reaches useAuth and so better-auth's untransformed ESM
// build; mock the hook instead.
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    hasPermission: () => false,
    activeUserName: 'Test User',
  }),
}));

const mockScope = {
  ready: true,
  canWrite: true,
  ownerId: 'user-1',
  key: 'scope-1',
  isCurrent: () => true,
};
const mockListInjections = jest.fn(async (_id: string) => [] as unknown[]);
let mockSlots: MedicationCourseExpectedSlot[] = [];
let mockFulfilled: MedicationCourseDue['fulfilled_slots'] = [];
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourseDue: () => ({
    scope: mockScope,
    data: { slots: mockSlots, fulfilled_slots: mockFulfilled },
    query: {},
  }),
  useMedicationCourseScope: () => mockScope,
}));
let mockPacks: Array<Record<string, unknown>> = [];
jest.mock('@/hooks/Medications/useMedicationPacks', () => ({
  useMedicationPacks: () => ({
    scope: mockScope,
    query: { isError: false },
    data: { today: '2026-11-18', packs: mockPacks },
  }),
}));
const packFixture = (id: string, status: string, remaining: string) => ({
  id,
  medication_id: 'med-1',
  medication_name: 'Test med',
  label: id === 'p1' ? 'Bottle A' : 'Bottle B',
  unit_label: 'tablets',
  status,
  units_total: '60',
  units_used: '0',
  units_remaining: remaining,
});
const mockPreparedForm = jest.fn();
jest.mock('@/pages/Medications/Glp1LogInjection', () => (props: unknown) => {
  mockPreparedForm(props);
  return <div>Prepared form</div>;
});
jest.mock(
  '@/pages/Medications/MedicationCourseAttributionPicker',
  () =>
    ({ onChange }: { onChange: (value: object) => void }) => (
      <button
        onClick={() => onChange({ course_revision_id: 'explicit-revision' })}
      >
        Change association
      </button>
    )
);
const mockUpdateEntry = jest.fn();
const mockUpdateInjection = jest.fn();
const mockDeleteEntry = jest.fn();
const mockDeleteInjection = jest.fn();
beforeEach(() => {
  mockSlots = [];
  mockFulfilled = [];
  mockScope.canWrite = true;
  mockScope.key = 'scope-1';
  mockCreateEntry.mockReset();
  mockLogInjection.mockReset();
  mockPreparedForm.mockClear();
  mockUpdateEntry.mockReset();
  mockUpdateInjection.mockReset();
  mockDeleteEntry.mockReset();
  mockDeleteInjection.mockReset();
});
const mockCreateEntry = jest.fn();
const mockLogInjection = jest.fn();
let mockIntervalEntries: unknown[] = [];
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: () => ({ data: mockIntervalEntries }),
  useFetchMedicationInjections: () => (id: string) => mockListInjections(id),
  useCreateMedicationEntryMutation: () => ({
    mutate: mockCreateEntry,
    isPending: false,
  }),
  useUpdateMedicationEntryMutation: () => ({
    mutate: mockUpdateEntry,
    isPending: false,
  }),
  useDeleteMedicationEntryMutation: () => ({
    mutate: mockDeleteEntry,
    isPending: false,
  }),
  useLogGlpInjectionEntryMutation: () => ({
    mutate: mockLogInjection,
    isPending: false,
  }),
  useUpdateInjectionEntryMutation: () => ({
    mutate: mockUpdateInjection,
    isPending: false,
  }),
  useDeleteInjectionEntryMutation: () => ({
    mutate: mockDeleteInjection,
    isPending: false,
  }),
}));

// Children with their own data hooks, not under test here.
jest.mock('@/pages/Medications/GlpDailyCheckIn', () => () => null);
jest.mock(
  '@/pages/Medications/Glp1QuickLogDialog',
  () =>
    ({ onConfirm }: { onConfirm: (site: string) => void }) => (
      <button onClick={() => onConfirm('left_thigh')}>Confirm injection</button>
    )
);
jest.mock('@/pages/Medications/MedicationLogCalendar', () => () => null);
jest.mock('@/pages/Medications/MedicationStacksCard', () => () => null);

const medWithDose = (timeOfDay: string): MedicationDetail => ({
  id: 'med-1',
  user_id: 'user-1',
  name: 'Vitamin D',
  display_name: null,
  type_id: 'pill',
  route_id: null,
  strength_value: null,
  strength_unit: null,
  dose_amount: 1,
  dose_unit: 'tablet',
  reason_text: null,
  effectiveness_rating: null,
  color: null,
  icon: null,
  photo_path: null,
  is_active: true,
  is_quick: false,
  is_glp1: false,
  is_supplement: false,
  nutrients: {},
  notes: null,
  source: 'manual',
  custom_fields: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  schedules: [
    {
      id: 'sched-1',
      medication_id: 'med-1',
      schedule_type_id: 'daily',
      time_of_day: timeOfDay,
      dose_amount: null,
      days_of_week: null,
      interval_days: null,
      day_of_month: null,
      cycle_on_days: null,
      cycle_off_days: null,
      prn_reason: null,
      prn_max_per_day: null,
      with_meal: null,
      start_date: '2026-01-01',
      end_date: null,
      active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
});

describe('TodayMedications scheduled doses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTimezone = 'Europe/Berlin';
  });

  // Regression for #3319: on clock-change days scheduled_for was built by
  // adding elapsed hours to local midnight, an hour off the dose's time.
  // In the repeated hour the second occurrence is used, and the missing hour
  // moves forward an hour, as for drink times.
  it.each([
    ['Europe/Berlin', '2026-10-25', '09:30', '2026-10-25T08:30:00.000Z'], // clocks go back
    ['Europe/Berlin', '2026-10-25', '02:30', '2026-10-25T01:30:00.000Z'], // repeated hour
    ['Europe/Berlin', '2026-03-29', '08:00', '2026-03-29T06:00:00.000Z'], // clocks go forward
    ['Europe/Berlin', '2026-03-29', '02:30', '2026-03-29T01:30:00.000Z'], // missing hour
    ['Europe/Berlin', '2026-10-26', '08:00', '2026-10-26T07:00:00.000Z'], // normal day
    ['America/New_York', '2026-11-01', '09:30', '2026-11-01T14:30:00.000Z'], // clocks go back
    ['America/New_York', '2026-03-08', '09:30', '2026-03-08T13:30:00.000Z'], // clocks go forward
    ['America/New_York', '2026-03-08', '02:30', '2026-03-08T07:30:00.000Z'], // missing hour
  ])(
    'in %s on %s logs a %s dose as scheduled for %s',
    (tz, day, timeOfDay, expected) => {
      mockTimezone = tz;
      render(
        <TodayMedications
          selectedDate={day}
          today="2026-12-31"
          meds={[medWithDose(timeOfDay)]}
          entries={[]}
          recentEntries={[]}
          loadingMeds={false}
          loadingEntries={false}
          onSelectDate={jest.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Take' }));

      expect(mockCreateEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule_id: 'sched-1',
          status: 'taken',
          scheduled_for: expected,
        }),
        expect.anything()
      );
    }
  );
});

it('logs a past-day dose at its scheduled time, not at noon UTC', () => {
  mockTimezone = 'Europe/London';
  render(
    <TodayMedications
      selectedDate="2026-11-19"
      today="2026-11-20"
      meds={[medWithDose('21:00')]}
      entries={[]}
      recentEntries={[]}
      loadingMeds={false}
      loadingEntries={false}
      onSelectDate={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Take' }));
  expect(mockCreateEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'taken',
      taken_at: '2026-11-19T21:00:00.000Z',
      entry_date: '2026-11-19',
    }),
    expect.anything()
  );
});

it('deducts a scheduled non-GLP-1 peptide dose with micrograms converted to mg', () => {
  mockLogInjection.mockClear();
  const med = medWithDose('09:00');
  med.type_id = 'injection';
  med.is_glp1 = false;
  med.dose_unit = 'mcg';
  med.dose_amount = 500;
  med.schedules = (med.schedules ?? []).map((s) => ({
    ...s,
    dose_amount: 250,
  }));
  render(
    <TodayMedications
      selectedDate="2026-11-15"
      today="2026-11-15"
      meds={[med]}
      entries={[]}
      recentEntries={[]}
      loadingMeds={false}
      loadingEntries={false}
      onSelectDate={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Take' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm injection' }));
  expect(mockLogInjection).toHaveBeenCalledWith(
    expect.objectContaining({
      medication_id: med.id,
      dose_mg: 0.25,
      deduct_pen: true,
    }),
    expect.anything()
  );
});

describe('pack choice when taking a dose', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPacks = [];
  });
  const renderToday = () =>
    render(
      <TodayMedications
        selectedDate="2026-11-18"
        today="2026-11-18"
        meds={[medWithDose('08:00')]}
        entries={[]}
        recentEntries={[]}
        loadingMeds={false}
        loadingEntries={false}
        onSelectDate={jest.fn()}
      />
    );
  it('sends no pack and shows no picker for a medication without packs', () => {
    renderToday();
    expect(screen.queryByLabelText('Take from')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    expect(mockCreateEntry.mock.calls[0]![0]).not.toHaveProperty('pack_id');
  });
  it('shows what is left in a single pack and leaves the choice automatic', () => {
    mockPacks = [packFixture('p1', 'in_use', '8')];
    renderToday();
    expect(screen.getByText('8 of 60 tablets left')).toBeInTheDocument();
    expect(screen.queryByLabelText('Take from')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    expect(mockCreateEntry.mock.calls[0]![0]).not.toHaveProperty('pack_id');
  });
  it('lets the user pick between several packs and sends the chosen pack', () => {
    mockPacks = [
      packFixture('p1', 'in_use', '8'),
      packFixture('p2', 'sealed', '60'),
    ];
    renderToday();
    fireEvent.change(screen.getByLabelText('Take from'), {
      target: { value: 'p2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'taken', pack_id: 'p2' }),
      expect.anything()
    );
  });
  it('does not offer finished packs', () => {
    mockPacks = [packFixture('p1', 'finished', '0')];
    renderToday();
    expect(screen.queryByText(/tablets left/)).not.toBeInTheDocument();
  });
});

describe('quick injection prompt time', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-10T23:45:30.456Z'));
    mockTimezone = 'Asia/Tokyo';
    mockLogInjection.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  const renderQuick = (selectedDate: string) => {
    const med = medWithDose('09:00');
    med.type_id = 'injection';
    med.dose_unit = 'mg';
    return render(
      <TodayMedications
        selectedDate={selectedDate}
        today="2026-07-11"
        meds={[med]}
        entries={[]}
        recentEntries={[]}
        loadingMeds={false}
        loadingEntries={false}
        onSelectDate={jest.fn()}
      />
    );
  };

  it('captures the current instant when a new current-day prompt opens', () => {
    renderQuick('2026-07-11');
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    jest.setSystemTime(new Date('2026-07-11T00:10:00Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm injection' }));
    expect(mockLogInjection).toHaveBeenCalledWith(
      expect.objectContaining({
        injected_at: '2026-07-10T23:45:30.456Z',
        entry_date: '2026-07-11',
      }),
      expect.anything()
    );
  });

  // The 09:00 schedule on that day in Tokyo is 00:00 UTC the same calendar date.
  it('preserves a deliberately selected historical calendar day', () => {
    renderQuick('2026-07-08');
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm injection' }));
    expect(mockLogInjection).toHaveBeenCalledWith(
      expect.objectContaining({
        injected_at: '2026-07-08T00:00:00.000Z',
        entry_date: '2026-07-08',
      }),
      expect.anything()
    );
  });
});

const managedSlot = (): MedicationCourseExpectedSlot => ({
  course_id: 'course-1',
  medication_id: 'med-1',
  schedule_type_id: 'daily',
  course_revision_id: 'revision-1',
  course_rule_id: 'rule-1',
  course_step_id: null,
  course_slot_key: 'slot-1',
  course_expected_version: 3,
  scheduled_day: '2026-07-08',
  scheduled_for: '2026-07-08T07:00:00.000Z',
  time_of_day: '09:00',
  per_dose_amount: null,
  authored_dose: '5',
  dose_unit: 'mg',
  dose_basis: 'per_week',
  phase_progress_known: false,
});
const loggedEntry = (): MedicationEntry => ({
  id: 'entry-1',
  medication_id: 'med-1',
  user_id: 'user-1',
  schedule_id: 'sched-1',
  status: 'taken',
  taken_at: '2026-07-08T07:00:30.456Z',
  scheduled_for: null,
  entry_date: '2026-07-08',
  med_name_snapshot: 'Vitamin D',
  dose_amount_snapshot: 1,
  dose_unit_snapshot: 'tablet',
  notes: 'original',
  source: 'manual',
  custom_fields: {},
  created_at: '',
  updated_at: '',
});
const renderManaged = (
  med = medWithDose('09:00'),
  entries: MedicationEntry[] = []
) =>
  render(
    <TodayMedications
      selectedDate="2026-07-08"
      today="2026-07-11"
      meds={[med]}
      entries={entries}
      recentEntries={[]}
      loadingMeds={false}
      loadingEntries={false}
      onSelectDate={jest.fn()}
    />
  );

describe('managed Today checklist', () => {
  beforeEach(() => {
    mockTimezone = 'Asia/Tokyo';
    mockSlots = [managedSlot()];
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-10T23:45:30.456Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('combines canonical slots with legacy dues without giving a legacy actual managed credit', () => {
    renderManaged(medWithDose('09:00'), [loggedEntry()]);
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(1);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('5 mg')).not.toBeInTheDocument();
  });

  it('credits an exact managed actual only to its managed slot', () => {
    renderManaged(medWithDose('09:00'), [
      {
        ...loggedEntry(),
        schedule_id: null,
        course_origin: true,
        course_revision_id: 'revision-1',
        course_rule_id: 'rule-1',
        course_step_id: null,
        course_slot_key: 'slot-1',
        scheduled_day: '2026-07-08',
      },
    ]);
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(1);
  });

  it('does not map a managed slot to a medication belonging to another profile', () => {
    const med = medWithDose('09:00');
    med.user_id = 'other-owner';
    renderManaged(med);
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take' })).toHaveLength(1);
  });

  it.each(['entry', 'injection'] as const)(
    'credits server-verified cross-day %s fulfilment without adding it to the selected-day activity log',
    (source_kind) => {
      mockFulfilled = [
        {
          course_revision_id: 'revision-1',
          course_rule_id: 'rule-1',
          course_slot_key: 'slot-1',
          scheduled_day: '2026-07-08',
          status: 'taken',
          source_kind,
          entry_id: 'cross-day-actual',
          occurred_at: '2026-07-10T23:45:30.456Z',
          entry_date: '2026-07-11',
        },
      ];
      renderManaged();
      expect(screen.getByText('1/2')).toBeInTheDocument();
      expect(
        screen.getByText('No entries logged yet today.')
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(
        source_kind === 'injection' ? mockDeleteInjection : mockDeleteEntry
      ).toHaveBeenCalledWith('cross-day-actual');
      expect(
        source_kind === 'injection' ? mockDeleteEntry : mockDeleteInjection
      ).not.toHaveBeenCalled();
    }
  );

  it('does not accept an authoritative fulfilment for a different slot key', () => {
    mockFulfilled = [
      {
        course_revision_id: 'revision-1',
        course_rule_id: 'rule-1',
        course_slot_key: 'different-slot',
        scheduled_day: '2026-07-08',
        status: 'taken',
        source_kind: 'entry',
        entry_id: 'other-actual',
        occurred_at: '2026-07-10T23:45:30.456Z',
        entry_date: '2026-07-11',
      },
    ];
    renderManaged();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('confirms actual amount explicitly with Now distinct from a historical expected slot', () => {
    renderManaged();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take' })[1]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Actual amount')).toHaveValue('');
    expect(within(dialog).getByLabelText('Actual unit')).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('Actual amount'), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Actual unit'), {
      target: { value: 'tablet' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm actual dose' })
    );
    const payload = mockCreateEntry.mock.calls[0]![0];
    expect(payload).toMatchObject({
      dose_amount_snapshot: 2,
      dose_unit_snapshot: 'tablet',
      taken_at: '2026-07-10T23:45:30.456Z',
      entry_date: '2026-07-11',
      course_revision_id: 'revision-1',
      course_rule_id: 'rule-1',
      course_step_id: null,
      course_expected_version: 3,
      course_slot_key: 'slot-1',
      scheduled_day: '2026-07-08',
      scheduled_for: '2026-07-08T07:00:00.000Z',
    });
    expect(payload).not.toHaveProperty('schedule_id');
  });

  it('passes only explicit planned target and exact attribution to the prepared logger', () => {
    const med = medWithDose('09:00');
    med.type_id = 'injection';
    med.dose_amount = 99;
    renderManaged(med);
    fireEvent.click(screen.getAllByRole('button', { name: 'Take' })[1]!);
    expect(mockPreparedForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        plannedDose: null,
        courseContext: expect.objectContaining({
          course_rule_id: 'rule-1',
          course_expected_version: 3,
        }),
        initialTakenAt: '2026-07-10T23:45:30.456Z',
      })
    );
    expect(mockCreateEntry).not.toHaveBeenCalled();
    expect(mockLogInjection).not.toHaveBeenCalled();
  });

  it.each(['Skip', 'Snooze'])(
    'attributes managed %s without a fake legacy schedule or actual quantity',
    (action) => {
      renderManaged();
      fireEvent.click(screen.getAllByRole('button', { name: action })[1]!);
      const payload = mockCreateEntry.mock.calls[0]![0];
      expect(payload).toMatchObject({
        course_slot_key: 'slot-1',
        course_expected_version: 3,
        scheduled_day: '2026-07-08',
        scheduled_for: '2026-07-08T07:00:00.000Z',
      });
      expect(payload).not.toHaveProperty('schedule_id');
      expect(payload).not.toHaveProperty('dose_amount_snapshot');
    }
  );

  it('keeps actual draft after a stale conflict and prevents repeat writes', () => {
    mockCreateEntry.mockImplementation((_body, options) =>
      options.onError({ status: 409 })
    );
    renderManaged();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take' })[1]!);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Actual amount'), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Actual unit'), {
      target: { value: 'tablet' },
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Confirm actual dose',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockCreateEntry).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText('Actual amount')).toHaveValue('2');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'course changed'
    );
    expect(confirm).toBeDisabled();
  });

  it('disables managed writes for a read-only delegate', () => {
    mockScope.canWrite = false;
    renderManaged();
    for (const action of ['Take', 'Skip', 'Snooze']) {
      expect(screen.getAllByRole('button', { name: action })[1]).toBeDisabled();
      fireEvent.click(screen.getAllByRole('button', { name: action })[1]!);
    }
    expect(mockCreateEntry).not.toHaveBeenCalled();
    expect(mockLogInjection).not.toHaveBeenCalled();
  });
});

describe('Today history explicit association', () => {
  it.each(['entry', 'injection'] as const)(
    'omits untouched time, calendar day and course fields for a %s metadata edit',
    (entry_type) => {
      renderManaged(medWithDose('09:00'), [{ ...loggedEntry(), entry_type }]);
      fireEvent.click(screen.getByRole('button', { name: 'Edit entry time' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const payload = (
        entry_type === 'injection' ? mockUpdateInjection : mockUpdateEntry
      ).mock.calls[0]![0].body;
      expect(payload).not.toHaveProperty('taken_at');
      expect(payload).not.toHaveProperty('injected_at');
      expect(payload).not.toHaveProperty('entry_date');
      expect(payload).not.toHaveProperty('course_revision_id');
    }
  );
  it('adds attribution only after an explicit picker change', () => {
    renderManaged(medWithDose('09:00'), [loggedEntry()]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit entry time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change association' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockUpdateEntry.mock.calls[0]![0].body).toMatchObject({
      course_revision_id: 'explicit-revision',
    });
  });
});

it('keeps history association draft after a stale response and prevents repeated update', () => {
  mockUpdateEntry.mockImplementation((_body, options) =>
    options.onError({ status: 409 })
  );
  renderManaged(medWithDose('09:00'), [loggedEntry()]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit entry time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change association' }));
  const save = screen.getByRole('button', { name: 'Save' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(mockUpdateEntry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('course changed');
});

describe('minimum interval and missed-dose policy', () => {
  const NOW = new Date('2026-12-31T15:00:00Z');
  const renderToday = (fields: Record<string, unknown>) => {
    const med = medWithDose('09:00');
    med.custom_fields = fields;
    return render(
      <TodayMedications
        selectedDate="2026-12-31"
        today="2026-12-31"
        meds={[med]}
        entries={[]}
        recentEntries={[]}
        loadingMeds={false}
        loadingEntries={false}
        onSelectDate={jest.fn()}
      />
    );
  };
  const takenAt = (iso: string) => [
    { medication_id: 'med-1', status: 'taken', taken_at: iso },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockTimezone = 'Europe/Berlin';
    mockIntervalEntries = [];
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => jest.useRealTimers());

  it('asks before logging a dose inside the minimum interval, then logs on confirm', () => {
    mockIntervalEntries = takenAt('2026-12-31T12:00:00Z');
    renderToday({ min_interval_hours: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    expect(mockCreateEntry).not.toHaveBeenCalled();
    expect(
      screen.getByText('Log Vitamin D sooner than planned?')
    ).toBeInTheDocument();
    expect(screen.getByText(/The last dose was 3 h ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log anyway' }));
    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'taken', schedule_id: 'sched-1' }),
      expect.anything()
    );
  });

  it("reads an injectable's last dose from its injections, which are stored apart", async () => {
    mockListInjections.mockResolvedValue([
      { injected_at: '2026-12-31T12:00:00Z' },
    ]);
    const med = medWithDose('09:00');
    med.type_id = 'injection';
    med.is_glp1 = false;
    med.custom_fields = { min_interval_hours: 24 };
    render(
      <TodayMedications
        selectedDate="2026-12-31"
        today="2026-12-31"
        meds={[med]}
        entries={[]}
        recentEntries={[]}
        loadingMeds={false}
        loadingEntries={false}
        onSelectDate={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText('Log Vitamin D sooner than planned?')
    ).toBeInTheDocument();
    expect(mockListInjections).toHaveBeenCalledWith('med-1');
  });

  it('logs straight away once the interval has passed or none is set', () => {
    mockIntervalEntries = takenAt('2026-12-30T10:00:00Z');
    renderToday({ min_interval_hours: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    expect(mockCreateEntry).toHaveBeenCalledTimes(1);
  });

  it('never blocks skipping a dose', () => {
    mockIntervalEntries = takenAt('2026-12-31T12:00:00Z');
    renderToday({ min_interval_hours: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(mockCreateEntry).toHaveBeenCalledTimes(1);
  });

  it('reminds about the missed-dose policy on an overdue dose, and only for skip or take now', () => {
    const { unmount } = renderToday({ missed_policy: 'skip' });
    expect(
      screen.getByText(
        'Overdue by 7 h. You set this medication to skip a missed dose.'
      )
    ).toBeInTheDocument();
    unmount();
    renderToday({ missed_policy: 'take_now' });
    expect(
      screen.getByText(/take a missed dose when you notice/)
    ).toBeInTheDocument();
  });

  it('shows no reminder with the default ask policy', () => {
    renderToday({});
    expect(screen.queryByText(/Overdue by/)).not.toBeInTheDocument();
  });
});
