import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MedicationMonthCalendar from '@/pages/Medications/MedicationMonthCalendar';
import type { Medication, MedicationEntry } from '@/types/medications';

let mockEntries: Partial<MedicationEntry>[] = [];
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    firstDayOfWeek: 1,
    formatDate: (day: string) => day,
  }),
}));
jest.mock('@/hooks/useMedications', () => ({
  useMedicationEntries: () => ({ data: mockEntries }),
}));
jest.mock('@/hooks/useSymptoms', () => ({
  useSymptomEntries: () => ({ data: [] }),
}));

const schedule = (type: string, extra: object = {}) => ({
  id: `s-${type}`,
  schedule_type_id: type,
  active: true,
  start_date: '2026-11-01',
  ...extra,
});
const med = (id: string, name: string, schedules: object[], extra = {}) =>
  ({
    id,
    name,
    display_name: null,
    is_active: true,
    is_supplement: false,
    schedules,
    ...extra,
  }) as unknown as Medication;

beforeEach(() => {
  mockEntries = [];
  jest.useFakeTimers().setSystemTime(new Date('2026-11-19T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

const renderMonth = (medications: Medication[]) =>
  render(
    <MedicationMonthCalendar
      medications={medications}
      selectedDate="2026-11-19"
      onSelectDate={jest.fn()}
    />
  );

it('marks every upcoming day a schedule is due, and none up to today', () => {
  renderMonth([med('a', 'Sertraline', [schedule('daily')])]);
  // Monday-first grid for November 2026 runs 26 Oct to 6 Dec: 20 Nov to 6 Dec is 17 days.
  expect(screen.getAllByTitle('1 planned')).toHaveLength(17);
  expect(screen.getByText('Planned')).toBeInTheDocument();
});

it('marks only the days a weekly schedule falls on, with the count for several items', () => {
  renderMonth([
    med('a', 'Retatrutide', [schedule('weekly', { days_of_week: [6] })]),
    med('b', 'Omega 3', [schedule('weekly', { days_of_week: [6] })]),
  ]);
  const marked = screen.getAllByTitle('2 planned');
  // Saturdays after the 19th within the grid: 21 Nov, 28 Nov, 5 Dec.
  expect(marked.map((cell) => cell.textContent)).toEqual(['21', '28', '5']);
});

it('leaves out as-needed items and inactive medications', () => {
  renderMonth([
    med('a', 'Hydro', [schedule('prn')]),
    med('b', 'Stopped', [schedule('daily')], { is_active: false }),
  ]);
  expect(screen.queryByTitle(/planned/)).not.toBeInTheDocument();
});

it('does not mark a day that already has a logged dose', () => {
  mockEntries = [
    {
      id: 'e',
      medication_id: 'a',
      status: 'taken',
      entry_date: '2026-11-21',
      taken_at: '2026-11-21T09:00:00Z',
    },
  ];
  renderMonth([med('a', 'Sertraline', [schedule('daily')])]);
  expect(screen.getAllByTitle('1 planned')).toHaveLength(16);
});
