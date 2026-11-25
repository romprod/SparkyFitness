import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  AdherenceFigure,
  MedicationAdherenceWindow,
} from '@workspace/shared';
import MedicationAdherenceCard from '@/pages/Reports/MedicationAdherenceCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockQuery: {
  data?: MedicationAdherenceWindow;
  isError?: boolean;
  isLoading?: boolean;
} = {};
jest.mock('@/hooks/Medications/useMedicationInsights', () => ({
  useMedicationAdherenceWindow: () => mockQuery,
}));

const figure = (patch: Partial<AdherenceFigure> = {}): AdherenceFigure => ({
  pct: 100,
  taken: 4,
  missed: 0,
  days_of_data: 13,
  ...patch,
});
const row = (name: string, patch: Partial<AdherenceFigure> = {}) => ({
  medication_id: name,
  name,
  ...figure(patch),
});
const window = (
  patch: Partial<MedicationAdherenceWindow> = {}
): MedicationAdherenceWindow => ({
  today: '2026-11-22',
  from_day: '2026-08-25',
  to_day: '2026-11-22',
  overall: figure(),
  medications: [],
  ...patch,
});

beforeEach(() => {
  mockQuery = {};
});

it('shows the overall figure with its counts and days of data', () => {
  mockQuery = { data: window() };
  render(<MedicationAdherenceCard />);
  expect(screen.getByText('Adherence (90 days)')).toBeInTheDocument();
  expect(screen.getByText('Overall adherence')).toBeInTheDocument();
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(
    screen.getByText('4 taken · 0 missed · 13 days of data')
  ).toBeInTheDocument();
});

it('uses the singular for one day and leaves the days out for none', () => {
  mockQuery = {
    data: window({ overall: figure({ taken: 1, days_of_data: 1 }) }),
  };
  const { rerender } = render(<MedicationAdherenceCard />);
  expect(
    screen.getByText('1 taken · 0 missed · 1 day of data')
  ).toBeInTheDocument();
  mockQuery = { data: window({ overall: figure({ days_of_data: 0 }) }) };
  rerender(<MedicationAdherenceCard />);
  expect(screen.getByText('4 taken · 0 missed')).toBeInTheDocument();
});

it('says history is needed when nothing was scored', () => {
  mockQuery = {
    data: window({
      overall: figure({ pct: null, taken: 0, days_of_data: 0 }),
    }),
  };
  render(<MedicationAdherenceCard />);
  expect(
    screen.getByText('Adherence available once scheduling history accrues.')
  ).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

it('has no per-medicine cards for a single medicine', () => {
  mockQuery = { data: window({ medications: [row('Cagrilintide')] }) };
  render(<MedicationAdherenceCard />);
  expect(screen.queryByText('Cagrilintide adherence')).not.toBeInTheDocument();
});

it('lists two or more medicines by name', () => {
  mockQuery = {
    data: window({
      medications: [
        row('Retatrutide', { pct: 80, taken: 4, missed: 1 }),
        row('Cagrilintide', { taken: 1, days_of_data: 1 }),
        row('Idle', { pct: null, taken: 0, days_of_data: 0 }),
      ],
    }),
  };
  render(<MedicationAdherenceCard />);
  const labels = screen.getAllByText(/ adherence$/).map((el) => el.textContent);
  expect(labels).toEqual([
    'Overall adherence',
    'Cagrilintide adherence',
    'Idle adherence',
    'Retatrutide adherence',
  ]);
  expect(
    screen.getByText('1 taken · 0 missed · 1 day of data')
  ).toBeInTheDocument();
  expect(screen.getByText('80%')).toBeInTheDocument();
  expect(
    screen.getAllByText('Adherence available once scheduling history accrues.')
  ).toHaveLength(1);
});

it('shows loading and error states', () => {
  mockQuery = { isLoading: true };
  const { rerender } = render(<MedicationAdherenceCard />);
  expect(screen.getByText('Loading adherence…')).toBeInTheDocument();
  mockQuery = { isError: true };
  rerender(<MedicationAdherenceCard />);
  expect(screen.getByText('Could not load adherence.')).toBeInTheDocument();
});
