import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BodyCompPrepChecklist from '@/pages/Labs/BodyCompPrepChecklist';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <BodyCompPrepChecklist />
    </MemoryRouter>
  );

const GROUPS: Record<string, string[]> = {
  'Same setup as the last scan': [
    'Same machine — check the device serial on the report',
    'Same software version',
    'Same technologist, if the clinic can arrange it',
    'Same positioning protocol (ask the clinic to follow their last-visit notes)',
  ],
  'The 48 hours before': [
    'Normal carbohydrate intake — no loading, no depletion',
    'Creatine unchanged — same dose as the previous month, or none both times',
    'Same secretagogue state as the last scan — same compounds, similar days since the last dose',
    'No illness in the 14 days before (fever, infection, gut illness)',
  ],
  'The morning of': [
    'Morning appointment',
    '12 h fasted — water only',
    'No caffeine',
    'No training in the previous 24 h',
    'No active travel to the clinic — no cycling or long walk',
    'Normal fluids the day before; bladder emptied just before the scan',
    'Remove metal: jewellery, belt, zips, underwired garments',
  ],
  'RMR extras': [
    'Rest 20–30 minutes seated or lying before the mask goes on',
    'Awake and still during the test — no talking, reading or dozing',
    'Ask for the printed VO2 (mL/min) and the steady-state CV %',
    'Ask which equation and activity factor the clinic used for its predicted numbers',
  ],
  'Ask the clinic': [
    'A same-day repositioned duplicate scan (get off the table, get back on, scan again)',
    'A next-morning repeat under the same preparation',
    "The site's own precision figures (CV %) for fat, lean and BMD, if they have them",
  ],
};

describe('BodyCompPrepChecklist', () => {
  it('renders the intro and the four fill-in lines', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Pre-visit checklist' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Print this before a DEXA or RMR visit/)
    ).toBeInTheDocument();
    for (const label of [
      'Visit date:',
      'Clinic:',
      'Hours fasted at scan:',
      'Days since last secretagogue dose:',
    ]) {
      expect(screen.getByText(new RegExp(`^${label}`))).toBeInTheDocument();
    }
  });

  it('renders every group with its subtitle and every item', () => {
    renderPage();
    for (const [title, items] of Object.entries(GROUPS)) {
      const heading = screen.getByRole('heading', { name: title });
      const section = heading.closest('section') as HTMLElement;
      expect(within(section).getAllByRole('listitem')).toHaveLength(
        items.length
      );
      for (const item of items) {
        expect(within(section).getByText(item)).toBeInTheDocument();
      }
    }
    expect(
      screen.getByText(/Presentation noise moves lean more than the scanner/)
    ).toBeInTheDocument();
  });

  it('renders the cadence section and the disclaimer', () => {
    renderPage();
    const section = screen
      .getByRole('heading', { name: 'Cadence' })
      .closest('section') as HTMLElement;
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(section).getByText(/never under 6 weeks\.$/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here attributes a change to any compound/)
    ).toBeInTheDocument();
  });

  it('points to Labs and calls window.print from the screen-only controls', () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Print/ }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /Back to Labs/ })).toHaveAttribute(
      'href',
      '/labs'
    );
    expect(
      screen.getByRole('link', {
        name: 'Labs → Body composition (DEXA) → Add a scan',
      })
    ).toHaveAttribute('href', '/labs');
    expect(
      screen.getByText(/Use your browser's print command/).closest('.no-print')
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Print/ }).closest('.no-print')
    ).not.toBeNull();
    print.mockRestore();
  });

  it('scopes its print styles to the page', () => {
    const { container } = renderPage();
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@media print');
    expect(css).toContain('break-inside: avoid');
    expect(css).toContain('content: none');
  });
});
