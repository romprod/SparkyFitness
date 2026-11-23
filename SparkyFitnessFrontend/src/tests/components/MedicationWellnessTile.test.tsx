import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationWellnessStreams } from '@workspace/shared';
import MedicationWellnessTile from '@/pages/Medications/MedicationWellnessTile';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockUnit = 'kg';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockUnit,
    convertWeight: (value: number, _from: string, to: string) =>
      to === 'lbs' ? Math.round(value * 2.20462 * 100) / 100 : value,
    formatDate: (day: string) => `UK:${day}`,
  }),
}));
let mockStreams: MedicationWellnessStreams | undefined;
jest.mock('@/hooks/Medications/useMedicationWellness', () => ({
  useMedicationWellnessStreams: () => ({ data: mockStreams }),
}));

const day = (
  date: string,
  over: Partial<MedicationWellnessStreams['days'][number]> = {}
) => ({
  day: date,
  resting_hr: null,
  hrv_ms: null,
  body_battery: null,
  sleep_score: null,
  sleep_seconds: null,
  avg_stress: null,
  ...over,
});
const streams = (
  over: Partial<MedicationWellnessStreams> = {}
): MedicationWellnessStreams => ({
  today: '2026-11-23',
  days: [],
  activities: [],
  weights_kg: [],
  ...over,
});
const stat = (label: string) =>
  within(screen.getByText(label).parentElement as HTMLElement);

beforeEach(() => {
  mockUnit = 'kg';
  mockStreams = undefined;
});

describe('recovery tile', () => {
  it('shows every recovery figure the watch gave, with the day they are from', () => {
    mockStreams = streams({
      days: [
        day('2026-11-23', {
          resting_hr: 58,
          hrv_ms: 52.4,
          body_battery: 71,
          sleep_score: 84,
          sleep_seconds: 24600,
        }),
      ],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText('Recovery')).toBeInTheDocument();
    expect(screen.getByText(/Garmin ·/)).toHaveTextContent('Garmin · Today');
    expect(screen.getByText('Garmin ·').textContent ?? '').not.toContain(
      'amber'
    );
    expect(stat('Sleep').getByText('84')).toBeInTheDocument();
    expect(stat('Sleep').getByText('6h 50m')).toBeInTheDocument();
    expect(stat('Resting HR').getByText('58')).toBeInTheDocument();
    expect(stat('HRV').getByText('52')).toBeInTheDocument();
    expect(stat('Body Battery').getByText('71')).toBeInTheDocument();
  });

  it('shows only the figures there are: no empty Body Battery or HRV', () => {
    mockStreams = streams({
      days: [
        day('2026-11-22', {
          resting_hr: 58,
          sleep_score: 84,
          sleep_seconds: 24600,
        }),
      ],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText('Sleep')).toBeInTheDocument();
    expect(screen.getByText('Resting HR')).toBeInTheDocument();
    expect(screen.queryByText('HRV')).not.toBeInTheDocument();
    expect(screen.queryByText('Body Battery')).not.toBeInTheDocument();
  });

  it('flags yesterday and older figures instead of passing them off as current', () => {
    mockStreams = streams({
      days: [day('2026-11-22', { resting_hr: 58 })],
    });
    const { unmount } = render(<MedicationWellnessTile />);
    expect(screen.getByText('Yesterday')).toHaveClass('text-amber-600');
    unmount();
    mockStreams = streams({ days: [day('2026-11-19', { resting_hr: 58 })] });
    render(<MedicationWellnessTile />);
    expect(screen.getByText('UK:2026-11-19')).toHaveClass('text-amber-600');
  });

  it('shows sleep hours alone when the night has no score', () => {
    mockStreams = streams({
      days: [day('2026-11-23', { resting_hr: 60, sleep_seconds: 21000 })],
    });
    render(<MedicationWellnessTile />);
    expect(stat('Sleep').getByText('5h 50m')).toBeInTheDocument();
  });
});

describe('workout line', () => {
  const base = day('2026-11-23', { resting_hr: 58 });

  it('names the latest workout and how long it ran, counting the others that day', () => {
    mockStreams = streams({
      days: [base],
      activities: [
        {
          day: '2026-11-23',
          name: 'Chesterfield Hiking',
          duration_minutes: 28.2,
        },
        { day: '2026-11-23', name: 'Walk', duration_minutes: 12 },
      ],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText(/Chesterfield Hiking 28m \+1/)).toBeInTheDocument();
    expect(screen.queryByText(/^· /)).not.toBeInTheDocument();
  });

  it('labels the day when the workout was not today, and writes long ones in hours', () => {
    mockStreams = streams({
      days: [base],
      activities: [{ day: '2026-11-21', name: 'Ride', duration_minutes: 95 }],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText(/Ride 1h 35m/)).toBeInTheDocument();
    expect(screen.getByText('· UK:2026-11-21')).toBeInTheDocument();
  });

  it('falls back to a generic name for a workout without one', () => {
    mockStreams = streams({
      days: [base],
      activities: [{ day: '2026-11-23', name: '', duration_minutes: 30 }],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText(/Workout 30m/)).toBeInTheDocument();
  });
});

describe('weight', () => {
  const week = [
    { day: '2026-11-17', value: 81.08 },
    { day: '2026-11-20', value: 79.87 },
    { day: '2026-11-21', value: 79.15 },
  ];

  it('shows the latest weight with its change over the week and a line of the readings', () => {
    mockStreams = streams({ weights_kg: week });
    const { container } = render(<MedicationWellnessTile />);
    expect(screen.getByText('79.15')).toBeInTheDocument();
    expect(screen.getByText(/-1.93 kg/)).toHaveTextContent('-1.93 kg 7d');
    expect(
      container.querySelector('svg[viewBox="0 0 120 32"]')
    ).toBeInTheDocument();
    // No wearable figures: no Garmin label.
    expect(screen.queryByText(/Garmin/)).not.toBeInTheDocument();
  });

  it('signs a gain and reads the unit the person chose', () => {
    mockUnit = 'st_lbs';
    mockStreams = streams({
      weights_kg: [
        { day: '2026-11-18', value: 80 },
        { day: '2026-11-22', value: 81 },
      ],
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText('178.57')).toBeInTheDocument();
    expect(screen.getByText(/\+2.2 lbs/)).toBeInTheDocument();
  });

  it('shows one reading without a change or a line', () => {
    mockStreams = streams({ weights_kg: [{ day: '2026-11-22', value: 80 }] });
    const { container } = render(<MedicationWellnessTile />);
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.queryByText(/7d/)).not.toBeInTheDocument();
    expect(
      container.querySelector('svg[viewBox="0 0 120 32"]')
    ).not.toBeInTheDocument();
  });

  it('sits below the recovery figures when there are both', () => {
    mockStreams = streams({
      days: [day('2026-11-23', { resting_hr: 58 })],
      weights_kg: week,
    });
    render(<MedicationWellnessTile />);
    expect(screen.getByText('Resting HR')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
  });
});

describe('nothing to show', () => {
  it('renders nothing while loading, on error or with no figures', () => {
    for (const value of [
      undefined,
      streams(),
      streams({ days: [day('2026-11-22', { avg_stress: 30 })] }),
      streams({ days: [day('2026-11-01', { resting_hr: 60 })] }),
    ]) {
      mockStreams = value;
      const { container, unmount } = render(<MedicationWellnessTile />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
