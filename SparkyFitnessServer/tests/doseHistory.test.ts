import { describe, expect, it } from 'vitest';
import {
  cumulativeExposure,
  doseAsMg,
  doseHeatmap,
  mondayIndex,
  type DoseHistoryEntry,
} from '@workspace/shared';

const dose = (over: Partial<DoseHistoryEntry> = {}): DoseHistoryEntry => ({
  medication_id: 'm1',
  status: 'taken',
  entry_date: '2026-11-10',
  dose_amount_snapshot: 1,
  dose_unit_snapshot: 'mg',
  med_name_snapshot: 'Retatrutide',
  ...over,
});

describe('dose heatmap', () => {
  it('has one bucket per day from the first taken dose to today and counts only taken doses', () => {
    const map = doseHeatmap(
      [
        dose({ entry_date: '2026-11-16' }),
        dose({ entry_date: '2026-11-16', status: 'prn_taken' }),
        dose({ entry_date: '2026-11-17', status: 'skipped' }),
        dose({ entry_date: '2026-11-18' }),
        dose({ entry_date: '2026-11-25' }), // in the future: not a dose yet
      ],
      '2026-11-18'
    );
    expect(map.from).toBe('2026-11-16');
    expect(map.days).toEqual([
      { date: '2026-11-16', count: 2 },
      { date: '2026-11-17', count: 0 },
      { date: '2026-11-18', count: 1 },
    ]);
  });

  it('is empty with no taken doses and never reaches back further than a year', () => {
    expect(doseHeatmap([dose({ status: 'missed' })], '2026-11-18')).toEqual({
      from: null,
      days: [],
    });
    const long = doseHeatmap(
      [dose({ entry_date: '2020-01-01' })],
      '2026-11-18'
    );
    expect(long.days).toHaveLength(364);
    expect(long.days.at(-1)?.date).toBe('2026-11-18');
    expect(long.days.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });

  it('lays weeks out Monday first', () => {
    expect(mondayIndex('2026-11-16')).toBe(0); // Monday
    expect(mondayIndex('2026-11-22')).toBe(6); // Sunday
  });
});

describe('cumulative exposure', () => {
  it('converts mass units exactly and leaves counts and volumes out', () => {
    expect(doseAsMg(500, 'mcg')).toBe('0.5');
    expect(doseAsMg('2.5', 'mg')).toBe('2.5');
    expect(doseAsMg(1, 'g')).toBe('1000');
    expect(doseAsMg(2, 'tablet')).toBeNull();
    expect(doseAsMg(1, 'ml')).toBeNull();
    expect(doseAsMg(null, 'mg')).toBeNull();
    expect(doseAsMg(-1, 'mg')).toBeNull();
  });

  it('totals taken doses per medication, ignoring skipped ones and other units', () => {
    const rows = cumulativeExposure([
      dose({ dose_amount_snapshot: 1.5 }),
      dose({
        dose_amount_snapshot: 2500,
        dose_unit_snapshot: 'mcg',
        entry_date: '2026-11-17',
      }),
      dose({ status: 'skipped', dose_amount_snapshot: 99 }),
      dose({
        dose_amount_snapshot: 2,
        dose_unit_snapshot: 'tablet',
        medication_id: 'm2',
        med_name_snapshot: 'Sertraline',
      }),
      dose({
        medication_id: 'm3',
        med_name_snapshot: 'Cagrilintide',
        dose_amount_snapshot: 0.25,
        entry_date: '2026-11-01',
      }),
    ]);
    expect(rows).toEqual([
      {
        medication_id: 'm3',
        name: 'Cagrilintide',
        doses: 1,
        total_mg: '0.25',
        first_date: '2026-11-01',
        last_date: '2026-11-01',
      },
      {
        medication_id: 'm1',
        name: 'Retatrutide',
        doses: 2,
        total_mg: '4',
        first_date: '2026-11-10',
        last_date: '2026-11-17',
      },
    ]);
  });

  it('keeps one row for a renamed medication and keys name-only history by name', () => {
    const rows = cumulativeExposure([
      dose({ med_name_snapshot: 'Reta' }),
      dose({ med_name_snapshot: 'Retatrutide' }),
      dose({ med_name_snapshot: 'Retatrutide' }),
      dose({ medication_id: null, med_name_snapshot: 'Old peptide' }),
    ]);
    expect(rows.map((r) => [r.name, r.doses])).toEqual([
      ['Old peptide', 1],
      ['Retatrutide', 3],
    ]);
  });
});
