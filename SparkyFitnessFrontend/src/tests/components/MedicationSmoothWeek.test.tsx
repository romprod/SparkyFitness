import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationDetail } from '@/types/medications';
import MedicationSmoothWeek from '@/pages/Medications/MedicationSmoothWeek';

let mockCourses: unknown[] = [];
const mockMove = jest.fn();
const mockMoveHook = jest.fn();
const mockMoveAsync = jest.fn();
const mockPin = jest.fn();
const mockUnpin = jest.fn();
const mockRefresh = jest.fn();
let mockPinned: string[] = [];
let mockWeek: unknown = undefined;
let mockWeekError = false;
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourses: () => ({ data: { courses: mockCourses } }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMoveSchedulesMutation: (options?: unknown) => {
    mockMoveHook(options);
    return {
      mutate: mockMove,
      mutateAsync: mockMoveAsync,
      isPending: false,
    };
  },
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: () => ({
    data: mockWeek,
    query: { isError: mockWeekError },
  }),
}));
jest.mock('@/hooks/Medications/useSmoothWeekPins', () => ({
  useSmoothWeekPins: () => ({ pinnedIds: new Set(mockPinned) }),
  usePinSmoothWeekMedication: () => ({ mutate: mockPin, isPending: false }),
  useUnpinSmoothWeekMedication: () => ({
    mutate: mockUnpin,
    isPending: false,
  }),
  useRefreshSmoothWeek: () => mockRefresh,
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'UTC', formatDate: (d: string) => d }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        fallback
      ),
  }),
}));
// Wednesday 18 Nov 2026, so the coming week starts Monday 23 Nov.
jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));

const med = (
  id: string,
  name: string,
  schedules: Partial<MedicationDetail['schedules'][number]>[],
  over: Partial<MedicationDetail> = {}
) =>
  ({
    id,
    name,
    display_name: null,
    type_id: 'injection',
    is_active: true,
    schedules: schedules.map((s, i) => ({
      id: `${id}-${i}`,
      medication_id: id,
      active: true,
      start_date: null,
      end_date: null,
      days_of_week: null,
      interval_days: null,
      day_of_month: null,
      cycle_on_days: null,
      cycle_off_days: null,
      ...s,
    })),
    ...over,
  }) as unknown as MedicationDetail;
const weekly = (...days: number[]) => ({
  schedule_type_id: 'weekly',
  days_of_week: days,
});

beforeEach(() => {
  mockCourses = [];
  mockMove.mockReset();
  mockMoveHook.mockReset();
  mockMoveAsync.mockReset();
  mockMoveAsync.mockResolvedValue({});
  mockPin.mockReset();
  mockUnpin.mockReset();
  mockRefresh.mockReset();
  mockRefresh.mockResolvedValue(undefined);
  mockPinned = [];
  mockWeek = undefined;
  mockWeekError = false;
});

const courseFor = (medicationId: string) => ({
  deleted_at: null,
  medication_id: medicationId,
  current_revision_id: 'r1',
  revisions: [{ id: 'r1', status: 'active' }],
});
const slot = (medicationId: string, day: string, status = 'planned') => ({
  id: `${medicationId}-${day}`,
  medication_id: medicationId,
  scheduled_day: day,
  status,
});
const threeAlike = () => [
  med('a', 'Alpha', [weekly(6)]),
  med('b', 'Beta', [weekly(6)]),
  med('c', 'Gamma', [weekly(6)]),
];

it('renders nothing without a scheduled injectable', () => {
  const { container } = render(
    <MedicationSmoothWeek
      medications={[
        med('t', 'Tablet', [weekly(1)], { type_id: 'tablet' }),
        med('i', 'Idle', []),
      ]}
    />
  );
  expect(container).toBeEmptyDOMElement();
});

it('shows the week and suggests moving one of two weekly injections that share a day', () => {
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [weekly(6)]),
        med('b', 'Beta', [weekly(6)]),
      ]}
    />
  );
  expect(screen.getByText('Week of 2026-11-23')).toBeInTheDocument();
  const current = screen.getByRole('group', {
    name: 'Doses per day this plan',
  });
  expect(within(current).getByText('2')).toBeInTheDocument();
  const after = screen.getByRole('group', {
    name: 'Doses per day after moves',
  });
  expect(within(after).queryByText('2')).not.toBeInTheDocument();
  expect(screen.getAllByText(/→/)).toHaveLength(1);
  expect(
    screen.getByText(/Nothing changes until you apply a move/)
  ).toBeInTheDocument();
});

