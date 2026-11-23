import { describe, expect, it } from 'vitest';
import {
  intervalWarning,
  lastDoseDecay,
  overdueHours,
  readDosePolicy,
  readDefaultBudDays,
} from '@workspace/shared';

const now = new Date('2026-11-19T12:00:00Z');

describe('readDosePolicy', () => {
  it('defaults to no interval and ask', () => {
    expect(readDosePolicy(null)).toEqual({
      min_interval_hours: null,
      missed_policy: 'prompt',
    });
    expect(
      readDosePolicy({ min_interval_hours: 'x', missed_policy: 'bad' })
    ).toEqual({ min_interval_hours: null, missed_policy: 'prompt' });
  });
  it('reads, and caps, stored values', () => {
    expect(
      readDosePolicy({ min_interval_hours: 24, missed_policy: 'skip' })
    ).toEqual({ min_interval_hours: 24, missed_policy: 'skip' });
    expect(
      readDosePolicy({ min_interval_hours: 9999 }).min_interval_hours
    ).toBe(192);
    expect(readDosePolicy({ missed_policy: 'take_now' }).missed_policy).toBe(
      'take_now'
    );
  });
});

describe('intervalWarning', () => {
  it('warns when the latest dose is inside the interval', () => {
    const w = intervalWarning({
      takenAt: ['2026-11-18T09:00:00Z', '2026-11-19T09:00:00Z'],
      minHours: 24,
      now,
    })!;
    expect(w).toMatchObject({
      hours_since: 3,
      min_hours: 24,
      ok_at: '2026-11-20T09:00:00.000Z',
    });
  });
  it('stays quiet once the interval has passed, with no history or no setting', () => {
    expect(
      intervalWarning({ takenAt: ['2026-11-18T09:00:00Z'], minHours: 24, now })
    ).toBeNull();
    expect(intervalWarning({ takenAt: [], minHours: 24, now })).toBeNull();
    expect(
      intervalWarning({
        takenAt: ['2026-11-19T11:00:00Z'],
        minHours: null,
        now,
      })
    ).toBeNull();
  });
  it('ignores doses dated after now', () => {
    expect(
      intervalWarning({ takenAt: ['2026-11-19T15:00:00Z'], minHours: 24, now })
    ).toBeNull();
  });
});

describe('overdueHours', () => {
  it('counts whole hours past the planned time', () => {
    expect(overdueHours('2026-11-19T08:30:00Z', now)).toBe(3);
    expect(overdueHours('2026-11-19T13:00:00Z', now)).toBeNull();
    expect(overdueHours(null, now)).toBeNull();
  });
});

describe('readDefaultBudDays', () => {
  it('reads a whole positive number of days, capped at a year', () => {
    expect(readDefaultBudDays({ default_bud_days: 28 })).toBe(28);
    expect(readDefaultBudDays({ default_bud_days: '14.9' })).toBe(14);
    expect(readDefaultBudDays({ default_bud_days: 9999 })).toBe(365);
  });
  it('assumes nothing when unset or invalid', () => {
    expect(readDefaultBudDays(null)).toBeNull();
    expect(readDefaultBudDays({})).toBeNull();
    expect(readDefaultBudDays({ default_bud_days: 0 })).toBeNull();
    expect(readDefaultBudDays({ default_bud_days: 'x' })).toBeNull();
  });
});

describe('lastDoseDecay', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const ago = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000).toISOString();

  it('halves for each half-life since the latest taken dose', () => {
    expect(
      lastDoseDecay({ takenAt: [ago(168)], halfLifeHours: 168, now })
    ).toEqual({ hours_since: 168, percent: 50 });
    expect(
      lastDoseDecay({ takenAt: [ago(84)], halfLifeHours: 168, now })
    ).toEqual({ hours_since: 84, percent: 71 });
    expect(
      lastDoseDecay({ takenAt: [ago(0)], halfLifeHours: 168, now })
    ).toEqual({ hours_since: 0, percent: 100 });
  });

  it('reads the latest dose, not an older one, and rounds the hours to a tenth', () => {
    const out = lastDoseDecay({
      takenAt: [ago(400), ago(25.04), ago(300)],
      halfLifeHours: 24,
      now,
    });
    expect(out).toEqual({ hours_since: 25, percent: 49 });
  });

  it('leaves almost nothing of a short half-life after days', () => {
    expect(
      lastDoseDecay({ takenAt: [ago(96)], halfLifeHours: 4, now })!.percent
    ).toBe(0);
  });

  it('is null without a half-life, without an earlier dose, or with only future or invalid ones', () => {
    expect(
      lastDoseDecay({ takenAt: [ago(5)], halfLifeHours: null, now })
    ).toBeNull();
    expect(
      lastDoseDecay({ takenAt: [ago(5)], halfLifeHours: 0, now })
    ).toBeNull();
    expect(lastDoseDecay({ takenAt: [], halfLifeHours: 24, now })).toBeNull();
    expect(
      lastDoseDecay({
        takenAt: [ago(-3), 'not a date'],
        halfLifeHours: 24,
        now,
      })
    ).toBeNull();
  });
});
