import { describe, expect, it } from 'vitest';
import { coursePlanProgress } from '@workspace/shared';

const row = (start: string | null, end: string | null, today: string) => ({
  start_date: start,
  end_date: end,
  local_today: today,
});

describe('plan progress', () => {
  it('counts the day of a plan with an end date', () => {
    expect(
      coursePlanProgress(row('2026-11-10', '2027-02-08', '2026-11-19'))
    ).toEqual({
      kind: 'running',
      day: 10,
      of: 91,
      end_date: '2027-02-08',
    });
  });

  it('counts the first and last days inclusively', () => {
    expect(
      coursePlanProgress(row('2026-11-19', '2026-11-25', '2026-11-19'))
    ).toMatchObject({
      day: 1,
      of: 7,
    });
    expect(
      coursePlanProgress(row('2026-11-19', '2026-11-25', '2026-11-25'))
    ).toMatchObject({
      day: 7,
      of: 7,
    });
  });

  it('has no total for an open-ended plan', () => {
    expect(coursePlanProgress(row('2026-11-01', null, '2026-11-19'))).toEqual({
      kind: 'running',
      day: 19,
      of: null,
      end_date: null,
    });
  });

  it('says when a plan has not started or has finished', () => {
    expect(coursePlanProgress(row('2026-11-23', null, '2026-11-19'))).toEqual({
      kind: 'not_started',
      starts_in_days: 4,
      start_date: '2026-11-23',
    });
    expect(
      coursePlanProgress(row('2026-10-01', '2026-10-31', '2026-11-19'))
    ).toEqual({
      kind: 'finished',
      end_date: '2026-10-31',
    });
  });

  it('gives nothing without a start date', () => {
    expect(coursePlanProgress(row(null, '2026-12-01', '2026-11-19'))).toEqual({
      kind: 'unknown',
    });
  });
});
