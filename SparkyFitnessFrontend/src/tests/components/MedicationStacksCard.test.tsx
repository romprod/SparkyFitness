import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationStacksCard from '@/pages/Medications/MedicationStacksCard';
import {
  useDeleteStackMutation,
  useMedicationStacks,
  useSaveStackMutation,
  useSetupStackMutation,
} from '@/hooks/Medications/useMedicationStacks';
import { useMedications } from '@/hooks/useMedications';

jest.mock('@/hooks/Medications/useMedicationStacks', () => ({
  useMedicationStacks: jest.fn(),
  useDeleteStackMutation: jest.fn(),
  useSaveStackMutation: jest.fn(),
  useSetupStackMutation: jest.fn(),
}));
jest.mock('@/hooks/useMedications', () => ({ useMedications: jest.fn() }));
jest.mock('@/hooks/Medications/useStackSchedule', () => ({
  useReviewStackScheduleMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useSaveStackScheduleMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useClearStackScheduleMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timeFormat: 'HH:mm', formatDate: (d: string) => d }),
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (n: number, name: string, extra: object = {}) => ({
  medication_id: id(n),
  name,
  is_supplement: false,
  is_active: true,
  ...extra,
});
const stack = {
  id: id(100),
  name: 'Morning stack',
  notes: null,
  created_at: '2026-11-19T00:00:00.000Z',
  members: [
    member(1, 'Omega 3', { is_supplement: true }),
    member(2, 'Magnesium', { is_supplement: true }),
    member(3, 'Retatrutide'),
    member(4, 'Vitamin D', { is_supplement: true }),
  ],
};
type Due = { key: string; medication: { id: string }; hard?: boolean };
const dues: Due[] = [
  { key: 'a', medication: { id: id(1) } },
  { key: 'done-b', medication: { id: id(2) } },
  { key: 'c', medication: { id: id(3) }, hard: true },
];

const setup = (
  logDues = jest.fn(async (list: Due[]) => ({
    logged: list.length,
    failed: [] as string[],
  })),
  canWrite = true,
  stacks = [stack]
) => {
  jest.mocked(useMedicationStacks).mockReturnValue({
    scope: { ready: true, isCurrent: () => true, key: ['k'] },
    query: { isError: false },
    data: { stacks },
  } as unknown as ReturnType<typeof useMedicationStacks>);
  jest.mocked(useDeleteStackMutation).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteStackMutation>);
  jest.mocked(useSaveStackMutation).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSaveStackMutation>);
  jest.mocked(useSetupStackMutation).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSetupStackMutation>);
  jest.mocked(useMedications).mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useMedications>);
  render(
    <MedicationStacksCard
      dues={dues}
      isLogged={(d: Due) => d.key.startsWith('done')}
      isSimple={(d: Due) => !d.hard}
      canWrite={canWrite}
      logDues={logDues}
    />
  );
  return logDues;
};

it('shows each member’s state for the day and how many are logged', () => {
  setup();
  const section = screen.getByRole('region', { name: 'Morning stack' });
  expect(section).toHaveTextContent('1 of 3 logged today');
  expect(section).toHaveTextContent(/Omega 3\s*Due/);
  expect(section).toHaveTextContent(/Magnesium\s*Logged/);
  expect(section).toHaveTextContent(/Retatrutide\s*Log separately/);
  expect(section).toHaveTextContent(/Vitamin D\s*Not due today/);
  expect(section).toHaveTextContent(
    'Log separately from its own row: Retatrutide.'
  );
});

it('logs only the doses the stack can log, then reports the result', async () => {
  const logDues = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Log stack (1 dose)' }));
  await waitFor(() => expect(logDues).toHaveBeenCalledTimes(1));
  expect(logDues.mock.calls[0]![0].map((d: Due) => d.key)).toEqual(['a']);
  expect(await screen.findByRole('status')).toHaveTextContent('Logged 1 dose.');
});

