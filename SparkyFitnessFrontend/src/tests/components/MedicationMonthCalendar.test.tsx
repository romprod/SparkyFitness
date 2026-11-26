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
let mockMetrics: unknown[] | undefined;
let mockSleep: unknown[] | undefined;
const mockMetricsHook = jest.fn();
const mockSleepHook = jest.fn();
jest.mock('@/hooks/useGenericHealth', () => ({
  useDailyHealthMetrics: (...args: unknown[]) => {
    mockMetricsHook(...args);
    return { data: mockMetrics };
  },
}));
jest.mock('@/hooks/CheckIn/useSleep', () => ({
  useSleepEntriesQuery: (...args: unknown[]) => {
    mockSleepHook(...args);
    return { data: mockSleep };
  },
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
  mockMetrics = undefined;
  mockSleep = undefined;
  mockMetricsHook.mockReset();
  mockSleepHook.mockReset();
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

describe('device figures in the cells', () => {
  const metric = (day: string, steps: number | null) => ({
    entry_date: day,
    source_provider: 'garmin',
    total_steps: steps,
  });
  const night = (day: string, seconds: number) => ({
    id: `n-${day}`,
    entry_date: day,
    bedtime: `${day}T00:30:00Z`,
    wake_time: `${day}T08:30:00Z`,
    duration_in_seconds: seconds,
    time_asleep_in_seconds: seconds,
    sleep_score: null,
    source: 'garmin',
  });

  it('shows steps and sleep for past and current days, fetching the grid once', () => {
    mockMetrics = [metric('2026-11-18', 8200), metric('2026-11-19', 12400)];
    mockSleep = [night('2026-11-18', 27000)];
    renderMonth([med('a', 'Sertraline', [schedule('daily')])]);
    expect(screen.getByText('8.2k')).toBeInTheDocument();
    expect(screen.getByText('12k')).toBeInTheDocument();
    expect(screen.getByText('7.5h')).toBeInTheDocument();
    expect(mockMetricsHook).toHaveBeenCalledWith('2026-10-26', '2026-12-06');
    expect(mockSleepHook).toHaveBeenCalledWith('2026-10-26', '2026-12-06');
  });

  it('leaves out a figure a day lacks and shows nothing for future days', () => {
    mockMetrics = [metric('2026-11-18', null), metric('2026-11-25', 9000)];
    mockSleep = [night('2026-11-18', 25200)];
    renderMonth([med('a', 'Sertraline', [schedule('daily')])]);
    expect(screen.getByText('7h')).toBeInTheDocument();
    expect(screen.queryByText('9k')).not.toBeInTheDocument();
  });

  it('shows no figures, and still renders the calendar, when the queries have no data', () => {
    renderMonth([med('a', 'Sertraline', [schedule('daily')])]);
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.queryByText(/\dh$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/k$/)).not.toBeInTheDocument();
  });
});
