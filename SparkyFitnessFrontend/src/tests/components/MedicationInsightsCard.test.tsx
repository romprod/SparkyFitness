import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MedicationInsightStreams } from '@workspace/shared';
import MedicationInsightsCard from '@/pages/Reports/MedicationInsightsCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockUnit = 'lbs';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockUnit,
    // Two pounds to the kilogram, so the arithmetic in the tests stays plain.
    convertWeight: (value: number, _from: string, to: string) =>
      to === 'lbs' ? value * 2 : value,
  }),
}));
let mockQuery: {
  data?: MedicationInsightStreams;
  isError?: boolean;
  isLoading?: boolean;
} = {};
jest.mock('@/hooks/Medications/useMedicationInsights', () => ({
  useMedicationInsightStreams: () => mockQuery,
}));

const today = '2026-11-22';
const day = (back: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const streams = (
  patch: Partial<MedicationInsightStreams> = {}
): MedicationInsightStreams => ({
  today,
  from_day: day(89),
  doses: [],
  wearable: [],
  weights_kg: [],
  symptoms: [],
  adherence_pct: null,
  ...patch,
});
// Dose on days 1-5 back; sleep recorded on days 1-10 back.
const dosesAndSleep: Partial<MedicationInsightStreams> = {
  doses: [1, 2, 3, 4, 5].map((back) => ({
    at: `${day(back)}T09:00:00.000Z`,
    day: day(back),
  })),
  wearable: Array.from({ length: 10 }, (_, i) => ({
    day: day(i + 1),
    sleep_seconds: (i < 5 ? 7 : 8.5) * 3600,
    resting_hr: i < 5 ? 62 : 58,
    body_battery_high: null,
  })),
};
const weights = [4, 3, 2, 1, 0].map((back, i) => ({
  day: day(back),
  value: 81 - i * 0.5,
}));

beforeEach(() => {
  mockUnit = 'lbs';
  mockQuery = {};
});

it('states that the observations are descriptive, not advice or a cause', () => {
  mockQuery = { data: streams() };
  render(<MedicationInsightsCard />);
  expect(
    screen.getByText(
      /Observational — not medical advice; correlation ≠ causation/
    )
  ).toBeInTheDocument();
  expect(screen.getByText(/last 90 days/)).toBeInTheDocument();
});

it('shows each comparison with its sample sizes', () => {
  mockQuery = { data: streams(dosesAndSleep) };
  render(<MedicationInsightsCard />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Sleep on dose days vs other days');
  expect(items[0]).toHaveTextContent(
    'Avg sleep: 7h on dose days vs 8.5h on other days.'
  );
  expect(items[0]).toHaveTextContent('n=5 vs n=5');
  expect(items[1]).toHaveTextContent('Resting heart rate on dose days');
  expect(items[1]).toHaveTextContent(
    'Avg resting HR: 62 bpm on dose days vs 58 bpm on other days.'
  );
  // No Body Battery was recorded, so that comparison is not shown at all.
  expect(screen.queryByText(/Body Battery/)).not.toBeInTheDocument();
});

it('words the weight trend in the unit the person reads', () => {
  mockQuery = { data: streams({ weights_kg: weights }) };
  render(<MedicationInsightsCard />);
  // 2 kg lost is 4 lbs at two pounds to the kilogram.
  expect(screen.getByText('Weight trend')).toBeInTheDocument();
  expect(
    screen.getByText(
      '30d: down 4 lbs (n=5)  ·  60d: down 4 lbs (n=5)  ·  90d: down 4 lbs (n=5)',
      { normalizer: (text) => text }
    )
  ).toBeInTheDocument();
});

it('keeps kilograms for a person who reads kilograms', () => {
  mockUnit = 'kg';
  mockQuery = { data: streams({ weights_kg: weights }) };
  render(<MedicationInsightsCard />);
  expect(screen.getByText(/30d: down 2 kg \(n=5\)/)).toBeInTheDocument();
});

it('reads stones and pounds as pounds', () => {
  mockUnit = 'st_lbs';
  mockQuery = { data: streams({ weights_kg: weights }) };
  render(<MedicationInsightsCard />);
  expect(screen.getByText(/30d: down 4 lbs \(n=5\)/)).toBeInTheDocument();
});

it('lists the most-logged symptoms and when they came after a dose', () => {
  const symptoms = [1, 2, 3, 4, 5].map((back) => ({
    name: 'Nausea',
    day: day(back),
    at: `${day(back)}T12:00:00.000Z`,
    severity_label: 'Moderate',
    severity: 5,
  }));
  mockQuery = {
    data: streams({
      doses: [
        { at: `${day(6)}T09:00:00.000Z`, day: day(6) },
        ...(dosesAndSleep.doses ?? []),
      ],
      symptoms,
    }),
  };
  render(<MedicationInsightsCard />);
  expect(screen.getByText('Most-logged symptoms')).toBeInTheDocument();
  expect(
    screen.getByText('Nausea — 5 days (mostly moderate)')
  ).toBeInTheDocument();
  expect(screen.getByText('Symptom timing after a dose')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Of 5 symptom days with a prior dose: 5 within 24h, 0 at 24–72h, 0 after 72h.'
    )
  ).toBeInTheDocument();
});

it('puts adherence beside weight as a neutral observation', () => {
  mockQuery = { data: streams({ weights_kg: weights, adherence_pct: 92 }) };
  render(<MedicationInsightsCard />);
  expect(
    screen.getByText(
      'Adherence 92% over the window. Weight 90d: down 4 lbs (n=5). Shown side by side — not a cause-and-effect claim.'
    )
  ).toBeInTheDocument();
});

it('lists the insights in a fixed order', () => {
  mockQuery = {
    data: streams({
      ...dosesAndSleep,
      weights_kg: weights,
      adherence_pct: 100,
    }),
  };
  render(<MedicationInsightsCard />);
  const titles = screen
    .getAllByRole('listitem')
    .map((item) => within(item).getAllByText(/./)[0]?.textContent);
  expect(titles).toEqual([
    'Sleep on dose days vs other days',
    'Resting heart rate on dose days vs other days',
    'Weight trend',
    'Adherence alongside weight',
  ]);
});

it('says so when there is not enough data, and while loading or after a failure', () => {
  mockQuery = { data: streams() };
  const { rerender } = render(<MedicationInsightsCard />);
  expect(
    screen.getByText('Not enough data yet for insights.')
  ).toBeInTheDocument();
  mockQuery = { isLoading: true };
  rerender(<MedicationInsightsCard />);
  expect(screen.getByText('Loading insights…')).toBeInTheDocument();
  expect(screen.queryByText(/Not enough data/)).not.toBeInTheDocument();
  mockQuery = { isError: true };
  rerender(<MedicationInsightsCard />);
  expect(screen.getByText('Could not load insights.')).toBeInTheDocument();
});
