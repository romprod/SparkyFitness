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
/** A table cell whose text (value, unit, flag) contains the given text. */
const cellWith = (text: string) =>
  screen.getAllByRole('cell').find((cell) => cell.textContent?.includes(text));
const show = (panels: LabComparisonPanel[]) =>
  render(
    <LabComparison
      panels={panels}
      customMarkers={[]}
      labels={{ hba1c: 'HbA1c', ldl: 'LDL cholesterol' }}
      sex={null}
    />
  );

describe('Latest panel comparison', () => {
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
    expect(screen.getByText('Latest three panels')).toBeInTheDocument();
    const headers = screen
      .getAllByRole('columnheader')
      .map((node) => node.textContent);
    expect(headers.slice(3)).toEqual([
      'Latest: 2026-03-01',
      'Prior: 2026-02-01',
      'Earlier: 2026-01-01',
    ]);
    expect(
      screen
        .getAllByRole('rowheader')
        .map((node) => node.querySelector('span span')?.textContent)
    ).toEqual(['HbA1c', 'LDL cholesterol']);
    const row = screen
      .getByRole('rowheader', { name: /^LDL cholesterol/ })
      .closest('tr');
    if (!row) throw new Error('Missing marker row');
    expect(within(row).getAllByLabelText('No results')).toHaveLength(2);
    expect(
      screen.getByText('Closer to the reference range than the prior panel')
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
    expect(cellWith('5.1 %')).toBeDefined();
    expect(cellWith('60 mmol/mol')).toBeDefined();
    expect(screen.getByText('Reference range: 4 - 5.6 %')).toBeInTheDocument();
    expect(
      screen.getByText('Reference range: 20 - 42 mmol/mol')
    ).toBeInTheDocument();
    expect(screen.getByText('(High)')).toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior panel')
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
    expect(cellWith('<3 %')).toBeDefined();
    expect(screen.queryByText('(Low)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior panel')
    ).not.toBeInTheDocument();
  });

  it('retains a qualified legacy value even when a numeric field is also populated', () => {
    show([
      panel('new', '2026-03-01', [
        result({ value_numeric: 3, value_text: '<3' }),
      ]),
      panel('prior', '2026-02-01', [result({ value_numeric: 7 })]),
    ]);
    expect(cellWith('<3 %')).toBeDefined();
    expect(screen.queryByText('(Low)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Closer to the reference range than the prior panel')
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
    expect(screen.getByText('Range unavailable')).not.toHaveClass('sr-only');
    expect(screen.getByText('Reference range: 4 - 5.6 %')).toHaveClass(
      'sr-only'
    );
    expect(
      screen.getByRole('region', { name: 'Latest three panels' })
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
    expect(
      screen.getAllByText('Collection date not recorded').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('Result date: 2026-03-02')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no imported reports', () => {
    show([]);
    expect(screen.getByText('Latest three panels')).toBeInTheDocument();
    expect(screen.getByText('No lab panels yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lays the table out compactly: dates only in the headers, a short caption below', () => {
    show([
      panel('new', '2026-03-01', [result({ value_numeric: 5.1 })]),
      panel('prior', '2026-02-01', [result({ id: 'prior', value_numeric: 7 })]),
    ]);
    expect(screen.queryByText('Panel collection date')).not.toBeInTheDocument();
    expect(screen.getByText('Ref')).toBeInTheDocument();
    expect(
      screen.getByText('Latest 2026-03-01 · Prior 2026-02-01')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Arrows mark a reading closer to its reference range/)
    ).toBeInTheDocument();
  });

  it('flags an out-of-range value as (H) or (L) and keeps the word for screen readers', () => {
    show([
      panel('new', '2026-03-01', [result({ value_numeric: 7 })]),
      panel('prior', '2026-02-01', [result({ id: 'prior', value_numeric: 3 })]),
    ]);
    expect(screen.getByText('(High)')).toHaveClass('sr-only');
    expect(screen.getByText('(Low)')).toHaveClass('sr-only');
    expect(screen.getByText('(H)')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('(L)')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drops a cell unit from view only when it matches the unit column', () => {
    show([
      panel('new', '2026-03-01', [result({ value_numeric: 5.1 })]),
      panel('prior', '2026-02-01', [
        result({ id: 'prior', value_numeric: 60, unit: 'mmol/mol' }),
      ]),
    ]);
    const same = screen.getByText('%', {
      selector: 'span.text-muted-foreground',
    });
    expect(same).toHaveClass('md:sr-only');
    const other = screen.getByText('mmol/mol', {
      selector: 'span.text-muted-foreground',
    });
    expect(other).not.toHaveClass('sr-only');
  });

  it('puts the row range under the marker name on phones, where the Ref column is hidden', () => {
    show([panel('new', '2026-03-01', [result({ value_numeric: 5.1 })])]);
    const header = screen.getByRole('rowheader', { name: /HbA1c/ });
    const range = within(header).getByText('4 - 5.6 %');
    expect(range).toHaveClass('md:hidden');
    expect(screen.getByText('Ref')).toHaveClass('hidden', 'md:table-cell');
  });
});
