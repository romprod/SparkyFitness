import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1Coach from '@/pages/Medications/Glp1Coach';
import DiaryMedicationCharts from '@/pages/Diary/DiaryMedicationCharts';
import { serumLevelAt } from '@workspace/shared';
import type { Medication } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue?: string,
      values?: Record<string, unknown>
    ) =>
      defaultValue?.replace(/{{(\w+)}}/g, (_, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const mockFormatDate = jest.fn((date: string | Date, format: string) =>
  new Date(date).toISOString().slice(0, format.includes('HH:mm') ? 16 : 10)
);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDateInUserTimezone: mockFormatDate,
  }),
}));

const mockUseSerumCurve = jest.fn();
const mockUseMedicationInjections = jest.fn(() => ({
  data: undefined as unknown,
}));
jest.mock('@/hooks/useMedications', () => ({
  useSerumCurve: (medId: string) => mockUseSerumCurve(medId),
  useMedicationInjections: () => mockUseMedicationInjections(),
}));

// The surrounding GLP-1 panels each own their own queries; this suite is about the
// PK card's axis switch, so they are stubbed out to keep the tree isolated.
jest.mock('@/pages/Medications/FastingTimer', () => () => null);
jest.mock('@/pages/Medications/Glp1LogInjection', () => () => null);
jest.mock('@/pages/Medications/Glp1InventoryManager', () => () => null);
jest.mock('@/pages/Medications/Glp1TitrationManager', () => () => null);
jest.mock('@/pages/Medications/Glp1RecentInjections', () => () => null);

// Recharts needs a real layout box, which jsdom does not give it. These stubs keep
// the component tree renderable so the assertions can focus on the toggle.
const mockTooltip = jest.fn();
const mockReferenceLine = jest.fn();
const mockXAxis = jest.fn();
jest.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  // AreaChart has to stand in as an <svg>: the component renders a <defs>/
  // <linearGradient>/<stop> gradient inside it, and those are only valid in an
  // SVG context. Standing it in as a <div> strands them and React logs an
  // "unrecognized tag" error for each one on every render.
  const Svg = ({
    children,
    data,
  }: {
    children?: React.ReactNode;
    data?: unknown;
  }) => (
    <svg data-testid="pk-chart" data-points={JSON.stringify(data)}>
      {children}
    </svg>
  );
  const Axis = ({ unit }: { unit?: string }) => (
    <span data-testid="pk-y-axis" data-unit={unit} />
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Container,
    AreaChart: Svg,
    Area: Nothing,
    CartesianGrid: Nothing,
    ReferenceLine: (props: unknown) => {
      mockReferenceLine(props);
      return null;
    },
    Tooltip: (props: unknown) => {
      mockTooltip(props);
      return null;
    },
    XAxis: (props: unknown) => {
      mockXAxis(props);
      return null;
    },
    YAxis: Axis,
  };
});

const med = {
  id: 'med-1',
  name: 'Ozempic',
  type_id: 'injection',
  custom_fields: { glp1_drug: 'semaglutide' },
} as unknown as Medication;

const curve = [
  { day: 0, level: 1, fraction: 1 },
  { day: 7, level: 0.5, fraction: 0.5 },
];