it('says the week is flat, and notes medications it will not move', () => {
  mockCourses = [
    {
      deleted_at: null,
      medication_id: 'c',
      current_revision_id: 'r1',
      revisions: [{ id: 'r1', status: 'active' }],
    },
  ];
  mockWeek = { planned_slots: [] };
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [weekly(6)]),
        med('c', 'Courseman', [weekly(2)]),
        med('d', 'Daily', [{ schedule_type_id: 'daily' }]),
      ]}
    />
  );
  expect(screen.getByText(/already as flat as/)).toBeInTheDocument();
  expect(
    screen.getByText(/Courseman — follows a course plan, not moved here/)
  ).toBeInTheDocument();
  expect(screen.getByText(/Daily — not a weekly pattern/)).toBeInTheDocument();
  // Daily counts on every day: a single weekly dose cannot be made flatter than that.
  const current = screen.getByRole('group', {
    name: 'Doses per day this plan',
  });
  expect(within(current).getAllByText('1').length).toBeGreaterThanOrEqual(6);
});

it('applies a suggested move only after confirming it', () => {
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [weekly(6)]),
        med('b', 'Beta', [weekly(6)]),
      ]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(mockMove).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/Move (Alpha|Beta)\?/)).toBeInTheDocument();
  expect(within(dialog).getByText(/From 2026-11-23/)).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Move schedule' })
  );
  expect(mockMove).toHaveBeenCalledTimes(1);
  const [call] = mockMove.mock.calls[0]!;
  expect(call).toMatchObject({
    body: {
      end_date: '2026-11-22',
      new_start_date: '2026-11-23',
      rotate_days: expect.any(Number),
    },
  });
  expect(['a', 'b']).toContain(call.medicationId);
  expect(call.body.schedule_ids).toEqual([`${call.medicationId}-0`]);
});

it('does not move anything when the confirmation is cancelled', () => {
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [weekly(6)]),
        med('b', 'Beta', [weekly(6)]),
      ]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockMove).not.toHaveBeenCalled();
});

it('ignores a rule that ended before the coming week, so a moved schedule is still offered', () => {
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [
          { ...weekly(6), end_date: '2026-11-22' },
          { ...weekly(1), start_date: '2026-11-23' },
        ]),
        med('b', 'Beta', [weekly(1)]),
      ]}
    />
  );
  expect(screen.queryByText(/ends within a week/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/→/)).toHaveLength(1);
});

it('offers no Apply for a medication with a rule that starts later', () => {
  render(
    <MedicationSmoothWeek
      medications={[
        med('a', 'Alpha', [weekly(6)]),
        med('b', 'Beta', [{ ...weekly(6), start_date: '2026-11-23' }]),
      ]}
    />
  );
  expect(screen.getAllByText(/→/)).toHaveLength(1);
});

describe('course-managed medicines', () => {
  it('counts their planned slots as fixed doses, and shows the panel when every injection is managed', () => {
    mockCourses = [courseFor('c')];
    mockWeek = {
      planned_slots: [
        slot('c', '2026-11-24'),
        slot('c', '2026-11-27', 'pending'),
        slot('c', '2026-11-28', 'taken'),
        slot('other', '2026-11-24'),
      ],
    };
    render(
      <MedicationSmoothWeek
        medications={[med('c', 'Courseman', [weekly(2)])]}
      />
    );
    const current = screen.getByRole('group', {
      name: 'Doses per day this plan',
    });
    expect(within(current).getAllByText('1')).toHaveLength(3);
    expect(
      screen.getByText(/Courseman — follows a course plan, not moved here/)
    ).toBeInTheDocument();
  });

  it('counts a taken slot today when the coming week starts today, but not a skipped one', () => {
    jest.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    try {
      mockCourses = [courseFor('c')];
      mockWeek = {
        planned_slots: [
          slot('c', '2026-11-23', 'taken'),
          slot('c', '2026-11-25', 'missed'),
          slot('c', '2026-11-27', 'skipped'),
        ],
      };
      render(
        <MedicationSmoothWeek
          medications={[med('c', 'Courseman', [weekly(1)])]}
        />
      );
      expect(screen.getByText('Week of 2026-11-23')).toBeInTheDocument();
      const current = screen.getByRole('group', {
        name: 'Doses per day this plan',
      });
      expect(within(current).getAllByText('1')).toHaveLength(2);
    } finally {
      jest.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    }
  });

  it('shows no numbers while the week is loading', () => {
    mockCourses = [courseFor('c')];
    render(
      <MedicationSmoothWeek
        medications={[med('c', 'Courseman', [weekly(2)])]}
      />
    );
    expect(screen.getByText(/Loading the coming week/)).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Doses per day this plan' })
    ).not.toBeInTheDocument();
  });
});

