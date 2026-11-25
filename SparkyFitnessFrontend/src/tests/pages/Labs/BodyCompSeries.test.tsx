import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import type { LifeEvent } from '@workspace/shared';
import BodyCompSeries from '@/pages/Labs/BodyCompSeries';
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
