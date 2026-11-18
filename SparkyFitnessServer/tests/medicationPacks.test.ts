import { describe, expect, it } from 'vitest';
import {
  observedDaysLeft,
  packDeduction,
  packDosesLeft,
  packUnitFamily,
  packUnitsRemaining,
} from '@workspace/shared';

describe('pack unit families', () => {
  it.each([
    ['tablet', 'tablet'],
    ['Tablets', 'tablet'],
    ['pill', 'tablet'],
    ['capsules', 'capsule'],
    ['softgel', 'softgel'],
    ['Softgels', 'softgel'],
    ['scoop (10 ml)', 'scoop'],
    ['gummies', 'gummy'],
  ])('%s -> %s', (input, family) => {
    expect(packUnitFamily(input)).toBe(family);
  });
  it('has no family for blanks', () => {
    expect(packUnitFamily('')).toBeNull();
    expect(packUnitFamily(null)).toBeNull();
    expect(packUnitFamily('   ')).toBeNull();
  });
});

describe('pack deduction', () => {
  it('takes the dose amount when the dose unit matches the pack unit', () => {
    expect(
      packDeduction({
        doseAmount: 2,
        doseUnit: 'tablet',
        packUnitLabel: 'tablets',
      })
    ).toEqual({ deducted: true, units: '2.000' });
    expect(
      packDeduction({
        doseAmount: '0.5',
        doseUnit: 'capsule',
        packUnitLabel: 'Capsules',
      })
    ).toEqual({ deducted: true, units: '0.500' });
    expect(
      packDeduction({
        doseAmount: 1,
        doseUnit: 'scoop (10 ml)',
        packUnitLabel: 'scoops',
      })
    ).toEqual({ deducted: true, units: '1.000' });
  });
  it('never guesses across unit families', () => {
    expect(
      packDeduction({
        doseAmount: 50,
        doseUnit: 'mg',
        packUnitLabel: 'tablets',
      })
    ).toEqual({ deducted: false, reason: 'unit_mismatch' });
    expect(
      packDeduction({
        doseAmount: 2,
        doseUnit: 'capsule',
        packUnitLabel: 'softgels',
      })
    ).toEqual({ deducted: false, reason: 'unit_mismatch' });
  });
  it('takes nothing for a missing, zero or negative dose', () => {
    for (const amount of [null, undefined, 0, -1, 'x']) {
      expect(
        packDeduction({
          doseAmount: amount,
          doseUnit: 'tablet',
          packUnitLabel: 'tablet',
        })
      ).toEqual({ deducted: false, reason: 'no_dose' });
    }
  });
});

describe('pack figures', () => {
  it('derives remaining, including overdrawn', () => {
    expect(packUnitsRemaining('60', '12.5')).toBe('47.500');
    expect(packUnitsRemaining('10', '12')).toBe('-2.000');
  });
  it('reports doses left at the current dose and never a negative count', () => {
    expect(packDosesLeft('47.5', '2.000')).toBe('23.8');
    expect(packDosesLeft('-2', '2.000')).toBe('0');
    expect(packDosesLeft('10', null)).toBeNull();
    expect(packDosesLeft('10', '0')).toBeNull();
  });
  it('needs enough recent doses to claim an observed pace', () => {
    const base = { remaining: '28', windowDays: 14, unitsTakenInWindow: '28' };
    expect(observedDaysLeft({ ...base, dosesInWindow: 2 })).toBeNull();
    // 28 units over 14 days is 2 per day, so 28 remaining lasts 14 days.
    expect(observedDaysLeft({ ...base, dosesInWindow: 14 })).toBe(14);
    expect(
      observedDaysLeft({ ...base, remaining: '-1', dosesInWindow: 14 })
    ).toBe(0);
    expect(
      observedDaysLeft({ ...base, unitsTakenInWindow: '0', dosesInWindow: 5 })
    ).toBeNull();
  });
});
