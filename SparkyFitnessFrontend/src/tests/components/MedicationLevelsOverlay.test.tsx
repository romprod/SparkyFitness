import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationLevelsOverlay from '@/pages/Medications/MedicationLevelsOverlay';
import type { Medication } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallbackOrOptions: string | Record<string, unknown>,
      values?: Record<string, unknown>
    ) => {
      // Either t(key, fallback, values) or t(key, { defaultValue, defaultValue_other, count }).
      const options =
        typeof fallbackOrOptions === 'string' ? values : fallbackOrOptions;
      const text =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : String(
              (options?.['count'] === 1
                ? options['defaultValue']
                : (options?.['defaultValue_other'] ??
                  options?.['defaultValue'])) ?? ''
            );
      return text.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(options?.[key] ?? '')
      );
    },
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
  ReferenceLine: ({
    x,
    strokeDasharray,
  }: {
    x: number;
    strokeDasharray?: string;
  }) => (
    <i
      data-testid={strokeDasharray ? 'levels-missed' : 'levels-now'}
      data-x={x}
    />
  ),
}));
let mockBlends: unknown[] | undefined = [];
jest.mock('@/hooks/Medications/useMedicationBlends', () => ({
  useMedicationBlends: () => ({ data: mockBlends }),
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
  mockBlends = [];
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

describe('a medication with its own half-life', () => {
  const bpc = med('bpc', 'BPC-157', { custom_fields: { half_life_hours: 4 } });

  it('is drawn like a catalogue medication, once it has doses', () => {
    mockInjections = {
      bpc: [injection(-3, 0.25), injection(-2, 0.25), injection(-1, 0.25)],
    };
    renderCard([bpc]);
    const keys = screen
      .getAllByTestId('levels-line')
      .map((line) => line.getAttribute('data-key'));
    expect(new Set(keys)).toEqual(new Set(['bpc_taken', 'bpc_ahead']));
    expect(screen.getByText('BPC-157')).toBeInTheDocument();
    expect(screen.queryByText(/No curve for/)).not.toBeInTheDocument();
    expect(mockInjectionHook).toHaveBeenLastCalledWith(['bpc']);
  });

  it('is sampled finely enough to show each daily peak of a short half-life', () => {
    mockInjections = {
      bpc: [injection(-3, 0.25), injection(-2, 0.25), injection(-1, 0.25)],
    };
    renderCard([bpc]);
    const rows = JSON.parse(
      screen.getByTestId('levels-chart').getAttribute('data-rows') ?? '[]'
    ) as { t: number }[];
    const gaps = rows.slice(1).map((row, i) => row.t - rows[i]!.t);
    // Hourly for a 4-hour half-life, against six-hourly for a half-life of days.
    expect(Math.max(...gaps)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('injectables with no half-life', () => {
  it('are named as having no curve, beneath the chart of the ones that do', () => {
    renderCard([
      reta,
      med('mystery', 'Mystery peptide'),
      med('other', 'Other peptide'),
    ]);
    expect(screen.getAllByText(/% of peak now/)).toHaveLength(1);
    expect(
      screen.getByText(
        'No curve for Mystery peptide, Other peptide: add its half-life when editing the medication to draw it.'
      )
    ).toBeInTheDocument();
  });

  it('keep the card on screen with just that note when nothing else can be drawn', () => {
    renderCard([med('mystery', 'Mystery peptide')]);
    expect(screen.getByText('Modeled levels')).toBeInTheDocument();
    expect(screen.queryByTestId('levels-chart')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No curve for Mystery peptide/)
    ).toBeInTheDocument();
    expect(mockWeek).not.toHaveBeenCalledWith(expect.anything(), true);
  });

  it('use the display name when there is one', () => {
    renderCard([med('mystery', 'mp-1', { display_name: 'Mystery peptide' })]);
    expect(
      screen.getByText(/No curve for Mystery peptide:/)
    ).toBeInTheDocument();
  });

  it('are not listed when stopped, a supplement or not an injection', () => {
    const { container } = renderCard([
      med('a', 'Old peptide', { is_active: false }),
      med('b', 'Peptide supplement', { is_supplement: true }),
      med('c', 'Sertraline', { type_id: 'pill' }),
    ]);
    expect(container).toBeEmptyDOMElement();
  });

  it('are not asked for one when flagged GLP-1, which takes its figures from the drug', () => {
    const { container } = renderCard([
      med('g', 'Odd GLP-1', {
        is_glp1: true,
        custom_fields: { glp1_drug: 'nonesuch' },
      }),
    ]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('missed dose markers', () => {
  const missedSlot = (id: string, days: number) =>
    plannedSlot(id, days, { status: 'missed' });

  it('marks planned doses of a drawn medication that were missed, once each, and says how many', () => {
    mockWeeks = {
      '2026-11-09': [missedSlot('reta', -12)],
      '2026-11-16': [
        missedSlot('reta', -2),
        missedSlot('reta', -2),
        plannedSlot('reta', -1, { status: 'taken' }),
        missedSlot('other', -3),
      ],
    };
    renderCard([reta, cagri]);
    const marks = screen.getAllByTestId('levels-missed');
    expect(marks.map((m) => Number(m.getAttribute('data-x')))).toEqual([
      now - 12 * DAY,
      now - 2 * DAY,
    ]);
    expect(
      screen.getByText(
        'Red dotted lines mark 2 planned doses that were missed in this window.'
      )
    ).toBeInTheDocument();
  });

  it('says nothing when none was missed or the missed dose is outside the window', () => {
    mockWeeks = { '2026-11-02': [missedSlot('reta', -20)] };
    renderCard([reta]);
    expect(screen.queryByTestId('levels-missed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Red dotted lines/)).not.toBeInTheDocument();
  });

  it('reads earlier weeks only as far back as the window reaches', () => {
    renderCard([reta]);
    // Today is Sunday 22 Nov, in the week of 16 Nov: a 14-day window reaches 8 Nov, so two weeks back.
    expect(mockWeek).toHaveBeenCalledWith('2026-11-09', true);
    expect(mockWeek).toHaveBeenCalledWith('2026-11-02', true);
    expect(mockWeek).toHaveBeenCalledWith('2026-10-26', false);
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(mockWeek).toHaveBeenCalledWith('2026-11-09', true);
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(mockWeek).toHaveBeenCalledWith('2026-10-19', true);
  });

  it('reads no earlier weeks when nothing is drawn', () => {
    renderCard([med('x', 'Unknown peptide')]);
    expect(mockWeek).not.toHaveBeenCalledWith(expect.anything(), true);
  });
});

describe('a blend', () => {
  const half = (hours: number) => ({ half_life_hours: hours });
  const klow = med('klow', 'KLOW');
  const ghk = med('ghk', 'GHK-Cu', { custom_fields: half(4) });
  const bpc = med('bpc', 'BPC-157', { custom_fields: half(6) });
  const composition = (names: string[] = ['ghk', 'bpc']) => ({
    blend_medication_id: 'klow',
    components: names.map((id, sort_index) => ({
      component_medication_id: id,
      name: id === 'ghk' ? 'GHK-Cu' : 'BPC-157',
      mass_mg: id === 'ghk' ? '50' : '10',
      source: 'label',
      sort_index,
    })),
  });
  const keys = () =>
    new Set(
      screen
        .getAllByTestId('levels-line')
        .map((line) => line.getAttribute('data-key'))
    );

  it('is drawn as its components, from the blend’s doses, and not as a line of its own', () => {
    mockBlends = [composition()];
    mockInjections = { klow: [injection(-3, 0.8), injection(-0.5, 0.8)] };
    renderCard([klow, ghk, bpc]);
    expect(keys()).toEqual(
      new Set(['ghk_taken', 'ghk_ahead', 'bpc_taken', 'bpc_ahead'])
    );
    expect(screen.getByText('GHK-Cu')).toBeInTheDocument();
    expect(screen.getByText('BPC-157')).toBeInTheDocument();
    expect(screen.queryByText('KLOW')).not.toBeInTheDocument();
    // Doses are read for the blend and for each component, which could also be taken alone.
    expect(new Set(mockInjectionHook.mock.lastCall![0])).toEqual(
      new Set(['klow', 'ghk', 'bpc'])
    );
  });

  it('joins a component’s own doses to the blend’s in one line, not two', () => {
    mockBlends = [composition()];
    mockInjections = {
      klow: [injection(-3, 0.8)],
      ghk: [injection(-1, 0.25)],
    };
    renderCard([klow, ghk, bpc]);
    expect(
      screen
        .getAllByTestId('levels-line')
        .filter((line) => line.getAttribute('data-key')!.startsWith('ghk'))
    ).toHaveLength(2);
    expect(screen.getAllByText('GHK-Cu')).toHaveLength(1);
    expect(new Set(mockInjectionHook.mock.lastCall![0])).toEqual(
      new Set(['klow', 'ghk', 'bpc'])
    );
  });

  it('names a component with no half-life, beneath the lines of the rest', () => {
    mockBlends = [composition()];
    mockInjections = { klow: [injection(-3, 0.8)] };
    renderCard([klow, ghk, med('bpc', 'BPC-157')]);
    expect(keys()).toEqual(new Set(['ghk_taken', 'ghk_ahead']));
    expect(
      screen.getByText(/No curve for BPC-157: add its half-life/)
    ).toBeInTheDocument();
  });

  it('shows only the note when no component has a half-life', () => {
    mockBlends = [composition()];
    renderCard([klow, med('ghk', 'GHK-Cu'), med('bpc', 'BPC-157')]);
    expect(screen.queryByTestId('levels-chart')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No curve for GHK-Cu, BPC-157: add its half-life/)
    ).toBeInTheDocument();
  });

  it('is still drawn when a component medication is stopped', () => {
    mockBlends = [composition(['ghk'])];
    mockInjections = { klow: [injection(-3, 0.8)] };
    renderCard([
      klow,
      med('ghk', 'GHK-Cu', { custom_fields: half(4), is_active: false }),
    ]);
    expect(keys()).toEqual(new Set(['ghk_taken', 'ghk_ahead']));
  });

  it('marks a missed planned dose of the blend on the chart', () => {
    mockBlends = [composition()];
    mockInjections = { klow: [injection(-3, 0.8)] };
    mockWeeks = {
      '2026-11-16': [plannedSlot('klow', -2, { status: 'missed' })],
    };
    renderCard([klow, ghk, bpc]);
    expect(screen.getAllByTestId('levels-missed')).toHaveLength(1);
  });

  it('is drawn as an ordinary medication until its components are known', () => {
    mockBlends = undefined;
    mockInjections = { klow: [injection(-3, 0.8)] };
    renderCard([med('klow', 'KLOW', { custom_fields: half(5) }), ghk]);
    expect(keys()).toEqual(new Set(['klow_taken', 'klow_ahead']));
  });
});
