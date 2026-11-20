import { describe, expect, it } from 'vitest';
import { courseCycleAlert, isCourseCycleBannerAlert } from '@workspace/shared';

const base = {
  planned_stop_date: '2026-12-10',
  next_restart_date: '2027-01-07',
};

describe('courseCycleAlert', () => {
  it('is quiet mid-cycle', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'on', today: '2026-11-20' })
    ).toBeNull();
  });

  it('warns in the last week and counts today', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'on', today: '2026-12-04' })
    ).toEqual({
      kind: 'ending_soon',
      level: 'warn',
      days: 7,
      date: '2026-12-10',
    });
    expect(
      courseCycleAlert({ ...base, phase: 'on', today: '2026-12-09' })
    ).toMatchObject({ kind: 'ending_soon', days: 2 });
  });

  it('marks the last dose day as an action', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'on', today: '2026-12-10' })
    ).toEqual({
      kind: 'last_dose',
      level: 'action',
      days: 1,
      date: '2026-12-10',
    });
  });

  it('asks to stop after the plan ended and calms down after a week', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'ended', today: '2026-12-11' })
    ).toMatchObject({ kind: 'stop_now', level: 'action' });
    expect(
      courseCycleAlert({ ...base, phase: 'ended', today: '2026-12-17' })
    ).toMatchObject({ kind: 'stop_now', level: 'action' });
    expect(
      courseCycleAlert({ ...base, phase: 'ended', today: '2026-12-18' })
    ).toMatchObject({ kind: 'stop_now', level: 'warn' });
  });

  it('counts down a break and calls the restart', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'off', today: '2026-12-31' })
    ).toEqual({
      kind: 'restart_soon',
      level: 'warn',
      days: 7,
      date: '2027-01-07',
    });
    expect(
      courseCycleAlert({ ...base, phase: 'off', today: '2026-12-20' })
    ).toMatchObject({ kind: 'off_cycle', level: 'info', days: 18 });
    expect(
      courseCycleAlert({ ...base, phase: 'restart_due', today: '2027-01-07' })
    ).toMatchObject({
      kind: 'restart_now',
      level: 'action',
      date: '2027-01-07',
    });
  });

  it('says nothing without a plan or before it starts', () => {
    expect(
      courseCycleAlert({ ...base, phase: 'none', today: '2026-11-20' })
    ).toBeNull();
    expect(
      courseCycleAlert({ ...base, phase: 'scheduled', today: '2026-11-20' })
    ).toBeNull();
    expect(
      courseCycleAlert({
        phase: 'on',
        today: '2026-12-09',
        planned_stop_date: null,
        next_restart_date: null,
      })
    ).toBeNull();
  });

  it('keeps ambient break status off the banner', () => {
    expect(
      isCourseCycleBannerAlert(
        courseCycleAlert({ ...base, phase: 'off', today: '2026-12-20' })
      )
    ).toBe(false);
    expect(
      isCourseCycleBannerAlert(
        courseCycleAlert({ ...base, phase: 'on', today: '2026-12-10' })
      )
    ).toBe(true);
    expect(isCourseCycleBannerAlert(null)).toBe(false);
  });
});
