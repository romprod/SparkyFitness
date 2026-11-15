import { describe, expect, it } from 'vitest';
import { createManualLabPanelBodySchema } from '@workspace/shared';

const row = { marker_key: 'sodium', value_text: '<3', unit: 'mmol/L' };
const body = { entry_date: '2026-11-15', results: [row] };
describe('manual panel contract', () => {
  it('preserves qualified and categorical values and unlike units', () => {
    const saved = createManualLabPanelBodySchema.parse({
      ...body,
      notes: 'Synthetic',
      results: [
        row,
        {
          custom_marker_name: 'Synthetic assay',
          value_text: 'Positive',
          unit: 'index',
        },
      ],
    });
    expect(saved.results.map((r) => [r.value_text, r.unit])).toEqual([
      ['<3', 'mmol/L'],
      ['Positive', 'index'],
    ]);
  });
  it('rejects invalid dates, empty panels, unknown system markers and missing values', () => {
    for (const invalid of [
      { ...body, entry_date: '2026-02-31' },
      { ...body, results: [] },
      { ...body, results: [{ ...row, marker_key: 'unknown' }] },
      { ...body, results: [{ marker_key: 'sodium', unit: 'mmol/L' }] },
    ])
      expect(createManualLabPanelBodySchema.safeParse(invalid).success).toBe(
        false
      );
  });
  it('rejects duplicate stable marker identities and inverted ranges', () => {
    expect(
      createManualLabPanelBodySchema.safeParse({ ...body, results: [row, row] })
        .success
    ).toBe(false);
    expect(
      createManualLabPanelBodySchema.safeParse({
        ...body,
        results: [{ ...row, ref_range_low: 4, ref_range_high: 2 }],
      }).success
    ).toBe(false);
    expect(
      createManualLabPanelBodySchema.safeParse({
        ...body,
        results: [
          { custom_marker_name: 'Assay', value_text: '1' },
          { custom_marker_name: 'assay', value_text: '2' },
        ],
      }).success
    ).toBe(false);
  });
});
