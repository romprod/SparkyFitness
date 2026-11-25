import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { LabComparisonPanel } from '@workspace/shared';
import LabOverview from '@/pages/Labs/LabOverview';
import LabTrends from '@/pages/Labs/LabTrends';
import { buildLabTrends } from '@/pages/Labs/labTrendData';
import { result } from './labsTestKit';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Passthrough,
    LineChart: Passthrough,
    Line: () => null,
    CartesianGrid: () => null,
    ReferenceArea: () => null,
    ReferenceLine: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

const labels = { hba1c: 'HbA1c', ldl: 'LDL cholesterol', alt: 'ALT' };
const panel = (
  id: string,
  collected_on: string,
  results: LabComparisonPanel['results']
): LabComparisonPanel => ({
  id,
  collected_on,
  created_at: `${collected_on}T12:00:00Z`,
  lab_name: null,
  results,
});
const hba1c = (id: string, value: number, over = {}) =>
  result({ id, marker_key: 'hba1c', value_numeric: value, ...over });

const overview = (panels: LabComparisonPanel[]) =>
  render(
    <LabOverview
      panels={panels}
      customMarkers={[]}
      labels={labels}
      sex={null}
    />
  );

describe('Lab overview', () => {
  it('counts the newest panel against its ranges and the markers that moved toward them', () => {
    overview([
      panel('new', '2026-03-01', [
        hba1c('a', 5.1), // in range (4 - 5.6)
        result({
          id: 'b',
          marker_key: 'ldl',
          value_numeric: 160,
          unit: 'mg/dL',
        }), // judged by its own range
      ]),
      panel('prior', '2026-02-01', [hba1c('c', 6.2)]), // out of range, now closer
    ]);
    // HbA1c 5.1 is inside 4 - 5.6; the LDL reading carries the same default range and is above it.
    expect(screen.getByTestId('lab-overview-in-range')).toHaveTextContent(
      '1 of 2 in range'
    );
    expect(screen.getByText('1 marker improving vs prior panel')).toBeVisible();
    expect(screen.getByText(/Trend/)).toBeInTheDocument();
  });

  it('never counts a result with no reference range as in range', () => {
    overview([
      panel('new', '2026-03-01', [
        hba1c('a', 5.1),
        result({
          id: 'b',
          marker_key: null,
          custom_marker_id: '11111111-1111-4111-8111-111111111111',
          value_numeric: 4,
          unit: 'u',
          ref_range_low: null,
          ref_range_high: null,
        }),
      ]),
    ]);
    expect(screen.getByTestId('lab-overview-in-range')).toHaveTextContent(
      '1 of 1 in range'
    );
    expect(
      screen.getByText('1 result without a reference range is not counted')
    ).toBeInTheDocument();
  });

  it('leaves qualified text results out of every count', () => {
    overview([
      panel('new', '2026-03-01', [
        hba1c('a', 5.1),
        result({
          id: 'b',
          marker_key: 'ldl',
          value_numeric: null,
          value_text: '>90',
          unit: 'mg/dL',
        }),
      ]),
    ]);
    expect(screen.getByTestId('lab-overview-in-range')).toHaveTextContent(
      '1 of 1 in range'
    );
    expect(screen.queryByText(/without a reference range/)).toBeNull();
  });

  it('counts an out-of-range result in the total but not in range, and shows no trend badge', () => {
    overview([
      panel('new', '2026-03-01', [
        hba1c('a', 5.1),
        hba1c('b', 7, {
          marker_key: 'ldl',
          unit: 'mg/dL',
          ref_range_low: null,
          ref_range_high: 5,
        }),
      ]),
    ]);
    expect(screen.getByTestId('lab-overview-in-range')).toHaveTextContent(
      '1 of 2 in range'
    );
    expect(
      screen.getByText('0 markers improving vs prior panel')
    ).toBeVisible();
    expect(screen.queryByText(/Trend/)).toBeNull();
  });

  it('adds a borderline count only when a counted result is outside its optimal band', () => {
    overview([
      panel('new', '2026-03-01', [
        hba1c('a', 5.5), // in range (4 - 5.6) but over the optimal 5.4
        result({
          id: 'b',
          marker_key: 'hdl',
          value_numeric: 1.31,
          unit: 'mmol/L',
          ref_range_low: 1,
          ref_range_high: null,
        }),
      ]),
    ]);
    expect(screen.getByTestId('lab-overview-in-range')).toHaveTextContent(
      '2 of 2 in range, 1 borderline'
    );
  });

  it('shows no borderline text when none is borderline', () => {
    overview([panel('new', '2026-03-01', [hba1c('a', 5.1)])]);
    expect(screen.getByTestId('lab-overview-in-range')).not.toHaveTextContent(
      'borderline'
    );
  });

  it('shows nothing without a panel or without any judged number', () => {
    const { container, rerender } = overview([]);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <LabOverview
        panels={[
          panel('new', '2026-03-01', [
            result({ value_numeric: null, value_text: '<3' }),
          ]),
        ]}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Lab trends', () => {
  const history = [
    panel('p1', '2026-01-01', [
      hba1c('a1', 6.4),
      result({
        id: 'l1',
        marker_key: 'ldl',
        value_numeric: 120,
        unit: 'mg/dL',
        ref_range_low: null,
        ref_range_high: 99,
      }),
    ]),
    panel('p2', '2026-02-01', [
      hba1c('a2', 5.9),
      result({
        id: 'l2',
        marker_key: 'ldl',
        value_numeric: 110,
        unit: 'mg/dL',
        ref_range_low: null,
        ref_range_high: 99,
      }),
    ]),
    panel('p3', '2026-03-01', [
      hba1c('a3', 5.1),
      result({ id: 'alt', marker_key: 'alt', value_numeric: 20, unit: 'iu/L' }),
    ]),
  ];

  it('builds a series only for markers with two or more exact readings, oldest first', () => {
    const trends = buildLabTrends(history, [], labels, null);
    expect(trends.map((t) => t.name)).toEqual(['LDL cholesterol', 'HbA1c']);
    const hb = trends.find((t) => t.name === 'HbA1c');
    expect(hb?.points.map((p) => [p.day, p.value])).toEqual([
      ['2026-01-01', 6.4],
      ['2026-02-01', 5.9],
      ['2026-03-01', 5.1],
    ]);
    expect(hb?.latest.status).toBe('in_range');
    // ALT has one reading: no trend card for it.
    expect(trends.some((t) => t.name === 'ALT')).toBe(false);
  });

  it('puts markers that are out of range first', () => {
    const trends = buildLabTrends(history, [], labels, null);
    expect(trends[0]?.name).toBe('LDL cholesterol');
    expect(trends[0]?.latest.status).toBe('high');
  });

  it('leaves out readings in another unit than the newest and qualified text', () => {
    const trends = buildLabTrends(
      [
        panel('p1', '2026-01-01', [
          hba1c('a1', 48, {
            unit: 'mmol/mol',
            ref_range_low: 20,
            ref_range_high: 42,
          }),
        ]),
        panel('p2', '2026-02-01', [hba1c('a2', 6.1)]),
        panel('p3', '2026-03-01', [hba1c('a3', 5.5)]),
        panel('p4', '2026-04-01', [
          result({ id: 'a4', value_numeric: null, value_text: '<3' }),
        ]),
      ],
      [],
      labels,
      null
    );
    expect(trends).toHaveLength(1);
    expect(trends[0]?.points.map((p) => p.value)).toEqual([6.1, 5.5]);
    expect(trends[0]?.unit).toBe('%');
  });

  it('shows the first cards, then all of them on request', () => {
    const many = ['p1', 'p2'].map((id, i) =>
      panel(
        id,
        `2026-0${i + 1}-01`,
        ['hba1c', 'ldl', 'alt', 'hdl', 'tsh', 'crp', 'ferritin'].map((key) =>
          result({
            id: `${id}-${key}`,
            marker_key: key,
            value_numeric: 1 + i,
            unit: 'u',
            ref_range_low: null,
            ref_range_high: null,
          })
        )
      )
    );
    render(
      <LabTrends panels={many} customMarkers={[]} labels={labels} sex={null} />
    );
    expect(screen.getAllByTestId('lab-trend-card')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 7 trends' }));
    expect(screen.getAllByTestId('lab-trend-card')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByTestId('lab-trend-card')).toHaveLength(6);
  });

  it('writes the latest value with its unit and flags it when out of range', () => {
    render(
      <LabTrends
        panels={history}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    const cards = screen.getAllByTestId('lab-trend-card');
    const ldl = cards[0];
    if (!ldl) throw new Error('Missing trend card');
    expect(within(ldl).getByText('LDL cholesterol')).toBeInTheDocument();
    expect(ldl).toHaveTextContent('110 mg/dL');
    expect(ldl).toHaveTextContent('(High)');
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('shows the band caption only when a shown chart has an optimal band', () => {
    const { rerender } = render(
      <LabTrends
        panels={history}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    expect(screen.getByTestId('lab-band-caption')).toHaveTextContent(
      'Shaded band = optimal target. Grey band = lab reference.'
    );
    const noBand = ['p1', 'p2'].map((id, i) =>
      panel(id, `2026-0${i + 1}-01`, [
        result({
          id: `${id}-alt`,
          marker_key: 'alt',
          value_numeric: 20 + i,
          unit: 'U/L',
        }),
      ])
    );
    rerender(
      <LabTrends
        panels={noBand}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    expect(screen.queryByTestId('lab-band-caption')).toBeNull();
  });

  it('says only the optimal part when no chart has a reference band', () => {
    const noRange = ['p1', 'p2'].map((id, i) =>
      panel(id, `2026-0${i + 1}-01`, [
        result({
          id: `${id}-ldl`,
          marker_key: 'ldl',
          value_numeric: 3 + i,
          unit: 'mmol/L',
          ref_range_low: null,
          ref_range_high: null,
        }),
      ])
    );
    render(
      <LabTrends
        panels={noRange}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    expect(screen.getByTestId('lab-band-caption')).toHaveTextContent(
      /^Shaded band = optimal target\.$/
    );
  });

  it('renders nothing when no marker has two readings', () => {
    const { container } = render(
      <LabTrends
        panels={[panel('p1', '2026-01-01', [hba1c('a1', 5)])]}
        customMarkers={[]}
        labels={labels}
        sex={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
