import { describe, expect, it } from 'vitest';
import { ADHERENCE_WINDOW_DAYS, adherenceFigure } from '@workspace/shared';

describe('adherenceFigure', () => {
  it('covers 90 days', () => {
    expect(ADHERENCE_WINDOW_DAYS).toBe(90);
  });
  it('has no percentage and no days when nothing was scored', () => {
    expect(adherenceFigure([])).toEqual({
      pct: null,
      taken: 0,
      missed: 0,
      days_of_data: 0,
    });
    expect(
      adherenceFigure([{ date: '2026-11-01', taken: 0, missed: 0 }])
    ).toEqual({ pct: null, taken: 0, missed: 0, days_of_data: 0 });
  });
  it('is 100% for one taken dose over one day', () => {
    expect(
      adherenceFigure([{ date: '2026-11-22', taken: 1, missed: 0 }])
    ).toEqual({ pct: 100, taken: 1, missed: 0, days_of_data: 1 });
  });
  it('rounds taken over taken plus missed to a whole percent', () => {
    expect(
      adherenceFigure([{ date: '2026-11-01', taken: 2, missed: 1 }]).pct
    ).toBe(67);
    expect(
      adherenceFigure([{ date: '2026-11-01', taken: 1, missed: 2 }]).pct
    ).toBe(33);
    expect(
      adherenceFigure([{ date: '2026-11-01', taken: 0, missed: 3 }]).pct
    ).toBe(0);
  });
  it('counts days inclusively from the earliest to the latest scored day', () => {
    const figure = adherenceFigure([
      { date: '2026-11-10', taken: 1, missed: 0 },
      { date: '2026-11-05', taken: 0, missed: 1 },
      // Unscored days do not stretch the span.
      { date: '2026-11-20', taken: 0, missed: 0 },
    ]);
    expect(figure.days_of_data).toBe(6);
    expect(figure.pct).toBe(50);
  });
  it('adds up the same date from several plans', () => {
    expect(
      adherenceFigure([
        { date: '2026-11-10', taken: 1, missed: 0 },
        { date: '2026-11-10', taken: 1, missed: 1 },
      ])
    ).toEqual({ pct: 67, taken: 2, missed: 1, days_of_data: 1 });
  });
  it('counts days across a month and year boundary', () => {
    expect(
      adherenceFigure([
        { date: '2025-12-30', taken: 1, missed: 0 },
        { date: '2026-01-02', taken: 1, missed: 0 },
      ]).days_of_data
    ).toBe(4);
  });
});
