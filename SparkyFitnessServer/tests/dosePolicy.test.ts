import { describe, expect, it } from 'vitest';
import {
  intervalWarning,
  overdueHours,
  readDosePolicy,
} from '@workspace/shared';

const now = new Date('2026-11-19T12:00:00Z');

describe('readDosePolicy', () => {
  it('defaults to no interval and ask', () => {
    expect(readDosePolicy(null)).toEqual({
      min_interval_hours: null,
      missed_policy: 'prompt',
    });
    expect(readDosePolicy({ min_interval_hours: 'x', missed_policy: 'bad' }))
      .toEqual({ min_interval_hours: null, missed_policy: 'prompt' });
  });
  it('reads, and caps, stored values', () => {
    expect(
      readDosePolicy({ min_interval_hours: 24, missed_policy: 'skip' })
    ).toEqual({ min_interval_hours: 24, missed_policy: 'skip' });
    expect(readDosePolicy({ min_interval_hours: 9999 }).min_interval_hours).toBe(
      192
    );
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
      intervalWarning({ takenAt: ['2026-11-19T11:00:00Z'], minHours: null, now })
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
