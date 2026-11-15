import {
  parseLabValue,
  exactLabResultValue,
  labResultStatus,
  labPlottedResults,
  labHistoryPoints,
} from '@workspace/shared';
import {
  formatLabRange,
  formatLabValue,
  labNumber,
  labResultText,
  readFileAsBase64,
} from '@/pages/Labs/labFormat';
import { result } from './labsTestKit';

describe('labFormat', () => {
  it('keeps the decimals a value was entered with', () => {
    expect(labNumber(5.6)).toBe('5.6');
    expect(labNumber(0.1 + 0.2)).toBe('0.3');
    // No grouping separator, so a prefilled value parses back unchanged.
    expect(labNumber(250000)).toBe('250000');
    expect(labNumber(1000)).toBe('1000');
  });

  it('keeps small values and parses every formatted value back', () => {
    expect(labNumber(1e-10)).toBe('0.0000000001');
    expect(labNumber(4e-11)).toBe('0.00000000004');
    for (const value of [1e-10, 4e-11, 0.0000004, 5.6, 250000, 123.456789]) {
      expect(parseLabValue(labNumber(value))).toBe(value);
    }
    expect(formatLabValue(130, 'mg/dL')).toBe('130 mg/dL');
    expect(formatLabValue(5, '')).toBe('5');
  });

  it('writes a range as a span, an upper limit or a lower limit', () => {
    expect(formatLabRange(4, 5.6, '%')).toBe('4 - 5.6 %');
    expect(formatLabRange(null, 200, 'mg/dL')).toBe('≤ 200 mg/dL');
    expect(formatLabRange(40, null, 'mg/dL')).toBe('≥ 40 mg/dL');
    expect(formatLabRange(null, null, '%')).toBeNull();
  });

  it.each(['<3', '>3', '≤3', '≥3', '<=3', '>=3', 'Negative'])(
    'preserves %s and excludes its legacy number from flags and plotted points',
    (raw) => {
      const saved = result({ value_numeric: 3, value_text: raw });
      expect(labResultText(saved)).toBe(`${raw} %`);
      expect(exactLabResultValue(saved)).toBeNull();
      expect(
        labResultStatus(saved, { ref_range_low: 4, ref_range_high: 5.6 })
      ).toBe('unknown');
      expect(labPlottedResults([saved], '%')).toEqual([]);
      expect(labHistoryPoints([saved], '%')).toEqual([]);
      expect(saved.value_numeric).toBe(3);
      expect(saved.value_text).toBe(raw);
    }
  );

  it('keeps ordinary numeric formatting, localized exact text, flags and history unchanged', () => {
    const saved = result({ value_numeric: 5.1, value_text: '5,1' });
    expect(exactLabResultValue(saved)).toBe(5.1);
    expect(labResultText(saved)).toBe('5.1 %');
    expect(
      labResultStatus(saved, { ref_range_low: 4, ref_range_high: 5.6 })
    ).toBe('in_range');
    expect(labHistoryPoints([saved], '%')).toEqual([
      { day: '2026-09-12', value: 5.1 },
    ]);
    expect(
      labResultText(
        result({ value_numeric: null, value_text: 'Negative', unit: '' })
      )
    ).toBe('Negative');
  });

  it('reads a file as base64 without the data URL prefix', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    expect(await readFileAsBase64(file)).toBe('aGVsbG8=');
  });
});
