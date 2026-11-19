import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationDetail } from '@/types/medications';
import MedicationScheduleMove from '@/pages/Medications/MedicationScheduleMove';

const mockMove = jest.fn();
let mockEntries: unknown[] = [];
let mockManaged = new Set<string>();
jest.mock('@/hooks/Medications/useManagedMedicationIds', () => ({
  useManagedMedicationIds: () => mockManaged,
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: () => ({ data: mockEntries }),
  useMoveSchedulesMutation: () => ({ mutate: mockMove, isPending: false }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'UTC', formatDate: (d: string) => d }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
        fallback
      ),
  }),
}));
// Wednesday 18 Nov 2026.
jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));

const med = (
  id: string,
  schedule: Record<string, unknown>,
  over: Partial<MedicationDetail> = {}
) =>
  ({
    id,
    name: 'Semaglutide',
    display_name: null,
    is_active: true,
    schedules: [
      {
        id: `${id}-rule`,
        medication_id: id,
        active: true,
        start_date: '2026-10-01',
        end_date: null,
        days_of_week: null,
        interval_days: null,
        ...schedule,
      },
    ],
    ...over,
  }) as unknown as MedicationDetail;
const monday = { schedule_type_id: 'weekly', days_of_week: [1] };
const taken = (medication_id: string, entry_date: string) => ({
  medication_id,
  entry_date,
  status: 'taken',
});

beforeEach(() => {
  mockMove.mockReset();
  mockEntries = [];
  mockManaged = new Set();
  window.localStorage.clear();
});

it('offers to move a weekly schedule after a dose on another day, and moves it on request', () => {
  mockEntries = [taken('m1', '2026-11-18')];
  render(<MedicationScheduleMove medications={[med('m1', monday)]} />);
  expect(screen.getByTestId('schedule-move-banner')).toBeInTheDocument();
  expect(
    screen.getByText(/Semaglutide was taken on Wed 2026-11-18/)
  ).toBeInTheDocument();
  expect(screen.getByText(/from Mon to Wed/)).toBeInTheDocument();
  expect(screen.getByText(/next dose would be 2026-11-25/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move schedule' }));
  expect(mockMove).toHaveBeenCalledWith({
    medicationId: 'm1',
    body: {
      schedule_ids: ['m1-rule'],
      end_date: '2026-11-18',
      new_start_date: '2026-11-19',
      rotate_days: 2,
    },
  });
});

it('offers to count on from the dose for an every-N-days schedule, without a rotation', () => {
  mockEntries = [taken('m1', '2026-11-18')];
  render(
    <MedicationScheduleMove
      medications={[
        med('m1', {
          schedule_type_id: 'every_n_days',
          interval_days: 7,
          start_date: '2026-11-02',
        }),
      ]}
    />
  );
  expect(
    screen.getByText(/off its every 7 days. Count 7 days on from that dose/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move schedule' }));
  expect(mockMove).toHaveBeenCalledWith({
    medicationId: 'm1',
    body: {
      schedule_ids: ['m1-rule'],
      end_date: '2026-11-18',
      new_start_date: '2026-11-25',
    },
  });
});

it('keeps the schedule and does not offer the same dose again', () => {
  mockEntries = [taken('m1', '2026-11-18')];
  const { unmount } = render(
    <MedicationScheduleMove medications={[med('m1', monday)]} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Keep schedule' }));
  expect(mockMove).not.toHaveBeenCalled();
  expect(screen.queryByTestId('schedule-move-banner')).not.toBeInTheDocument();
  unmount();
  render(<MedicationScheduleMove medications={[med('m1', monday)]} />);
  expect(screen.queryByTestId('schedule-move-banner')).not.toBeInTheDocument();
});

it.each([
  ['a dose on the usual day', [taken('m1', '2026-11-16')], monday, undefined],
  [
    'a skipped dose',
    [{ medication_id: 'm1', entry_date: '2026-11-18', status: 'skipped' }],
    monday,
    undefined,
  ],
  [
    'a dose of another medication',
    [taken('other', '2026-11-18')],
    monday,
    undefined,
  ],
  [
    'a daily schedule',
    [taken('m1', '2026-11-18')],
    { schedule_type_id: 'daily' },
    undefined,
  ],
  ['no doses', [], monday, undefined],
  [
    'a medication on a course plan',
    [taken('m1', '2026-11-18')],
    monday,
    new Set(['m1']),
  ],
])('offers nothing for %s', (_name, entries, schedule, managed) => {
  mockEntries = entries;
  mockManaged = managed ?? new Set();
  render(<MedicationScheduleMove medications={[med('m1', schedule)]} />);
  expect(screen.queryByTestId('schedule-move-banner')).not.toBeInTheDocument();
});

it('offers nothing for an inactive medication', () => {
  mockEntries = [taken('m1', '2026-11-18')];
  render(
    <MedicationScheduleMove
      medications={[med('m1', monday, { is_active: false })]}
    />
  );
  expect(screen.queryByTestId('schedule-move-banner')).not.toBeInTheDocument();
});
