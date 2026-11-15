import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SleepReport from '@/pages/Reports/SleepReport';
import type { SleepEntry } from '@/types';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | ({ defaultValue?: string } & Record<string, unknown>)
    ) =>
      typeof options === 'string'
        ? options
        : (options?.defaultValue ?? key).replace(
            /\{\{(\w+)\}\}/g,
            (_, name: string) => String(options?.[name])
          ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDateInUserTimezone: (date: string) => date,
    dateFormat: 'yyyy-MM-dd',
    timeFormat: 'HH:mm',
    timezone: 'UTC',
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), info: jest.fn() } }));
const mockEntries: { current: SleepEntry[] } = { current: [] };
jest.mock('@/hooks/CheckIn/useSleep', () => ({
  useSleepEntriesQuery: () => ({ data: mockEntries.current, isLoading: false }),
}));
jest.mock('@/hooks/SleepScience/useSleepScience', () => ({
  useSleepDebtQuery: () => ({ data: { sleepNeed: 8 }, isLoading: false }),
}));
jest.mock('@/pages/Reports/SleepAnalyticsCharts', () => ({
  __esModule: true,
  default: () => null,
}));
function entry(
  id: string,
  day: string,
  rem: number | null,
  deep: number | null,
  nap = false
): SleepEntry {
  const bedtime = `${day}T${nap ? '12' : '00'}:00:00Z`,
    wake_time = `${day}T${nap ? '13' : '08'}:00:00Z`;
  return {
    id,
    user_id: 'synthetic',
    entry_date: day,
    bedtime,
    wake_time,
    duration_in_seconds: nap ? 3600 : 28800,
    time_asleep_in_seconds: nap ? 3600 : 28800,
    sleep_score: 80,
    source: 'Synthetic source',
    created_at: bedtime,
    updated_at: bedtime,
    rem_sleep_seconds: rem,
    deep_sleep_seconds: deep,
    light_sleep_seconds: null,
    awake_sleep_seconds: null,
    average_spo2_value: null,
    lowest_spo2_value: null,
    highest_spo2_value: null,
    average_respiration_value: null,
    lowest_respiration_value: null,
    highest_respiration_value: null,
    awake_count: null,
    avg_sleep_stress: null,
    restless_moments_count: null,
    avg_overnight_hrv: null,
    body_battery_change: null,
    resting_heart_rate: null,
    stage_events: [],
  };
}
beforeEach(() => {
  mockEntries.current = [
    entry('night', '2026-10-24', 3600, 1800),
    entry('nap', '2026-10-24', 900, null, true),
    entry('zero', '2026-10-25', 0, 0),
    entry('partial', '2026-10-26', null, 600),
    entry('malformed', '2026-10-27', -1, NaN),
  ];
});
function row(day: string) {
  const result = screen.getByText(day).closest('tr');
  if (!result) throw new Error('Missing synthetic history row');
  return within(result);
}
describe('sleep stage history and export', () => {
  it('renders independent daily stage totals, known zeros and known-day period averages', () => {
    render(<SleepReport startDate="2026-10-24" endDate="2026-10-27" />);
    expect(
      screen.getByRole('columnheader', { name: 'REM' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Deep sleep' })
    ).toBeInTheDocument();
    expect(row('2026-10-24').getByText('1h 15m')).toBeInTheDocument();
    expect(row('2026-10-24').getByText('N/A')).toBeInTheDocument();
    expect(
      row('2026-10-25')
        .getAllByRole('cell')
        .slice(6, 8)
        .map((cell) => cell.textContent)
    ).toEqual(['0m', '0m']);
    expect(row('2026-10-26').getByText('10m')).toBeInTheDocument();
    expect(row('2026-10-27').getAllByText('N/A')).toHaveLength(2);
    expect(screen.getByText('38m')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getAllByText('2 days with data')).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: 'Export to CSV' })
    ).toHaveLength(1);
  });
  it('does not infer missing aggregates from a stage timeline or total sleep', () => {
    const missing = entry('unknown', '2026-10-28', null, null);
    missing.stage_events = [
      {
        id: 'event',
        entry_id: 'unknown',
        stage_type: 'rem',
        start_time: missing.bedtime,
        end_time: missing.wake_time,
        duration_in_seconds: 3600,
      },
    ];
    mockEntries.current = [missing];
    render(<SleepReport startDate="2026-10-28" endDate="2026-10-28" />);
    expect(row('2026-10-28').getAllByText('N/A')).toHaveLength(2);
    expect(screen.getAllByText('0 days with data')).toHaveLength(2);
  });
  it('keeps existing CSV columns, raw day and units, appends escaped raw seconds and distinguishes blank from zero', () => {
    mockEntries.current = [entry('one', '2026-10-24', 0, null)];
    mockEntries.current[0]!.source = 'Device, "night"\nline';
    const parts: string[] = [];
    const originalBlob = global.Blob;
    global.Blob = class {
      constructor(values: string[]) {
        parts.push(...values);
      }
    } as unknown as typeof Blob;
    Object.assign(URL, {
      createObjectURL: jest.fn(() => 'blob:synthetic'),
      revokeObjectURL: jest.fn(),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      render(<SleepReport startDate="2026-10-24" endDate="2026-10-24" />);
      fireEvent.click(screen.getByRole('button', { name: 'Export to CSV' }));
      const csv = parts.join('');
      expect(csv.split('\n')[0]).toBe(
        '"Date","Bedtime","Wake Time","Duration","Time Asleep","Score","Efficiency (%)","Debt","Weight (%)","Awake Periods","Source","Insight","REM (seconds)","Deep sleep (seconds)"'
      );
      expect(csv).toContain('"2026-10-24","00:00","08:00","8h 0m","8h 0m"');
      expect(csv).toContain('"Device, ""night""\nline"');
      expect(csv.endsWith(',"0",""')).toBe(true);
    } finally {
      global.Blob = originalBlob;
      click.mockRestore();
    }
  });
});
