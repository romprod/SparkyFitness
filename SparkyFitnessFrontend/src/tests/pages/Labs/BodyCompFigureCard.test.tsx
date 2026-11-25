import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BodyCompFigureCard from '@/pages/Labs/BodyCompFigureCard';
import { SIX_REGIONS, makeScan, region } from './bodyCompTestKit';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
}));

const withPct = (name: Parameters<typeof region>[0], pct: number) =>
  region(name, 1000, 4000, 200, { pct_fat: pct });
const prev = makeScan({
  id: 'prev',
  scanned_day: '2026-05-01',
  regions: [
    withPct('l_arm', 20),
    withPct('r_arm', 20),
    withPct('trunk', 20),
    withPct('head', 20),
  ],
});
const latest = (extra: Parameters<typeof makeScan>[0] = {}) =>
  makeScan({
    regions: [
      withPct('l_arm', 20.3),
      withPct('r_arm', 21),
      withPct('trunk', 22),
      withPct('head', 20),
      withPct('l_leg', 18),
    ],
    ...extra,
  });
const rowOf = (region: string) =>
  document.querySelector(`[data-region-row="${region}"]`) as HTMLElement;
const shapeOf = (region: string) =>
  document.querySelector(`g[data-region="${region}"]`) as SVGGElement;

