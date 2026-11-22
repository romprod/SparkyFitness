import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationLevelsOverlay from '@/pages/Medications/MedicationLevelsOverlay';
import type { Medication } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
// The chart needs real layout in jsdom; the card's own logic is what is tested, so the chart's
// data and lines are exposed as plain markup.
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({
    data,
    children,
  }: {
    data: unknown[];
    children: React.ReactNode;
  }) => (
    <div data-testid="levels-chart" data-rows={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({
    dataKey,
    strokeDasharray,
  }: {
    dataKey: string;
    strokeDasharray?: string;
  }) => (
    <i
      data-testid="levels-line"
      data-key={dataKey}
      data-dashed={strokeDasharray ? 'yes' : 'no'}
    />
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceLine: () => <i data-testid="levels-now" />,
}));
let mockInjections: Record<string, unknown[] | undefined> = {};
const mockInjectionHook = jest.fn();
jest.mock('@/hooks/useMedications', () => ({
  useMedicationInjectionsFor: (ids: string[]) => {
    mockInjectionHook(ids);
    return { data: mockInjections, isPending: false };
  },
}));
let mockWeeks: Record<string, unknown[]> = {};
const mockWeek = jest.fn((weekStart: string, enabled: boolean) => ({
  data:
    enabled && mockWeeks[weekStart]
      ? { week_start: weekStart, planned_slots: mockWeeks[weekStart] }
      : undefined,
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: (weekStart: string, enabled: boolean) =>
    mockWeek(weekStart, enabled),
}));

const med = (id: string, name: string, patch: Partial<Medication> = {}) =>
  ({
    id,
    name,
    display_name: null,
    type_id: 'injection',
    is_active: true,
    is_supplement: false,
    custom_fields: {},
    ...patch,
  }) as unknown as Medication;
const reta = med('reta', 'Retatrutide');
const cagri = med('cagri', 'Cagrilintide');
const DAY = 86_400_000;
const now = Date.parse('2026-11-22T12:00:00.000Z');
const injection = (days: number, dose = 2) => ({
  injected_at: new Date(now + days * DAY).toISOString(),
  dose_mg: dose,
});
const plannedSlot = (medication_id: string, days: number, patch = {}) => ({
  medication_id,
  status: 'planned',
  scheduled_for: new Date(now + days * DAY).toISOString(),
  dose_amount: '2',
  dose_unit: 'mg',
  ...patch,
});
const renderCard = (medications: Medication[]) =>
  render(
    <MedicationLevelsOverlay medications={medications} today="2026-11-22" />
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  mockInjections = {
    reta: [injection(-14), injection(-7), injection(-0.2)],
    cagri: [injection(-10, 0.25), injection(-3, 0.25)],
  };
  mockWeeks = {};
  mockWeek.mockClear();
  mockInjectionHook.mockClear();
});
afterEach(() => jest.useRealTimers());

it('draws a line for each injectable with a modeled profile and says where each is now', () => {
  renderCard([reta, cagri]);
  const keys = screen
    .getAllByTestId('levels-line')
    .map((line) => line.getAttribute('data-key'));
  expect(new Set(keys)).toEqual(
    new Set(['reta_taken', 'reta_ahead', 'cagri_taken', 'cagri_ahead'])
  );
  expect(screen.getByText('Retatrutide')).toBeInTheDocument();
  expect(screen.getByText('Cagrilintide')).toBeInTheDocument();
  expect(screen.getAllByText(/% of peak now/)).toHaveLength(2);
  expect(screen.getByTestId('levels-now')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleName(
    /Modeled levels of Cagrilintide, Retatrutide over 14 days/
  );
});

it('draws ahead of now dashed and doses taken solid, each below 100 percent of its own peak', () => {
  renderCard([reta]);
  const dashed = Object.fromEntries(
    screen
      .getAllByTestId('levels-line')
      .map((l) => [l.getAttribute('data-key'), l.getAttribute('data-dashed')])
  );
  expect(dashed).toEqual({ reta_taken: 'no', reta_ahead: 'yes' });
  const rows = JSON.parse(
    screen.getByTestId('levels-chart').getAttribute('data-rows')!
  ) as Record<string, number>[];
  const levels = rows.flatMap((row) =>
    ['reta_taken', 'reta_ahead']
      .map((key) => row[key])
      .filter((v): v is number => v !== undefined)
  );
  expect(Math.max(...levels)).toBeCloseTo(100, 0);
  expect(levels.every((v) => v >= 0 && v <= 100)).toBe(true);
});

it('leaves out supplements, other forms, stopped medications and anything without a half-life', () => {
  renderCard([
    reta,
    med('pill', 'Sertraline', { type_id: 'pill' }),
    med('supp', 'Peptide supplement', { is_supplement: true }),
    med('off', 'Cagrilintide', { is_active: false }),
    med('mystery', 'Mystery peptide'),
  ]);
  expect(screen.getAllByText(/% of peak now/)).toHaveLength(1);
  expect(mockInjectionHook).toHaveBeenLastCalledWith(['reta']);
});

it('adds planned doses ahead and says so; without them the note says doses already taken', () => {
  const { unmount } = renderCard([reta]);
  expect(
    screen.getByText(/Dashed: ahead of now, from doses already taken/)
  ).toBeInTheDocument();
  unmount();
  mockWeeks = { '2026-11-16': [plannedSlot('reta', 1)] };
  renderCard([reta]);
  expect(
    screen.getByText(/from doses taken plus doses planned/)
  ).toBeInTheDocument();
});

it('ignores planned doses whose amount is unknown or in a unit it cannot convert', () => {
  mockWeeks = {
    '2026-11-16': [
      plannedSlot('reta', 1, { dose_amount: null }),
      plannedSlot('reta', 2, { dose_unit: 'ml' }),
    ],
  };
  renderCard([reta]);
  expect(screen.getByText(/from doses already taken/)).toBeInTheDocument();
});

it('reads further weeks only as far as the chosen window, and says which window is on', () => {
  renderCard([reta]);
  expect(screen.getByRole('button', { name: '14 days' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // 14 days needs three weeks, not five.
  expect(mockWeek).toHaveBeenCalledWith('2026-11-30', true);
  expect(mockWeek).toHaveBeenCalledWith('2026-12-07', false);
  fireEvent.click(screen.getByRole('button', { name: '30 days' }));
  expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(mockWeek).toHaveBeenCalledWith('2026-12-07', true);
  expect(mockWeek).toHaveBeenCalledWith('2026-12-14', true);
});

it('shows nothing and reads nothing when no injectable has a modeled profile', () => {
  const { container } = renderCard([
    med('pill', 'Sertraline', { type_id: 'pill' }),
  ]);
  expect(container).toBeEmptyDOMElement();
  expect(mockWeek).not.toHaveBeenCalledWith(expect.anything(), true);
});
