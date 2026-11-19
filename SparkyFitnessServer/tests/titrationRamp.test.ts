import { describe, expect, it } from 'vitest';
import {
  generateTitrationRamp,
  MAX_RAMP_PHASES,
  type TitrationRampInput,
} from '@workspace/shared';

const input = (
  changes: Partial<TitrationRampInput> = {}
): TitrationRampInput => ({
  start_dose: '0.25',
  target_dose: '1',
  increase_by: '0.25',
  weeks_per_phase: 4,
  dose_unit: 'mg',
  ...changes,
});
const doses = (changes?: Partial<TitrationRampInput>) => {
  const result = generateTitrationRamp(input(changes));
  if (!result.ok) throw new Error(result.error);
  return result.phases.map((phase) => phase.dose);
};

describe('titration ramp', () => {
  it('steps from start to target, four weeks each, last phase open-ended', () => {
    const result = generateTitrationRamp(input());
    expect(result).toEqual({
      ok: true,
      phases: [
        { dose: '0.25', dose_unit: 'mg', duration_days: 28, notes: null },
        { dose: '0.5', dose_unit: 'mg', duration_days: 28, notes: null },
        { dose: '0.75', dose_unit: 'mg', duration_days: 28, notes: null },
        { dose: '1', dose_unit: 'mg', duration_days: null, notes: null },
      ],
    });
  });

  it('finishes exactly on the target when the last increase does not fit', () => {
    expect(
      doses({
        start_dose: '200',
        target_dose: '1000',
        increase_by: '300',
        dose_unit: 'mcg',
      })
    ).toEqual(['200', '500', '800', '1000']);
  });

  it('adds decimals exactly, with no floating-point drift', () => {
    expect(
      doses({ start_dose: '0.1', target_dose: '0.5', increase_by: '0.1' })
    ).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5']);
  });

  it('gives one open-ended phase when start equals target', () => {
    const result = generateTitrationRamp(
      input({ start_dose: '2', target_dose: '2' })
    );
    expect(result).toEqual({
      ok: true,
      phases: [
        { dose: '2', dose_unit: 'mg', duration_days: null, notes: null },
      ],
    });
  });

  it('accepts part weeks and rounds to whole days', () => {
    const result = generateTitrationRamp(input({ weeks_per_phase: 1.5 }));
    expect(result.ok && result.phases[0]?.duration_days).toBe(11);
  });

  it('refuses unusable input with a reason', () => {
    const error = (changes: Partial<TitrationRampInput>) => {
      const result = generateTitrationRamp(input(changes));
      return result.ok ? null : result.error;
    };
    expect(error({ start_dose: '' })).toBe('start_invalid');
    expect(error({ start_dose: '0' })).toBe('start_invalid');
    expect(error({ start_dose: 'abc' })).toBe('start_invalid');
    expect(error({ target_dose: '-1' })).toBe('target_invalid');
    expect(error({ increase_by: '0' })).toBe('increase_invalid');
    expect(error({ weeks_per_phase: 0 })).toBe('weeks_invalid');
    expect(error({ weeks_per_phase: Number.NaN })).toBe('weeks_invalid');
    expect(error({ weeks_per_phase: 105 })).toBe('weeks_invalid');
    expect(error({ dose_unit: '  ' })).toBe('unit_missing');
    expect(error({ start_dose: '2', target_dose: '1' })).toBe(
      'start_above_target'
    );
  });

  it('refuses a ramp that would need more than the phase limit', () => {
    expect(
      generateTitrationRamp(
        input({ start_dose: '1', target_dose: '1000', increase_by: '1' })
      )
    ).toEqual({ ok: false, error: 'too_many_phases' });
    expect(
      doses({
        start_dose: '1',
        target_dose: String(MAX_RAMP_PHASES),
        increase_by: '1',
      })
    ).toHaveLength(MAX_RAMP_PHASES);
  });
});
