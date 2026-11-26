import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import type { LifeEvent } from '@workspace/shared';
import BodyCompSeries from '@/pages/Labs/BodyCompSeries';
import type { ScaleBackground } from '@/pages/Labs/bodyCompScaleModel';
import { makeScan } from './bodyCompTestKit';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
}));

const scan1 = makeScan();
const scan2 = makeScan({ id: 'b', scanned_day: '2026-11-02' });
const scan3 = makeScan({ id: 'c', scanned_day: '2027-02-01' });
const event = (patch: Partial<LifeEvent>): LifeEvent => ({
  id: 'e1',
  kind: 'illness',
  start_day: '2026-09-01',
  end_day: '2026-09-03',
  label: null,
  notes: null,
  ...patch,
});
const panelOf = (name: RegExp) =>
  screen
    .getByRole('img', { name })
    .closest('[data-series-panel]') as HTMLElement;

describe('BodyCompSeries', () => {
  it('shows nothing with no scan', () => {
    const { container } = render(
      <BodyCompSeries scans={[]} tests={[]} lifeEvents={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('draws one SVG per panel, each labelled', () => {
    render(<BodyCompSeries scans={[scan1]} tests={[]} lifeEvents={[]} />);
    for (const title of [
      'Fat mass',
      'Lean mass',
      'Body fat',
      'Appendicular lean (ALM)',
      'Visceral fat (VAT)',
      'Total BMD',
      'Weight',
    ])
      expect(
        screen.getByRole('img', {
          name: `${title}, 1 point(s) with noise bands`,
        })
      ).toBeInTheDocument();
    // No metabolic test, so no resting metabolic rate panel.
    expect(
      screen.queryByText('Resting metabolic rate')
    ).not.toBeInTheDocument();
  });

  it('adds the resting metabolic rate panel from the tests', () => {
    render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[
          {
            tested_day: '2026-08-12',
            measured_rmr_kcal: 1800,
          } as never,
        ]}
        lifeEvents={[]}
      />
    );
    const panel = panelOf(/Resting metabolic rate/);
    expect(within(panel).getByText('1800')).toBeInTheDocument();
    expect(within(panel).getByText('kcal/d')).toBeInTheDocument();
  });

  it('at one scan: forward band label, forward intro, default LSC wording, no line', () => {
    const { container } = render(
      <BodyCompSeries scans={[scan1]} tests={[]} lifeEvents={[]} />
    );
    expect(
      screen.getByText(
        /A future change would need to exceed this band to count\. Bands: default LSC \(device class, not this clinic's precision\)\. No line joins points until three scans exist\./
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText('± LSC forward').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-series-line]')).toBeNull();
    const fat = panelOf(/Fat mass/);
    expect(fat.querySelectorAll('[data-band="technical"]')).toHaveLength(1);
    expect(fat.querySelectorAll('[data-band="practical"]')).toHaveLength(1);
    expect(
      within(fat).getByText(
        'Dark band ± technical LSC, light band ± practical LSC.'
      )
    ).toBeInTheDocument();
  });

  it('gives bands only a technical shade where there is no practical limit', () => {
    render(<BodyCompSeries scans={[scan1]} tests={[]} lifeEvents={[]} />);
    const alm = panelOf(/Appendicular lean/);
    expect(alm.querySelectorAll('[data-band="practical"]')).toHaveLength(0);
    expect(
      within(alm).getByText('Dark band ± technical LSC.')
    ).toBeInTheDocument();
  });

  it('has no band and a plain caption for weight', () => {
    render(<BodyCompSeries scans={[scan1]} tests={[]} lifeEvents={[]} />);
    const weight = panelOf(/Weight/);
    expect(weight.querySelectorAll('[data-band]')).toHaveLength(0);
    expect(within(weight).queryByText('± LSC forward')).not.toBeInTheDocument();
    expect(
      within(weight).getByText(
        'Clinic scale weight at each scan; no noise band is defined for weight.'
      )
    ).toBeInTheDocument();
  });

  it('at two scans: no forward label, still no line', () => {
    const { container } = render(
      <BodyCompSeries scans={[scan2, scan1]} tests={[]} lifeEvents={[]} />
    );
    expect(screen.queryByText('± LSC forward')).not.toBeInTheDocument();
    expect(container.querySelector('[data-series-line]')).toBeNull();
    expect(
      screen.queryByText(/A future change would need to exceed/)
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-series-point]')).toHaveLength(14);
  });

  it('joins points with a line from three scans', () => {
    const { container } = render(
      <BodyCompSeries
        scans={[scan3, scan2, scan1]}
        tests={[]}
        lifeEvents={[]}
      />
    );
    expect(container.querySelectorAll('[data-series-line]')).toHaveLength(7);
    expect(screen.queryByText(/No line joins points/)).not.toBeInTheDocument();
  });

  it('shades life-event windows by kind, with a legend, and not outside the range', () => {
    const { container } = render(
      <BodyCompSeries
        scans={[scan1, scan2]}
        tests={[]}
        lifeEvents={[
          event({ id: 'a', kind: 'illness' }),
          event({
            id: 'b',
            kind: 'travel',
            start_day: '2026-10-01',
            end_day: '2026-10-05',
          }),
          event({
            id: 'c',
            kind: 'other',
            start_day: '2026-10-10',
            end_day: '2026-10-11',
          }),
          event({
            id: 'd',
            kind: 'illness',
            start_day: '2020-01-01',
            end_day: '2020-01-05',
          }),
        ]}
      />
    );
    const fat = panelOf(/Fat mass/);
    const fill = (kind: string) =>
      fat.querySelector(`[data-shade="${kind}"]`)?.getAttribute('fill');
    expect(fill('illness')).toBe('#f59e0b');
    expect(fill('travel')).toBe('#14b8a6');
    expect(fill('other')).toBe('hsl(var(--muted-foreground))');
    // The old window is outside the axis and is not drawn.
    expect(fat.querySelectorAll('[data-shade="illness"]')).toHaveLength(1);
    expect(container.querySelector('[data-shade]')).toHaveAttribute(
      'fill-opacity',
      '0.12'
    );
    expect(
      screen.getByText(
        /Shaded windows: illness \(amber\), travel \(teal\), other \(grey\)\./
      )
    ).toBeInTheDocument();
  });

  it('prints no legend without a window in range', () => {
    render(<BodyCompSeries scans={[scan1]} tests={[]} lifeEvents={[]} />);
    expect(screen.queryByText(/Shaded windows/)).not.toBeInTheDocument();
  });

  it('lets a window set no axis: the dates are the points and the 112-day horizon', () => {
    render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[event({ start_day: '2026-01-01', end_day: '2026-01-05' })]}
      />
    );
    const fat = panelOf(/Fat mass/);
    expect(within(fat).getByText('UK:2026-08-10')).toBeInTheDocument();
    expect(within(fat).getByText('UK:2026-11-30')).toBeInTheDocument();
  });
});

describe('BodyCompSeries scale background', () => {
  const weights = (n: number, base = 82) =>
    Array.from({ length: n }, (_, i) => ({
      day: `2026-08-${String(i + 1).padStart(2, '0')}`,
      weightKg: base + (i % 2) * 0.2,
    }));
  const background = (
    over: Partial<ScaleBackground> = {},
    kept = weights(5)
  ): ScaleBackground => ({
    offsetPts: 7.6,
    scaleDay: '2026-08-10',
    weight: { kept, excluded: [] },
    calibrated: [
      { day: '2026-08-05', calibratedPct: 60 },
      { day: '2026-08-06', calibratedPct: 61 },
    ],
    raw: [],
    ...over,
  });
  const bgOf = (el: HTMLElement) => el.querySelectorAll('[data-series-bg]');

  it('draws cleaned scale weight as a dashed background with its caption', () => {
    render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={background()}
      />
    );
    const weight = panelOf(/Weight/);
    const path = bgOf(weight)[0]!;
    expect(path.tagName).toBe('path');
    expect(path).toHaveAttribute('stroke-dasharray', '3 3');
    expect(
      within(weight).getByText(
        /Dashed: Garmin scale, cleaned \(7-day median, > 3 kg outliers excluded\)\./
      )
    ).toBeInTheDocument();
    expect(within(weight).queryByText(/excluded\.$/)).toBeNull();
    expect(weight.textContent).not.toMatch(/scale readings? excluded/);
  });

  it('adds the excluded count, singular and plural', () => {
    const excluded = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        day: `2026-07-0${i + 1}`,
        weightKg: 60,
      }));
    const { rerender } = render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={{
          ...background(),
          weight: { kept: weights(5), excluded: excluded(1) },
        }}
      />
    );
    expect(
      within(panelOf(/Weight/)).getByText(/1 scale reading excluded\./)
    ).toBeInTheDocument();
    rerender(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={{
          ...background(),
          weight: { kept: weights(5), excluded: excluded(2) },
        }}
      />
    );
    expect(
      within(panelOf(/Weight/)).getByText(/2 scale readings excluded\./)
    ).toBeInTheDocument();
  });

  it('draws the calibrated body fat only with two or more scans', () => {
    const { rerender } = render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={background()}
      />
    );
    expect(bgOf(panelOf(/^Body fat,/))).toHaveLength(0);
    expect(screen.queryByText(/offset to latest DEXA/)).toBeNull();
    rerender(
      <BodyCompSeries
        scans={[scan2, scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={background()}
      />
    );
    const fat = panelOf(/^Body fat,/);
    expect(bgOf(fat)).toHaveLength(1);
    expect(
      within(fat).getByText(
        /Dashed: Garmin scale, offset to latest DEXA — estimate, not a measurement\./
      )
    ).toBeInTheDocument();
  });

  it('never lets the calibrated body fat size the axis, and clips it', () => {
    render(
      <BodyCompSeries
        scans={[scan2, scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={background()}
      />
    );
    const fat = panelOf(/^Body fat,/);
    const labels = [...fat.querySelectorAll('text')].map((x) => x.textContent);
    // Scans read 24.1 %; a 60 % background would push the top label past 60.
    expect(
      Math.max(...labels.map((l) => Number(l)).filter((n) => n > 0))
    ).toBeLessThan(40);
    expect(bgOf(fat)[0]).toHaveAttribute('clip-path');
  });

  it('lets scale weight size the weight axis', () => {
    render(
      <BodyCompSeries
        scans={[scan1]}
        tests={[]}
        lifeEvents={[]}
        scale={background({}, weights(5, 60))}
      />
    );
    const labels = [...panelOf(/Weight/).querySelectorAll('text')].map(
      (x) => x.textContent
    );
    // The y-axis labels come first: the top, then the bottom. Clinic weight is 83 kg, scale 60 kg.
    expect(Number(labels[1])).toBeLessThan(60);
  });

  it('draws a single background reading as a small dot', () => {
    render(
      <BodyCompSeries
        scans={[]}
        tests={[]}
        lifeEvents={[]}
        scale={background({ raw: [{ day: '2026-11-06', bodyFatPct: 18 }] }, [
          { day: '2026-11-06', weightKg: 80 },
        ])}
      />
    );
    const raw = panelOf(/Body fat \(scale\)/);
    expect(bgOf(raw)[0]!.tagName).toBe('circle');
  });

  it('with no scan shows the weight and raw body fat panels and no scan panels', () => {
    const { container } = render(
      <BodyCompSeries
        scans={[]}
        tests={[]}
        lifeEvents={[]}
        scale={background({
          calibrated: [],
          offsetPts: null,
          scaleDay: null,
          raw: [
            { day: '2026-08-01', bodyFatPct: 18 },
            { day: '2026-08-04', bodyFatPct: 17.5 },
          ],
        })}
      />
    );
    expect(
      screen.getByText('Scan series with noise bands', { selector: 'h3' })
    ).toBeInTheDocument();
    const raw = panelOf(/Body fat \(scale\)/);
    expect(
      within(raw).getByText(
        /No scan point yet\. Dashed: Garmin scale, uncalibrated bioimpedance — not a DEXA measurement\./
      )
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-series-point]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-series-panel]')).toHaveLength(2);
    expect(screen.queryByText('± LSC forward')).toBeNull();
  });

  it('draws nothing with no scan and no scale', () => {
    const { container } = render(
      <BodyCompSeries scans={[]} tests={[]} lifeEvents={[]} scale={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
