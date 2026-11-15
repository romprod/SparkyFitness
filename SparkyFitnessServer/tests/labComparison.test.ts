import { describe, expect, it, vi } from 'vitest';
import {
  buildLabComparison,
  type LabComparisonPanel,
  type LabComparisonResult,
  type LabMarkerResponse,
} from '@workspace/shared';
import { listLatestLabPanels } from '../models/labResultRepository.js';
import { getClient } from '../db/poolManager.js';
vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
const marker: LabMarkerResponse = {
  id: 'marker',
  user_id: 'owner',
  name: 'Synthetic marker',
  unit: 'mg/L',
  ref_range_low: 0,
  ref_range_high: 10,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const result = (
  changes: Partial<LabComparisonResult> = {}
): LabComparisonResult => ({
  id: 'result',
  marker_key: null,
  custom_marker_id: marker.id,
  entry_date: '2026-11-15',
  value_numeric: 12,
  value_text: null,
  unit: 'mg/L',
  ref_range_low: 0,
  ref_range_high: 10,
  ...changes,
});
const panel = (
  id: string,
  date: string | null,
  results: LabComparisonResult[]
): LabComparisonPanel => ({
  id,
  collected_on: date,
  lab_name: 'Synthetic lab',
  created_at: '2026-11-15T00:00:00.000Z',
  results,
});
const compare = (latest: LabComparisonResult, prior: LabComparisonResult) =>
  buildLabComparison(
    [panel('new', '2026-11-15', [latest]), panel('old', '2026-11-01', [prior])],
    [marker]
  ).rows[0];
describe('latest imported report comparison', () => {
  it('selects the newest three actual panels deterministically with undated last', () => {
    const output = buildLabComparison(
      [
        panel('undated', null, []),
        panel('a', '2026-11-01', []),
        panel('b', '2026-11-01', []),
        panel('new', '2026-11-15', []),
      ],
      []
    );
    expect(output.panels.map((p) => p.id)).toEqual(['new', 'b', 'a']);
    expect(
      buildLabComparison(
        [panel('undated', null, []), panel('new', '2026-11-15', [])],
        []
      ).panels.map((p) => p.id)
    ).toEqual(['new', 'undated']);
  });
  it('unions stable custom and built-in IDs without merging assay names', () => {
    const rows = buildLabComparison(
      [
        panel('new', '2026-11-15', [
          result({ marker_key: 'crp', custom_marker_id: null }),
        ]),
        panel('old', '2026-11-01', [result()]),
      ],
      [{ ...marker, name: 'CRP' }]
    ).rows;
    expect(rows.map((r) => r.id).sort()).toEqual([
      'builtin:crp',
      'custom:marker',
    ]);
  });
  it('uses newest metadata while retaining each cell unit and range', () => {
    const row = compare(
      result({ unit: 'mg/L', ref_range_high: 10 }),
      result({ unit: 'mmol/L', ref_range_high: 20 })
    );
    expect(row.unit).toBe('mg/L');
    expect(row.range).toEqual({ low: 0, high: 10 });
    expect(row.cells[1].unit).toBe('mmol/L');
    expect(row.cells[1].range.high).toBe(20);
    expect(row.cells[0].improved).toBeNull();
  });
  it('shows numeric range flags and movement closer to the same reference interval', () => {
    const row = compare(
      result({ value_numeric: 12 }),
      result({ value_numeric: 15 })
    );
    expect(row.cells[0]).toMatchObject({ status: 'high', improved: 'down' });
    expect(
      compare(result({ value_numeric: 0 }), result({ value_numeric: -2 }))
        .cells[0].improved
    ).toBe('up');
    expect(
      compare(result({ value_numeric: 5 }), result({ value_numeric: 8 }))
        .cells[0].improved
    ).toBeNull();
  });
  it('never borrows one bound from a different interval', () => {
    const row = compare(
      result({ value_numeric: 50, ref_range_low: 0, ref_range_high: null }),
      result({ value_numeric: 100, ref_range_low: 0, ref_range_high: 10 })
    );
    expect(row.cells[0].range).toEqual({ low: 0, high: null });
    expect(row.cells[0].improved).toBeNull();
  });
  it('does not derive flags or arrows from malformed stored reference intervals', () => {
    const row = compare(
      result({ value_numeric: 8, ref_range_low: 10, ref_range_high: 5 }),
      result({ value_numeric: 0, ref_range_low: 10, ref_range_high: 5 })
    );
    expect(row.cells[0].status).toBe('unknown');
    expect(row.cells[0].improved).toBeNull();
  });
  it('uses exact unit equivalence without conversion', () => {
    const row = compare(
      result({ unit: 'ug/L', value_numeric: 12 }),
      result({ unit: 'ng/mL', value_numeric: 15 })
    );
    expect(row.cells[0].improved).toBe('down');
  });
  it('does not infer exact values from qualifiers or text-only results', () => {
    for (const value_text of ['<12', '>12', 'Not detected', '12 (H)']) {
      const row = compare(
        result({ value_text }),
        result({ value_numeric: 15 })
      );
      expect(row.cells[0].status).toBe('unknown');
      expect(row.cells[0].improved).toBeNull();
      expect(row.cells[0].result?.value_text).toBe(value_text);
    }
    expect(
      compare(result({ value_numeric: null, value_text: 'Positive' }), result())
        .cells[0].improved
    ).toBeNull();
  });
  it('does not bridge a missing immediate previous marker', () => {
    const output = buildLabComparison(
      [
        panel('new', '2026-11-15', [result({ value_numeric: 12 })]),
        panel('gap', '2026-11-10', []),
        panel('old', '2026-11-01', [result({ value_numeric: 15 })]),
      ],
      [marker]
    );
    expect(output.rows[0].cells[0].improved).toBeNull();
    expect(output.rows[0].cells[1].result).toBeNull();
  });
  it('never invents scale for blank-unit results with their own bounds', () => {
    const row = compare(
      result({ unit: '', value_numeric: 12 }),
      result({ unit: '', value_numeric: 15 })
    );
    expect(row.unit).toBe('');
    expect(row.cells[0].improved).toBeNull();
    const inherited = compare(
      result({
        unit: '',
        value_numeric: 12,
        ref_range_low: null,
        ref_range_high: null,
      }),
      result({
        unit: '',
        value_numeric: 15,
        ref_range_low: null,
        ref_range_high: null,
      })
    );
    expect(inherited.cells[0].unit).toBe('mg/L');
    expect(inherited.cells[0].improved).toBe('down');
  });
  it('queries scoped report groups with complete results and maps only matrix fields', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'panel',
          lab_name: 'Synthetic',
          collected_on: null,
          created_at: '2026-11-15T00:00:00Z',
          results: [
            {
              ...result(),
              user_id: 'private',
              notes: 'must not expose',
              source: 'manual',
            },
          ],
        },
      ],
    });
    vi.mocked(getClient).mockResolvedValue({
      query,
      release: vi.fn(),
    } as never);
    const output = await listLatestLabPanels('owner', 'delegate');
    expect(getClient).toHaveBeenCalledWith('owner', 'delegate');
    expect(query.mock.calls[0][0]).toContain(
      'r.report_id=p.id AND r.user_id=$1'
    );
    expect(query.mock.calls[0][0]).toContain('DESC NULLS LAST');
    expect(query.mock.calls[0][1]).toEqual(['owner']);
    expect(output.panels[0].results[0]).not.toHaveProperty('notes');
    expect(output.panels[0].results[0]).not.toHaveProperty('user_id');
  });
});
