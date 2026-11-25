import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import type {
  LabComparisonPanel,
  LabComparisonResult,
} from '@workspace/shared';
import BodyCompNearestLabs from '@/pages/Labs/BodyCompNearestLabs';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
}));
let mockPanels: {
  data?: { panels: LabComparisonPanel[] };
  isLoading?: boolean;
  isError?: boolean;
} = {};
jest.mock('@/hooks/Labs/useLabResults', () => ({
  useLabPanels: () => mockPanels,
  useLabMarkers: () => ({ data: [{ id: 'c-1', name: 'Ferritin' }] }),
}));

const result = (over: Partial<LabComparisonResult>): LabComparisonResult => ({
  id: 'r',
  marker_key: 'hba1c',
  custom_marker_id: null,
  entry_date: '2026-10-30',
  value_numeric: 5.1,
  value_text: null,
  unit: '%',
  ref_range_low: 4,
  ref_range_high: 5.6,
  ...over,
});
const panel = (over: Partial<LabComparisonPanel> = {}): LabComparisonPanel => ({
  id: 'p1',
  collected_on: '2026-10-30',
  lab_name: 'City lab',
  notes: null,
  origin: 'manual',
  created_at: '2026-10-30T00:00:00.000Z',
  results: [],
  ...over,
});
const row = (label: string) =>
  document.querySelector(`[data-lab-row="${label}"]`) as HTMLElement;

describe('BodyCompNearestLabs', () => {
  it('says so when no panel is within 30 days', () => {
    mockPanels = { data: { panels: [panel({ collected_on: '2026-01-01' })] } };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(
      screen.getByText('No lab panel within 30 days of this scan.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Within ± 30 days of the scan on UK:2026-11-02.')
    ).toBeInTheDocument();
  });

  it('shows the panel date, its distance before the scan and the lab', () => {
    mockPanels = { data: { panels: [panel()] } };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(screen.getByText('UK:2026-10-30')).toBeInTheDocument();
    expect(
      screen.getByText('3 days before the scan · City lab')
    ).toBeInTheDocument();
  });

  it('says after the scan and scan day', () => {
    mockPanels = { data: { panels: [panel({ collected_on: '2026-11-05' })] } };
    const { unmount } = render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(screen.getByText(/3 days after the scan/)).toBeInTheDocument();
    unmount();
    mockPanels = {
      data: { panels: [panel({ collected_on: '2026-11-02', lab_name: null })] },
    };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(screen.getByText('scan day')).toBeInTheDocument();
  });

  it('shows value, unit, range and a flag only for low, high and borderline', () => {
    mockPanels = {
      data: {
        panels: [
          panel({
            results: [
              result({ id: '1', marker_key: 'hba1c', value_numeric: 6.2 }),
              result({
                id: '2',
                marker_key: 'tsh',
                value_numeric: 0.1,
                unit: 'mIU/L',
                ref_range_low: 0.4,
                ref_range_high: 4,
              }),
              result({
                id: '3',
                marker_key: 'alt',
                value_numeric: 20,
                unit: 'U/L',
                ref_range_low: null,
                ref_range_high: 40,
              }),
              result({
                id: '4',
                marker_key: 'ast',
                value_numeric: 22,
                unit: 'U/L',
                ref_range_low: 10,
                ref_range_high: null,
              }),
              result({
                id: '5',
                marker_key: 'shbg',
                value_numeric: 30,
                unit: 'nmol/L',
                ref_range_low: null,
                ref_range_high: null,
              }),
            ],
          }),
        ],
      },
    };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    const hba1c = within(row('HbA1c'));
    expect(hba1c.getByText('6.2')).toBeInTheDocument();
    expect(hba1c.getByText('%')).toBeInTheDocument();
    expect(hba1c.getByText('ref 4–5.6')).toBeInTheDocument();
    expect(hba1c.getByText('High')).toBeInTheDocument();
    expect(within(row('TSH')).getByText('Low')).toBeInTheDocument();
    // In range: no badge, and a one-sided range prints with its sign.
    expect(within(row('ALT')).getByText('ref ≤ 40')).toBeInTheDocument();
    expect(
      within(row('ALT')).queryByText(/Low|High|Borderline|In range/)
    ).toBeNull();
    expect(within(row('AST')).getByText('ref ≥ 10')).toBeInTheDocument();
    // No range and no band: unknown, no badge and no range text.
    expect(within(row('SHBG')).queryByText(/ref /)).toBeNull();
    expect(
      within(row('SHBG')).queryByText(/Low|High|Borderline|In range/)
    ).toBeNull();
  });

  it('flags a value inside the lab range but past the optimal band as borderline', () => {
    mockPanels = {
      data: { panels: [panel({ results: [result({ value_numeric: 5.5 })] })] },
    };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(within(row('HbA1c')).getByText('Borderline')).toBeInTheDocument();
  });

  it('tells never measured from not measured in this panel', () => {
    mockPanels = {
      data: {
        panels: [
          panel({ results: [result({ id: 'a' })] }),
          panel({
            id: 'old',
            collected_on: '2026-01-01',
            results: [
              result({
                id: 'b',
                marker_key: null,
                custom_marker_id: 'c-1',
                value_numeric: 90,
                unit: 'ng/mL',
              }),
            ],
          }),
        ],
      },
    };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(
      within(row('Ferritin')).getByText('not measured in this panel')
    ).toBeInTheDocument();
    expect(
      within(row('IGF-1')).getByText('never measured')
    ).toBeInTheDocument();
    expect(screen.getAllByText('never measured').length).toBe(12);
  });

  it('keeps the subset in Pitstop’s order and shows panel notes', () => {
    mockPanels = {
      data: { panels: [panel({ notes: 'Fasted, morning draw' })] },
    };
    render(<BodyCompNearestLabs scanDay="2026-11-02" />);
    const labels = Array.from(document.querySelectorAll('[data-lab-row]')).map(
      (el) => el.getAttribute('data-lab-row')
    );
    expect(labels).toEqual([
      'IGF-1',
      'Total testosterone',
      'Free testosterone',
      'SHBG',
      'TSH',
      'Free T4',
      'Free T3',
      'ALT',
      'AST',
      'HbA1c',
      'Insulin',
      'hsCRP',
      'Ferritin',
      'Vitamin D',
    ]);
    expect(screen.getByText('Fasted, morning draw')).toBeInTheDocument();
  });

  it('shows nothing while loading or when the panels fail', () => {
    mockPanels = { isLoading: true };
    const { container, rerender } = render(
      <BodyCompNearestLabs scanDay="2026-11-02" />
    );
    expect(container).toBeEmptyDOMElement();
    mockPanels = { isError: true };
    rerender(<BodyCompNearestLabs scanDay="2026-11-02" />);
    expect(container).toBeEmptyDOMElement();
  });
});