describe('BodyCompFigureCard', () => {
  it('shows nothing when the latest scan has no regions', () => {
    const { container } = render(
      <BodyCompFigureCard scans={[makeScan({ regions: [] })]} />
    );
    expect(container).toBeEmptyDOMElement();
    const none = render(<BodyCompFigureCard scans={[]} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it('draws the six regions filled by fat % and labelled with the printed value', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    expect(
      screen.getByRole('heading', { name: 'Regional distribution' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /Body outline: fat percentage per region/,
      })
    ).toBeInTheDocument();
    for (const name of ['head', 'l_arm', 'r_arm', 'trunk', 'l_leg', 'r_leg'])
      expect(shapeOf(name)).toHaveAttribute('data-lit', 'true');
    expect(
      document.querySelector('[data-figure-label="trunk"]')
    ).toHaveTextContent('26.4');
    // Fill follows the % fat: the 26 % trunk is warmer than the 14 % arm.
    const hue = (name: string) =>
      Number(
        /hsl\((\d+)/.exec(
          shapeOf(name).querySelector('path,ellipse')!.getAttribute('fill')!
        )![1]
      );
    expect(hue('trunk')).toBeLessThan(hue('l_arm'));
    expect(screen.getByText('UK:2026-08-10')).toBeInTheDocument();
  });

  it('draws the subject’s left on the viewer’s left', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    const centre = (name: string) => {
      const label = document.querySelector(`[data-figure-label="${name}"]`)!;
      return Number(label.getAttribute('x'));
    };
    expect(centre('l_arm')).toBeLessThan(centre('r_arm'));
    expect(centre('l_leg')).toBeLessThan(centre('r_leg'));
  });

  it('copies Pitstop’s figure words and says it is a drawn outline', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    expect(
      screen.getByText(/The figure is a drawn outline, not the scan image/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Android and gynoid are listed in the table only/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The number is the region’s fat percentage as printed/)
    ).toBeInTheDocument();
    expect(screen.getByText('fat 12 → 28 %')).toBeInTheDocument();
  });

  it('lists the regions the report did not print and leaves them unlit', () => {
    render(
      <BodyCompFigureCard
        scans={[
          makeScan({
            regions: SIX_REGIONS().filter((r) => r.region !== 'head'),
          }),
        ]}
      />
    );
    expect(shapeOf('head')).toHaveAttribute('data-lit', 'false');
    expect(document.querySelector('[data-figure-label="head"]')).toBeNull();
    expect(
      screen.getByText(/A region the report did not print is left unlit\./)
    ).toBeInTheDocument();
    expect(document.querySelector('[data-figure-missing]')).toHaveTextContent(
      'Not printed: Head, Android, Gynoid.'
    );
  });

  it('lists android and gynoid in the table though they are not drawn', () => {
    render(
      <BodyCompFigureCard
        scans={[
          makeScan({
            regions: [
              ...SIX_REGIONS(),
              region('android', 2000, 5000, null),
              region('gynoid', 3000, 7000, null),
            ],
          }),
        ]}
      />
    );
    expect(rowOf('android')).toBeInTheDocument();
    expect(rowOf('gynoid')).toBeInTheDocument();
    expect(shapeOf('android')).toBeNull();
    expect(within(rowOf('android')).getByText('Android')).toBeInTheDocument();
  });

  it('selecting a row highlights the region, and selecting a region highlights its row', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    fireEvent.click(
      within(rowOf('trunk')).getByRole('button', { name: 'Trunk' })
    );
    expect(shapeOf('trunk')).toHaveAttribute('data-active', 'true');
    expect(rowOf('trunk')).toHaveAttribute('data-active', 'true');
    expect(shapeOf('l_arm')).not.toHaveAttribute('data-active');
    // The summary reads the region.
    expect(screen.getByText('Fat')).toBeInTheDocument();
    fireEvent.click(shapeOf('l_leg'));
    expect(shapeOf('l_leg')).toHaveAttribute('data-active', 'true');
    expect(rowOf('l_leg')).toHaveAttribute('data-active', 'true');
    expect(rowOf('trunk')).not.toHaveAttribute('data-active');
    // Selecting it again clears it.
    fireEvent.click(shapeOf('l_leg'));
    expect(rowOf('l_leg')).not.toHaveAttribute('data-active');
    expect(screen.getByText('Whole body')).toBeInTheDocument();
  });

  it('highlights on hover and clears when the pointer leaves', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    fireEvent.mouseEnter(shapeOf('head'));
    expect(rowOf('head')).toHaveAttribute('data-active', 'true');
    fireEvent.mouseLeave(shapeOf('head'));
    expect(rowOf('head')).not.toHaveAttribute('data-active');
  });

  it('reads the whole body when nothing is selected', () => {
    render(<BodyCompFigureCard scans={[makeScan()]} />);
    expect(screen.getByText('Whole body')).toBeInTheDocument();
    expect(screen.getByText('83.00 kg')).toBeInTheDocument();
    expect(screen.getByText('Arm lean asymmetry (R − L)')).toBeInTheDocument();
  });

  describe('Levels and Change', () => {
    it('disables Change with one scan', () => {
      render(<BodyCompFigureCard scans={[makeScan()]} />);
      const change = screen.getByRole('button', { name: 'Change' });
      expect(change).toBeDisabled();
      expect(change).toHaveAttribute(
        'title',
        'Needs a previous comparable scan'
      );
      expect(screen.getByRole('button', { name: 'Levels' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('disables Change when the scans were taken on different scanners', () => {
      render(
        <BodyCompFigureCard scans={[latest({ device_serial: 'S2' }), prev]} />
      );
      expect(screen.getByRole('button', { name: 'Change' })).toBeDisabled();
    });

    it('tints each region by tier in the change view, with the LSC band in the legend', () => {
      render(<BodyCompFigureCard scans={[latest(), prev]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      expect(screen.getByRole('button', { name: 'Change' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(
        screen.getByRole('img', { name: /change in fat percentage per region/ })
      ).toBeInTheDocument();
      expect(
        screen.getByText('UK:2026-08-10 vs UK:2026-05-01')
      ).toBeInTheDocument();
      const fill = (name: string) =>
        shapeOf(name).querySelector('path,ellipse')!.getAttribute('fill');
      // 0.3 inside noise, 1.0 possible, 2.0 beyond the practical limit.
      expect(fill('l_arm')).toBe('hsl(var(--muted-foreground))');
      expect(fill('r_arm')).toBe('#f59e0b');
      expect(fill('trunk')).toBe('hsl(var(--primary))');
      expect(
        document.querySelector('[data-figure-label="trunk"]')
      ).toHaveTextContent('+2.0');
      // A region the previous report did not print has no tint and a dash.
      expect(
        document.querySelector('[data-figure-label="l_leg"]')
      ).toHaveTextContent('—');
      const legend = document.querySelector(
        '[data-legend="change"]'
      ) as HTMLElement;
      expect(legend).toHaveTextContent(
        'fat % vs the previous scan · LSC 0.5 / 1.7 pts'
      );
      expect(legend).not.toHaveTextContent('demoted');
      expect(within(legend).getByText('Possible change')).toBeInTheDocument();
      // The table switches to deltas with the card’s own tier words.
      expect(
        within(rowOf('trunk')).getByText('Beyond measurement noise')
      ).toBeInTheDocument();
      expect(
        within(rowOf('l_arm')).getByText('Within measurement noise')
      ).toBeInTheDocument();
      expect(
        within(rowOf('l_leg')).getByText('not on the previous report')
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Change view tints each region/)
      ).toBeInTheDocument();
    });

    it('says demoted when the scans were not taken alike', () => {
      render(
        <BodyCompFigureCard
          scans={[
            latest({ prep: { ...makeScan().prep, fasted: false } }),
            prev,
          ]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      const legend = document.querySelector(
        '[data-legend="change"]'
      ) as HTMLElement;
      expect(legend).toHaveTextContent('· demoted');
      // 2.0 points is beyond the practical limit, lowered a step to possible change.
      const fill = shapeOf('trunk').querySelector('path')!.getAttribute('fill');
      expect(fill).toBe('#f59e0b');
      expect(within(rowOf('trunk')).getByText('(demoted)')).toBeInTheDocument();
    });

    it('can go back to levels', () => {
      render(<BodyCompFigureCard scans={[latest(), prev]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
      expect(
        document.querySelector('[data-legend="levels"]')
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-figure-label="trunk"]')
      ).toHaveTextContent('22.0');
    });

    it('uses the previous scan by date, whatever order they arrive in', () => {
      render(<BodyCompFigureCard scans={[prev, latest()]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      expect(
        screen.getByText('UK:2026-08-10 vs UK:2026-05-01')
      ).toBeInTheDocument();
    });
  });

  it('attributes nothing: none of the causal phrases appear in its copy', () => {
    render(<BodyCompFigureCard scans={[latest(), prev]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const text = document.body.textContent!.toLowerCase();
    for (const phrase of [
      'caused',
      'causes',
      'because of',
      'due to',
      'led to',
      'leads to',
      'resulted in',
      'results in',
      'thanks to',
      'effect of',
      'improved by',
      'worsened by',
      'attributable',
      'drove',
      'driven by',
    ])
      expect(text).not.toContain(phrase);
  });
});