it('names anything that failed to log', async () => {
  setup(jest.fn(async (_list: Due[]) => ({ logged: 0, failed: ['Omega 3'] })));
  fireEvent.click(screen.getByRole('button', { name: 'Log stack (1 dose)' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Logged 0 doses. Could not log: Omega 3.'
  );
});

it('has no log button for read-only access and hides when empty', () => {
  setup(undefined, false);
  expect(
    screen.queryByRole('button', { name: /Log stack/ })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'New stack' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Set up a premixed stack' })
  ).not.toBeInTheDocument();
});

it('opens the new-stack dialog from the header', () => {
  setup(undefined, true, []);
  expect(screen.getByText(/No stacks yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New stack' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('New stack');
});

it('opens the premixed stack setup from the header', () => {
  setup(undefined, true, []);
  fireEvent.click(
    screen.getByRole('button', { name: 'Set up a premixed stack' })
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Set up a premixed stack'
  );
});

describe('stack schedule', () => {
  const schedule = (patch: object = {}) => ({
    schedule_type_id: 'daily',
    time_of_day: '08:00',
    days_of_week: null,
    interval_days: null,
    cycle_on_days: null,
    cycle_off_days: null,
    start_date: null,
    version: 1,
    updated_at: '2026-11-20T00:00:00.000Z',
    ...patch,
  });
  const scheduled = (
    patch: object = {},
    members: ReturnType<typeof member>[] = stack.members
  ) => ({ ...stack, schedule: schedule(patch), members });
  const section = () => screen.getByRole('region', { name: 'Morning stack' });

  it('renders a stack without a schedule field exactly as before', () => {
    setup();
    expect(section()).not.toHaveTextContent('Stack schedule');
    expect(
      screen.queryByRole('button', { name: /schedule/i })
    ).not.toBeInTheDocument();
  });

  it('says there is no stack schedule and offers Set schedule', () => {
    setup(undefined, true, [{ ...stack, schedule: null } as typeof stack]);
    expect(section()).toHaveTextContent(
      'Stack schedule: No stack schedule. Each medicine keeps its own.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set schedule' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Applies to every plan in this stack.'
    );
  });

  it('hides the schedule button for read-only access', () => {
    setup(undefined, false, [{ ...stack, schedule: null } as typeof stack]);
    expect(
      screen.queryByRole('button', { name: 'Set schedule' })
    ).not.toBeInTheDocument();
  });

  it.each([
    [{}, 'Daily at 08:00'],
    [
      {
        schedule_type_id: 'specific_days',
        days_of_week: [1, 4],
        time_of_day: '20:00',
      },
      'Mon, Thu at 20:00',
    ],
    [
      {
        schedule_type_id: 'every_n_days',
        interval_days: 3,
        start_date: '2026-12-01',
      },
      'Every 3 days at 08:00 from 1 Dec',
    ],
    [
      {
        schedule_type_id: 'cyclic',
        cycle_on_days: 5,
        cycle_off_days: 2,
        time_of_day: null,
        start_date: '2026-12-01',
      },
      '5 days on, 2 off from 1 Dec',
    ],
  ])('summarises the schedule %j', (patch, text) => {
    setup(undefined, true, [scheduled(patch) as unknown as typeof stack]);
    expect(section()).toHaveTextContent(`Stack schedule: ${text}`);
    expect(
      screen.getByRole('button', { name: 'Edit schedule' })
    ).toBeInTheDocument();
  });

  it('shows how each member relates to the schedule', () => {
    setup(undefined, true, [
      scheduled({}, [
        member(1, 'Omega 3', {
          schedule_status: 'following',
          schedule_bound: true,
        }),
        member(2, 'Magnesium', { schedule_status: 'pending' }),
        member(3, 'Retatrutide', {
          schedule_status: 'not_following',
          schedule_note: 'has_own_schedule',
        }),
        member(4, 'Vitamin D', {
          schedule_status: 'not_following',
          schedule_note: 'follows_other_stack',
          schedule_note_stack_name: 'Evening stack',
        }),
        member(5, 'Zinc', {
          schedule_status: 'not_following',
          schedule_note: 'paused',
        }),
        member(6, 'Iron', {
          schedule_status: 'not_following',
          schedule_note: 'latest_not_applied',
        }),
      ]) as unknown as typeof stack,
    ]);
    const text = section();
    expect(text).toHaveTextContent('Omega 3');
    expect(text).toHaveTextContent('Following');
    expect(text).toHaveTextContent('Waiting for a plan');
    expect(text).toHaveTextContent('Not following: has its own schedule');
    expect(text).toHaveTextContent('Not following: follows Evening stack');
    expect(text).toHaveTextContent('Not following: paused');
    expect(text).toHaveTextContent('Not following the latest schedule');
  });
});