describe('Glp1Coach PK axis switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMedicationInjections.mockReturnValue({ data: undefined });
  });
  afterEach(() => jest.useRealTimers());

  it('offers a Dates/Days switch and defaults to Dates when an anchor exists', () => {
    mockUseSerumCurve.mockReturnValue({
      data: {
        drugId: 'semaglutide',
        drugName: 'Semaglutide',
        curve,
        currentLevelFraction: 0.7,
        doseDays: [0, 7],
        anchorDate: '2026-03-03T09:00:00.000Z',
        disclaimer: 'Modeled estimate',
      },
    });

    render(<Glp1Coach med={med} />);

    const dates = screen.getByRole('button', { name: 'Dates' });
    const days = screen.getByRole('button', { name: 'Days' });
    expect(dates).toHaveAttribute('aria-pressed', 'true');
    expect(days).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the day axis when Days is clicked', () => {
    mockUseSerumCurve.mockReturnValue({
      data: {
        drugId: 'semaglutide',
        curve,
        currentLevelFraction: 0.7,
        doseDays: [0, 7],
        anchorDate: '2026-03-03T09:00:00.000Z',
        disclaimer: 'Modeled estimate',
      },
    });

    render(<Glp1Coach med={med} />);
    fireEvent.click(screen.getByRole('button', { name: 'Days' }));

    expect(screen.getByRole('button', { name: 'Days' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Dates' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('hides the switch when there is no anchor date to plot against', () => {
    mockUseSerumCurve.mockReturnValue({
      data: {
        drugId: 'semaglutide',
        curve,
        currentLevelFraction: 0.7,
        doseDays: [0, 7],
        anchorDate: null,
        disclaimer: 'Modeled estimate',
      },
    });

    render(<Glp1Coach med={med} />);

    expect(screen.queryByRole('button', { name: 'Dates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Days' })).toBeNull();
  });

  it('shows the empty state and no switch when there is no curve', () => {
    mockUseSerumCurve.mockReturnValue({
      data: {
        drugId: null,
        curve: [],
        currentLevelFraction: null,
        doseDays: [],
        anchorDate: null,
        disclaimer: 'Modeled estimate',
      },
    });

    render(<Glp1Coach med={med} />);

    expect(screen.queryByRole('button', { name: 'Dates' })).toBeNull();
    expect(
      screen.getByText(/Log injections to model your serum level/)
    ).toBeInTheDocument();
  });

  it.each([1.5, 3])(
    'shows dose-equivalent mg for a %s mg peak without rescaling the chart',
    (peak) => {
      mockUseSerumCurve.mockReturnValue({
        data: {
          drugId: 'retatrutide',
          drugName: 'Retatrutide',
          curve: [
            { day: 0, level: 0, fraction: 0 },
            { day: 3, level: peak, fraction: 1 },
          ],
          currentLevelFraction: 0.8,
          doseDays: [0, 2.4],
          anchorDate: '2026-11-10T13:00:00.000Z',
        },
      });

      render(<Glp1Coach med={med} />);

      expect(
        screen.getByText(`~${(peak * 0.8).toFixed(2)} mg now`)
      ).toBeInTheDocument();
      expect(screen.getByTestId('pk-y-axis')).toHaveAttribute(
        'data-unit',
        ' mg'
      );
      const points = JSON.parse(
        screen.getByTestId('pk-chart').getAttribute('data-points')!
      );
      expect(
        screen.getByText('Modelled absorbed amount — Retatrutide')
      ).toBeInTheDocument();
      expect(mockTooltip.mock.calls.at(-1)![0].formatter(0.84)).toEqual([
        '0.84 mg',
        'Modelled absorbed amount',
      ]);
      expect(points[1].amountMg).toBe(peak);
      expect(points[1]).not.toHaveProperty('pct');
      expect(screen.queryByText(/% now/)).toBeNull();
      expect(screen.getByText(/assuming full absorption/)).toBeInTheDocument();
    }
  );

  it('accounts for the whole dose at injection and adds site plus absorbed amounts across doses', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T13:00:00.000Z'));
    const anchorDate = '2026-11-10T13:00:00.000Z';
    mockUseMedicationInjections.mockReturnValue({
      data: [
        { injected_at: '2026-11-12T13:00:00.000Z', dose_mg: 2 },
        { injected_at: anchorDate, dose_mg: 1 },
      ],
    });
    mockUseSerumCurve.mockReturnValue({
      data: {
        drugId: 'retatrutide',
        drugName: 'Retatrutide',
        anchorDate,
        curve: [
          { day: 0, level: 0 },
          { day: 1.5, level: 0.84 },
          {
            day: 4,
            level: serumLevelAt(
              4,
              [
                { day: 0, doseMg: 1 },
                { day: 2, doseMg: 2 },
              ],
              { halfLifeDays: 6, tMaxDays: 1.5 }
            ),
          },
        ],
        currentLevelFraction: 0.5,
        doseDays: [0, 2],
      },
    });
    render(
      <Glp1Coach
        med={{
          ...med,
          name: 'Retatrutide',
          custom_fields: { glp1_drug: 'retatrutide' },
        }}
      />
    );
    const points = JSON.parse(
      screen.getByTestId('pk-chart').getAttribute('data-points')!
    );
    expect(points[0]).toMatchObject({ amountMg: 0, siteMg: 1, totalMg: 1 });
    const firstPeak = points.find((p: { day: number }) => p.day === 1.5);
    expect(firstPeak.amountMg).toBeCloseTo(0.8408964, 6);
    expect(firstPeak.siteMg).toBeGreaterThan(0);
    const atDose = points.findIndex((p: { day: number }) => p.day === 2);
    expect(points[atDose].totalMg - points[atDose - 1].totalMg).toBeCloseTo(
      2,
      6
    );
    expect(points[atDose].amountMg).toBeCloseTo(points[atDose - 1].amountMg, 6);
    for (const point of points) {
      expect(point.totalMg).toBeCloseTo(point.amountMg + point.siteMg, 12);
      expect(point.totalMg).toBeLessThanOrEqual(point.day < 2 ? 1 : 3);
    }
    expect(screen.getByText('Modelled at injection sites')).toBeInTheDocument();
    expect(screen.getByText('Modelled total remaining')).toBeInTheDocument();
    const tooltip = mockTooltip.mock.calls.at(-1)![0];
    expect(tooltip.formatter(1, 'siteMg')).toEqual([
      '1.00 mg',
      'Modelled at injection sites',
    ]);
    expect(tooltip.formatter(2, 'totalMg')).toEqual([
      '2.00 mg',
      'Modelled total remaining',
    ]);
    expect(tooltip.formatter(0.001, 'siteMg')[0]).toBe('<0.01 mg');
  });

  it('does not invent site or total amounts when injection and curve windows differ', () => {
    mockUseMedicationInjections.mockReturnValue({
      data: [{ injected_at: '2026-11-10T13:00:00.000Z', dose_mg: 1 }],
    });
    mockUseSerumCurve.mockReturnValue({
      data: {
        anchorDate: '2026-11-10T13:00:00.000Z',
        curve,
        doseDays: [0, 2],
        currentLevelFraction: 0.5,
      },
    });
    render(<Glp1Coach med={med} />);
    expect(screen.queryByText('Modelled total remaining')).toBeNull();
  });

  it('shows themed hover content with an accurate date and time in either axis mode', () => {
    const anchorDate = '2026-11-10T13:00:00.000Z';
    mockUseSerumCurve.mockReturnValue({
      data: {
        curve: [
          { day: 0, level: 0, fraction: 0 },
          { day: 0.0833, level: 0.1, fraction: 0.1 },
        ],
        currentLevelFraction: 0.8,
        doseDays: [0],
        anchorDate,
      },
    });
    render(<Glp1Coach med={med} />);

    const points = JSON.parse(
      screen.getByTestId('pk-chart').getAttribute('data-points')!
    );
    expect(points[1].day).toBe(0.0833);
    expect(points[1].ts - points[0].ts).toBe(2 * 60 * 60 * 1000);
    const tooltip = mockTooltip.mock.calls.at(-1)![0];
    expect(tooltip.contentStyle.backgroundColor).toBe('hsl(var(--popover))');
    expect(tooltip.labelStyle.color).toBe('hsl(var(--popover-foreground))');
    expect(tooltip.labelFormatter(points[1].ts)).toBe('2026-11-10T15:00');
    expect(mockFormatDate).toHaveBeenLastCalledWith(
      new Date('2026-11-10T15:00:00.000Z'),
      'dd MMM yyyy, HH:mm'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Days' }));
    const dayTooltip = mockTooltip.mock.calls.at(-1)![0];
    expect(dayTooltip.labelFormatter(points[1].day)).toBe('2026-11-10T15:00');
  });

  it('marks the current instant in both axis modes and moves forward each minute', () => {
    const now = new Date('2026-11-14T18:00:00.000Z').getTime();
    jest.useFakeTimers({ now });
    mockUseSerumCurve.mockReturnValue({
      data: { curve, doseDays: [0], anchorDate: '2026-11-10T13:00:00.000Z' },
    });
    render(<Glp1Coach med={med} />);
    const latestNowLine = () =>
      mockReferenceLine.mock.calls
        .filter(([props]) => props.label?.value?.startsWith('Now'))
        .at(-1)![0];

    expect(latestNowLine().x).toBe(now);
    expect(latestNowLine().label.value).toContain('2026-11-14T18:00');
    expect(latestNowLine().stroke).toBe('#f59e0b');
    act(() => jest.advanceTimersByTime(60_000));
    expect(latestNowLine().x).toBe(now + 60_000);
    expect(latestNowLine().label.value).toContain('2026-11-14T18:01');

    fireEvent.click(screen.getByRole('button', { name: 'Days' }));
    const anchor = new Date('2026-11-10T13:00:00.000Z').getTime();
    expect(latestNowLine().x).toBeCloseTo((now + 60_000 - anchor) / 86_400_000);
  });

  it('labels every day without skipping ticks in either axis mode', () => {
    const anchor = new Date('2026-11-10T13:00:00.000Z').getTime();
    mockUseSerumCurve.mockReturnValue({
      data: {
        curve: [
          { day: 0, level: 0, fraction: 0 },
          { day: 14.4, level: 0.5, fraction: 0.5 },
        ],
        doseDays: [],
        anchorDate: new Date(anchor).toISOString(),
      },
    });
    render(<Glp1Coach med={med} />);
    const dateAxis = mockXAxis.mock.calls.at(-1)![0];
    expect(dateAxis.interval).toBe(0);
    expect(dateAxis.ticks).toEqual(
      Array.from({ length: 15 }, (_, day) => anchor + day * 86_400_000)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Days' }));
    const dayAxis = mockXAxis.mock.calls.at(-1)![0];
    expect(dayAxis.interval).toBe(0);
    expect(dayAxis.ticks).toEqual(Array.from({ length: 15 }, (_, day) => day));
  });

  it.each([null, '2020-01-01T00:00:00.000Z'])(
    'does not invent or extend a current-time marker for anchor %s',
    (anchorDate) => {
      jest.useFakeTimers({ now: new Date('2026-11-14T18:00:00.000Z') });
      mockUseSerumCurve.mockReturnValue({
        data: { curve, doseDays: [], anchorDate },
      });
      render(<Glp1Coach med={med} />);
      expect(
        mockReferenceLine.mock.calls.some(([props]) =>
          props.label?.value?.startsWith('Now')
        )
      ).toBe(false);
    }
  );
});

it('Diary reuses separate chart cards and current Now controls for each named medication', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  const anchorDate = '2026-11-13T12:00:00Z';
  mockUseMedicationInjections.mockReturnValue({
    data: [{ injected_at: anchorDate, dose_mg: 1 }],
  });
  mockUseSerumCurve.mockReturnValue({
    data: {
      drugId: 'semaglutide',
      curve: [
        { day: 0, level: 0 },
        {
          day: 2,
          level: serumLevelAt(2, [{ day: 0, doseMg: 1 }], {
            halfLifeDays: 7,
            tMaxDays: 1.5,
          }),
        },
      ],
      currentLevelFraction: 0.7,
      doseDays: [0],
      anchorDate,
    },
  });
  const { container } = render(
    <DiaryMedicationCharts
      medications={[
        { ...med, id: 'a', display_name: 'Medication A' },
        { ...med, id: 'b', display_name: 'Medication B' },
      ]}
    />
  );
  expect(
    screen.getByRole('region', { name: 'Medication A' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Medication B' })
  ).toBeInTheDocument();
  expect(mockUseSerumCurve).toHaveBeenCalledWith('a');
  expect(mockUseSerumCurve).toHaveBeenCalledWith('b');
  expect(screen.getAllByRole('button', { name: 'Dates' })).toHaveLength(2);
  expect(screen.getAllByText('Modelled at injection sites')).toHaveLength(2);
  expect(screen.getAllByText('Modelled total remaining')).toHaveLength(2);
  const nowLines = mockReferenceLine.mock.calls.filter(([props]) =>
    props.label?.value?.startsWith('Now')
  );
  expect(nowLines.at(-1)?.[0].x).toBe(Date.now());
  const gradients = Array.from(
    container.querySelectorAll('linearGradient')
  ).map((el) => el.id);
  expect(new Set(gradients).size).toBe(2);
  expect(
    screen.getByText(/independent of the selected diary date/)
  ).toBeInTheDocument();
  jest.useRealTimers();
});

it.each([
  ['2026-11-10T13:01:00Z', 'insideTopLeft'],
  ['2026-11-17T12:59:00Z', 'insideTopRight'],
])(
  'keeps the Now label facing into the plot at either edge (%s)',
  (now, position) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    mockUseMedicationInjections.mockReturnValue({ data: undefined });
    mockUseSerumCurve.mockReturnValue({
      data: { curve, doseDays: [0], anchorDate: '2026-11-10T13:00:00Z' },
    });
    render(<Glp1Coach med={med} />);
    const marker = mockReferenceLine.mock.calls
      .filter(([props]) => props.label?.value?.startsWith('Now'))
      .at(-1)![0];
    expect(marker.label.position).toBe(position);
    expect(marker.x).toBe(new Date(now).getTime());
    expect(marker.stroke).toBe('#f59e0b');
    jest.useRealTimers();
  }
);