describe('keep as is', () => {
  it('pins a medicine from its suggested move', () => {
    render(
      <MedicationSmoothWeek
        medications={[
          med('a', 'Alpha', [weekly(6)]),
          med('b', 'Beta', [weekly(6)]),
        ]}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep as is' })[0]!);
    expect(mockPin).toHaveBeenCalledTimes(1);
    expect(['a', 'b']).toContain(mockPin.mock.calls[0]![0]);
  });

  it('lists a pinned medicine as kept, counts it, never moves it, and can include it again', () => {
    mockPinned = ['b'];
    render(
      <MedicationSmoothWeek
        medications={[
          med('a', 'Alpha', [weekly(6)]),
          med('b', 'Beta', [weekly(6)]),
        ]}
      />
    );
    expect(screen.getByText('Kept as is (1)')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // Beta stays on Saturday; Alpha is the only movable and can move off it.
    expect(screen.getAllByText(/Alpha: .* → /)).toHaveLength(1);
    expect(screen.queryByText(/Beta: .* → /)).not.toBeInTheDocument();
    const current = screen.getByRole('group', {
      name: 'Doses per day this plan',
    });
    expect(within(current).getByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Include again' }));
    expect(mockUnpin).toHaveBeenCalledWith('b');
  });
});

describe('apply all', () => {
  it('is not offered for a single move', () => {
    render(
      <MedicationSmoothWeek
        medications={[
          med('a', 'Alpha', [weekly(6)]),
          med('b', 'Beta', [weekly(6)]),
        ]}
      />
    );
    expect(screen.queryByText(/Apply all/)).not.toBeInTheDocument();
  });

  it('applies every move in order after one confirmation and refreshes once', async () => {
    render(<MedicationSmoothWeek medications={threeAlike()} />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply all \d+ changes/ })
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/From 2026-11-23/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
    expect(mockMoveAsync).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move all schedules' })
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    const calls = mockMoveAsync.mock.calls.map(([c]) => c);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls)
      expect(c.body).toMatchObject({
        end_date: '2026-11-22',
        new_start_date: '2026-11-23',
        rotate_days: expect.any(Number),
        schedule_ids: [`${c.medicationId}-0`],
      });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // Apply all moves through a quiet mutation, so the panel's summary is the only feedback.
    expect(mockMoveHook).toHaveBeenCalledWith({ quiet: true });
    expect(screen.getByRole('status')).toHaveTextContent(/applied/);
  });

  it('continues after a failure and reports which move failed', async () => {
    mockMoveAsync
      .mockRejectedValueOnce(new Error('Schedule changed'))
      .mockResolvedValue({});
    render(<MedicationSmoothWeek medications={threeAlike()} />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply all \d+ changes/ })
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Move all schedules',
      })
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    const total = mockMoveAsync.mock.calls.length;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('status')).toHaveTextContent(
      `Moved ${total - 1} of ${total}.`
    );
    expect(screen.getByRole('status')).toHaveTextContent(/: Schedule changed/);
  });
});

it('draws a before and after grid for each move', () => {
  render(<MedicationSmoothWeek medications={threeAlike()} />);
  const moves = screen.getAllByText(/^(Alpha|Beta|Gamma): .* → /);
  expect(moves.length).toBeGreaterThanOrEqual(2);
  const grids = screen.getAllByRole('group', { name: /: before and after$/ });
  expect(grids).toHaveLength(moves.length);
  for (const grid of grids) {
    expect(within(grid).getByText('Before')).toBeInTheDocument();
    expect(within(grid).getByText('After')).toBeInTheDocument();
    expect(within(grid).getAllByText('1').length).toBeGreaterThanOrEqual(2);
  }
});
