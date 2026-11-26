import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MedicationDayWearable from '@/pages/Medications/MedicationDayWearable';

let mockMetrics: unknown[] | undefined;
let mockSleep: unknown[] | undefined;
let mockWeight: { weight: number } | null | undefined;
let mockSessions: unknown[] | undefined;
let mockWeightUnit = 'kg';
let mockDistanceUnit = 'km';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockWeightUnit,
    distanceUnit: mockDistanceUnit,
    convertWeight: (v: number, from: string, to: string) =>
      from === to ? v : v * 2.20462,
    convertDistance: (v: number, from: string, to: string) =>
      from === to ? v : v * 0.621371,
  }),
}));
jest.mock('@/hooks/useGenericHealth', () => ({
  useDailyHealthMetrics: () => ({ data: mockMetrics }),
}));
jest.mock('@/hooks/CheckIn/useSleep', () => ({
  useSleepEntriesQuery: () => ({ data: mockSleep }),
}));
jest.mock('@/hooks/CheckIn/useCheckIn', () => ({
  useCheckInMeasurementsForDate: () => ({ data: mockWeight }),
}));
jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: mockSessions }),
}));

const row = (extra: object = {}) => ({
  entry_date: '2026-11-20',
  source_provider: 'garmin',
  total_steps: null,
  active_calories: null,
  moderate_intensity_minutes: null,
  vigorous_intensity_minutes: null,
  resting_heart_rate: null,
  body_battery_highest: null,
  ...extra,
});
const night = {
  id: 's',
  entry_date: '2026-11-20',
  bedtime: '2026-11-19T22:30:00Z',
  wake_time: '2026-11-20T06:30:00Z',
  duration_in_seconds: 28800,
  time_asleep_in_seconds: 25920,
  sleep_score: 81,
  source: 'garmin',
  avg_overnight_hrv: 52,
  resting_heart_rate: null,
};

beforeEach(() => {
  mockMetrics = undefined;
  mockSleep = undefined;
  mockWeight = undefined;
  mockSessions = undefined;
  mockWeightUnit = 'kg';
  mockDistanceUnit = 'km';
});

const renderIt = () => render(<MedicationDayWearable day="2026-11-20" />);

it('renders nothing with no figures and no workouts', () => {
  const { container } = renderIt();
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing while queries are loading or failed (no data)', () => {
  mockMetrics = undefined;
  mockSleep = undefined;
  const { container } = renderIt();
  expect(container).toBeEmptyDOMElement();
});

it('shows every figure that exists', () => {
  mockMetrics = [
    row({
      total_steps: 8200,
      active_calories: 410,
      moderate_intensity_minutes: 20,
      vigorous_intensity_minutes: 10,
      resting_heart_rate: 51,
      body_battery_highest: 88,
    }),
  ];
  mockSleep = [night];
  mockWeight = { weight: 82.4 };
  renderIt();
  expect(screen.getByText('Wellness')).toBeInTheDocument();
  expect(screen.getByText('8,200')).toBeInTheDocument();
  expect(screen.getByText('7h 12m · score 81')).toBeInTheDocument();
  expect(screen.getByText('410')).toBeInTheDocument();
  expect(screen.getByText('40 min')).toBeInTheDocument();
  expect(screen.getByText('82.4 kg')).toBeInTheDocument();
  expect(screen.getByText('51 bpm')).toBeInTheDocument();
  expect(screen.getByText('52 ms')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
  expect(screen.queryByText('Workouts')).not.toBeInTheDocument();
});

it('leaves out figures that are missing', () => {
  mockMetrics = [row({ total_steps: 5000 })];
  renderIt();
  expect(screen.getByText('Steps')).toBeInTheDocument();
  for (const label of [
    'Sleep',
    'Active cal',
    'Intensity',
    'Weight',
    'Resting HR',
    'HRV',
    'Body Battery',
  ])
    expect(screen.queryByText(label)).not.toBeInTheDocument();
});

it('shows the weight in the preferred unit', () => {
  mockWeight = { weight: 80 };
  mockWeightUnit = 'lbs';
  renderIt();
  expect(screen.getByText('176.4 lbs')).toBeInTheDocument();
});

it('lists workouts with duration and distance', () => {
  mockSessions = [
    {
      type: 'individual',
      id: 'a',
      name: null,
      exercise_snapshot: { name: 'Morning run' },
      duration_minutes: 72,
      distance: 10,
    },
    {
      type: 'preset',
      id: 'b',
      name: 'Push day',
      total_duration_minutes: 45,
      exercises: [],
    },
  ];
  renderIt();
  expect(screen.getByText('Workouts')).toBeInTheDocument();
  expect(screen.getByText('Morning run')).toBeInTheDocument();
  expect(screen.getByText('1h 12m · 10.0 km')).toBeInTheDocument();
  expect(screen.getByText('Push day')).toBeInTheDocument();
  expect(screen.getByText('45m')).toBeInTheDocument();
});

it('shows workout distance in miles when preferred', () => {
  mockDistanceUnit = 'miles';
  mockSessions = [
    {
      type: 'individual',
      id: 'a',
      name: null,
      exercise_snapshot: { name: 'Run' },
      duration_minutes: 30,
      distance: 10,
    },
  ];
  renderIt();
  expect(screen.getByText('30m · 6.2 mi')).toBeInTheDocument();
});
