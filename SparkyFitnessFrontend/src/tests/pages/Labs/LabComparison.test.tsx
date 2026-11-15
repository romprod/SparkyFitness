import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { LabComparisonPanel } from '@workspace/shared';
import LabComparison from '@/pages/Labs/LabComparison';
import { result } from './labsTestKit';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

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
const show = (panels: LabComparisonPanel[]) =>
  render(
    <LabComparison
      panels={panels}
      customMarkers={[]}
      labels={{ hba1c: 'HbA1c', ldl: 'LDL cholesterol' }}
      sex={null}
    />
  );

describe('Latest imported report comparison', () => {
  it('shows newest-first report columns and union rows with missing readings', () => {
    show([
      panel('old', '2026-01-01', [
        result({
          id: 'ldl',
          marker_key: 'ldl',
          unit: 'mg/dL',
          value_numeric: 150,
        }),
      ]),
      panel('new', '2026-03-01', [result({ id: 'new', value_numeric: 5.1 })]),
      panel('prior', '2026-02-01', [result({ id: 'prior', value_numeric: 7 })]),
      panel('excluded', '2025-01-01', [
        result({ id: 'excluded', marker_key: 'alt' }),
      ]),
    ]);
    expect(
      screen.getByText('Latest three imported reports')
    ).toBeInTheDocument();
    const headers = screen
      .getAllByRole('columnheader')
      .map((node) => node.textContent);
    expect(headers.slice(3)).toEqual([
      'LatestReport collection date2026-03-01',
      'PriorReport collection date2026-02-01',
      'EarlierReport collection date2026-01-01',
    ]);
    expect(
      screen.getAllByRole('rowheader').map((node) => node.textContent)
    ).toEqual(['HbA1c', 'LDL cholesterol']);
    const row = screen
      .getByRole('rowheader', { name: 'LDL cholesterol' })
      .closest('tr');
    if (!row) throw new Error('Missing marker row');
    expect(within(row).getAllByLabelText('No results')).toHaveLength(2);
    expect(
      screen.getByText('Closer to the reference range than the prior report')
    ).toBeInTheDocument();
  });

  it('retains each cell unit and range and does not imply a trend across units', () => {
    show([
      panel('new', '2026-03-01', [result({ value_numeric: 5.1 })]),
      panel('prior', '2026-02-01', [
        result({
          id: 'prior',
          value_numeric: 60,
          unit: 'mmol/mol',
          ref_range_low: 20,
          ref_range_high: 42,
        }),
      ]),
    ]);
    expect(screen.getByText('5.1 %')).toBeInTheDocument();
    expect(screen.getByText('60 mmol/mol')).toBeInTheDocument();
    expect(screen.getByText('Reference range: 4 - 5.6 %')).toBeInTheDocument();
    expect(
      screen.getByText('Reference range: 20 - 42 mmol/mol')
    ).toBeInTheDocument();
    expect(screen.getByText('(High)')).toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior report')
    ).not.toBeInTheDocument();
  });

  it('keeps qualified text without a numeric flag or arrow', () => {
    show([
      panel('new', '2026-03-01', [
        result({
          value_numeric: null,
          value_text: '<3',
          ref_range_low: null,
          ref_range_high: null,
        }),
      ]),
      panel('prior', '2026-02-01', [result({ value_numeric: 7 })]),
    ]);
    expect(screen.getByText('<3 %')).toBeInTheDocument();
    expect(screen.queryByText('(Low)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior report')
    ).not.toBeInTheDocument();
  });

  it('retains a qualified legacy value even when a numeric field is also populated', () => {
    show([
      panel('new', '2026-03-01', [
        result({ value_numeric: 3, value_text: '<3' }),
      ]),
      panel('prior', '2026-02-01', [result({ value_numeric: 7 })]),
    ]);
    expect(screen.getByText('<3 %')).toBeInTheDocument();
    expect(screen.queryByText('(Low)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior report')
    ).not.toBeInTheDocument();
  });

  it('keeps a differing historical range or unavailable range visibly labelled', () => {
    show([
      panel('new', '2026-03-01', [result()]),
      panel('prior', '2026-02-01', [
        result({
          id: 'prior',
          unit: 'mmol/mol',
          ref_range_low: null,
          ref_range_high: null,
        }),
      ]),
    ]);
    expect(screen.getByText('Range unavailable')).not.toHaveClass('md:sr-only');
    expect(screen.getByText('Reference range: 4 - 5.6 %')).toHaveClass(
      'md:sr-only'
    );
    expect(
      screen.getByRole('region', { name: 'Latest three imported reports' })
    ).toHaveAttribute('tabindex', '0');
  });

  it('distinguishes report collection dates from changed result dates and unknown dates', () => {
    show([
      {
        ...panel('unknown', '2026-03-01', [
          result({ entry_date: '2026-03-02' }),
        ]),
        collected_on: null,
      },
    ]);
    expect(screen.getByText('Report collection date')).toBeInTheDocument();
    expect(
      screen.getByText('Collection date not recorded')
    ).toBeInTheDocument();
    expect(screen.getByText('Result date: 2026-03-02')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no imported reports', () => {
    show([]);
    expect(
      screen.getByText('Latest three imported reports')
    ).toBeInTheDocument();
    expect(screen.getByText('No imported reports yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
