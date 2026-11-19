import { describe, expect, it } from 'vitest';
import {
  administrationsPerWeek,
  perAdministrationEstimate,
} from '@workspace/shared';

describe('per-administration estimate for a weekly target', () => {
  it('divides a weekly target across the plan’s weekly administrations', () => {
    expect(
      perAdministrationEstimate('1', [
        { schedule_type_id: 'specific_days', days_of_week: [1] },
      ])
    ).toEqual({ per_administration: '1', per_week: '1' });
    expect(
      perAdministrationEstimate('1', [
        { schedule_type_id: 'specific_days', days_of_week: [1, 4] },
      ])
    ).toEqual({ per_administration: '0.5', per_week: '2' });
    expect(
      perAdministrationEstimate('7', [{ schedule_type_id: 'daily' }])
    ).toEqual({ per_administration: '1', per_week: '7' });
  });

  it('adds up several rules and counts weekdays once', () => {
    expect(
      administrationsPerWeek([
        { schedule_type_id: 'daily' },
        { schedule_type_id: 'weekly', days_of_week: [1, 1, 3] },
      ])?.toString()
    ).toBe('9');
  });

  it('handles steady intervals and on/off cycles', () => {
    expect(
      perAdministrationEstimate('3', [
        { schedule_type_id: 'every_n_days', interval_days: 3 },
      ])
    ).toEqual({ per_administration: '1.2857', per_week: '2.33' });
    expect(
      administrationsPerWeek([
        { schedule_type_id: 'cyclic', cycle_on_days: 5, cycle_off_days: 2 },
      ])?.toString()
    ).toBe('5');
  });

  it('gives nothing for irregular plans, empty rules or bad targets', () => {
    const weekly = [{ schedule_type_id: 'weekly', days_of_week: [2] }];
    for (const type of ['monthly', 'taper', 'prn'])
      expect(
        perAdministrationEstimate('1', [{ schedule_type_id: type }])
      ).toBeNull();
    expect(
      perAdministrationEstimate('1', [...weekly, { schedule_type_id: 'prn' }])
    ).toBeNull();
    expect(perAdministrationEstimate('1', [])).toBeNull();
    expect(perAdministrationEstimate('', weekly)).toBeNull();
    expect(perAdministrationEstimate('abc', weekly)).toBeNull();
    expect(perAdministrationEstimate('0', weekly)).toBeNull();
    expect(
      perAdministrationEstimate('1', [
        { schedule_type_id: 'weekly', days_of_week: [] },
      ])
    ).toBeNull();
  });
});
