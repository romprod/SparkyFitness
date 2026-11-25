import {
  LAB_OPTIMAL_BANDS,
  labOptimalBand,
  labOptimalText,
  labResultFlag,
} from '@/pages/Labs/labOptimal';
import { result } from './labsTestKit';

const none = { ref_range_low: null, ref_range_high: null };

describe('lab optimal bands', () => {
  it.each([
    ['egfr', 'mL/min/1.73m²', 90, null],
    ['egfr', 'mL/min', 90, null],
    ['total_cholesterol', 'mmol/L', null, 5.2],
    ['total_cholesterol', 'mg/dL', null, 200],
    ['ldl', 'mmol/L', null, 2.6],
    ['ldl', 'mg/dL', null, 100],
    ['hdl', 'mmol/L', 1.3, null],
    ['hdl', 'mg/dL', 50, null],
    ['triglycerides', 'mmol/L', null, 1.7],
    ['triglycerides', 'mg/dL', null, 150],
    ['hba1c', '%', 4.0, 5.4],
    ['hba1c', 'mmol/mol', 20.2, 35.5],
    ['fasting_glucose', 'mmol/L', 4.0, 5.4],
    ['fasting_glucose', 'mg/dL', 72, 97],
    ['tsh', 'mIU/L', 0.5, 2.5],
    ['crp', 'mg/L', null, 1.0],
    ['crp', 'mg/dL', null, 0.1],
    ['vitamin_d', 'nmol/L', 75, 150],
    ['vitamin_d', 'ng/mL', 30, 60],
  ])('%s in %s', (key, unit, low, high) => {
    expect(labOptimalBand(key, unit)).toEqual({ low, high });
  });

  it('covers ten markers', () => {
    expect(Object.keys(LAB_OPTIMAL_BANDS)).toHaveLength(10);
  });

  it('matches unit spellings', () => {
    expect(labOptimalBand('tsh', 'miu/L')).toEqual({ low: 0.5, high: 2.5 });
    expect(labOptimalBand('tsh', 'uIU/mL')).toEqual({ low: 0.5, high: 2.5 });
    expect(labOptimalBand('egfr', 'mL/min')).toEqual({ low: 90, high: null });
  });

  it('reads a blank unit in the preset unit', () => {
    expect(labOptimalBand('hba1c', '')).toEqual({ low: 4, high: 5.4 });
    expect(labOptimalBand('ldl', '')).toEqual({ low: null, high: 100 });
  });

  it('has no band for an unknown unit, an unbanded marker or a custom marker', () => {
    expect(labOptimalBand('hba1c', 'g/L')).toBeNull();
    expect(labOptimalBand('alt', 'U/L')).toBeNull();
    expect(labOptimalBand(null, '%')).toBeNull();
    expect(labOptimalBand(undefined, '')).toBeNull();
  });

  it('formats band text', () => {
    expect(labOptimalText('hba1c', '%')).toBe('4–5.4 %');
    expect(labOptimalText('egfr', 'mL/min/1.73m²')).toBe('≥ 90 mL/min/1.73m²');
    expect(labOptimalText('ldl', 'mmol/L')).toBe('≤ 2.6 mmol/L');
    expect(labOptimalText('ldl', '')).toBe('≤ 100 mg/dL');
    expect(labOptimalText('ldl', 'g/L')).toBeNull();
  });
});

describe('labResultFlag', () => {
  it('lets Low and High beat Borderline', () => {
    const r = result({
      marker_key: 'vitamin_d',
      value_numeric: 48,
      unit: 'nmol/L',
      ref_range_low: 50,
      ref_range_high: 144,
    });
    expect(labResultFlag(r, none)).toBe('low');
    expect(
      labResultFlag(
        result({ value_numeric: 7, ref_range_low: 4, ref_range_high: 5.6 }),
        none
      )
    ).toBe('high');
  });

  it('flags a result inside its range but outside the optimal band', () => {
    const r = result({
      marker_key: 'hba1c',
      value_numeric: 39,
      unit: 'mmol/mol',
      ref_range_low: 20,
      ref_range_high: 48,
    });
    expect(labResultFlag(r, none)).toBe('borderline');
  });

  it('flags a result with no range that is outside the optimal band', () => {
    expect(
      labResultFlag(
        result({
          marker_key: 'ldl',
          value_numeric: 4.0,
          unit: 'mmol/L',
          ...none,
        }),
        none
      )
    ).toBe('borderline');
    expect(
      labResultFlag(
        result({
          marker_key: 'total_cholesterol',
          value_numeric: 5.8,
          unit: 'mmol/L',
          ...none,
        }),
        none
      )
    ).toBe('borderline');
  });

  it('leaves a result inside the band unchanged', () => {
    expect(
      labResultFlag(
        result({
          marker_key: 'hdl',
          value_numeric: 1.31,
          unit: 'mmol/L',
          ...none,
        }),
        none
      )
    ).toBe('unknown');
    expect(labResultFlag(result({ value_numeric: 5.1 }), none)).toBe(
      'in_range'
    );
  });

  it('never flags a qualified or text value', () => {
    expect(
      labResultFlag(
        result({
          marker_key: 'egfr',
          value_numeric: null,
          value_text: '>90',
          unit: 'mL/min/1.73m²',
          ...none,
        }),
        none
      )
    ).toBe('unknown');
  });

  it('gives a custom marker no borderline', () => {
    expect(
      labResultFlag(
        result({
          marker_key: null,
          custom_marker_id: '11111111-1111-4111-8111-111111111111',
          value_numeric: 99,
          unit: '%',
        }),
        none
      )
    ).toBe('high');
  });
});
