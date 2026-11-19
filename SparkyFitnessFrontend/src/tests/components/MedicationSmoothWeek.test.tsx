import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationDetail } from '@/types/medications';
import MedicationSmoothWeek from '@/pages/Medications/MedicationSmoothWeek';

let mockCourses: unknown[] = [];
const mockMove = jest.fn();
jest.mock('@/hooks/Medications/useMedicationCourses', () => ({
  useMedicationCourses: () => ({ data: { courses: mockCourses } }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMoveSchedulesMutation: () => ({ mutate: mockMove, isPending: false }),
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
});

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
