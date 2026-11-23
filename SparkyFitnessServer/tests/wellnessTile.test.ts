import { describe, expect, it } from 'vitest';
import {
  buildWellnessTile,
  wellnessDayAge,
  type MedicationWellnessStreams,
  type WellnessDay,
} from '@workspace/shared';

const today = '2026-11-23';
const day = (over: Partial<WellnessDay> & { day: string }): WellnessDay => ({
  resting_hr: null,
  hrv_ms: null,
  body_battery: null,
  sleep_score: null,
  sleep_seconds: null,
  avg_stress: null,
  ...over,
});
const streams = (
  over: Partial<MedicationWellnessStreams> = {}
): MedicationWellnessStreams => ({
  today,
  days: [],
  activities: [],
  weights_kg: [],
  ...over,
});
const kg = (n: number) => n;

describe('recovery snapshot', () => {
  it('keeps the latest of each figure and the latest day that has any', () => {
    const tile = buildWellnessTile(
      streams({
        days: [
          day({
            day: '2026-11-20',
            body_battery: 80,
            hrv_ms: 48,
            resting_hr: 61,
          }),
          day({
            day: '2026-11-22',
            sleep_score: 84,
            sleep_seconds: 24600,
            resting_hr: 58,
          }),
          day({ day: '2026-11-23', avg_stress: 11 }),
        ],
      }),
      kg
    );
    expect(tile.snapshot).toEqual({
      as_of: '2026-11-22',
      resting_hr: 58,
      hrv_ms: 48,
      body_battery: 80,
      sleep_score: 84,
      sleep_seconds: 24600,
      avg_stress: 11,
    });
  });

  it('takes sleep as one night, so the hours never belong to another day than the score', () => {
    const tile = buildWellnessTile(
      streams({
        days: [
          day({
            day: '2026-11-20',
            sleep_score: 95,
            sleep_seconds: 28800,
            resting_hr: 60,
          }),
          day({ day: '2026-11-22', sleep_seconds: 21000, resting_hr: 58 }),
        ],
      }),
      kg
    );
    expect(tile.snapshot).toMatchObject({
      sleep_score: null,
      sleep_seconds: 21000,
    });
  });

  it('is empty without a recovery figure: stress or sleep hours alone are not recovery', () => {
    expect(
      buildWellnessTile(
        streams({
          days: [
            day({ day: '2026-11-22', avg_stress: 30, sleep_seconds: 20000 }),
          ],
        }),
        kg
      ).snapshot
    ).toBeNull();
    expect(buildWellnessTile(streams(), kg).snapshot).toBeNull();
  });

  it('ignores days outside the fortnight and in the future', () => {
    const tile = buildWellnessTile(
      streams({
        days: [
          day({ day: '2026-11-09', resting_hr: 50 }),
          day({ day: '2026-11-24', resting_hr: 99 }),
        ],
      }),
      kg
    );
    expect(tile.snapshot).toBeNull();
    expect(
      buildWellnessTile(
        streams({ days: [day({ day: '2026-11-10', resting_hr: 50 })] }),
        kg
      ).snapshot
    ).toMatchObject({ as_of: '2026-11-10', resting_hr: 50 });
  });

  it('says whether the figures are from today, yesterday or earlier', () => {
    expect(wellnessDayAge('2026-11-23', today)).toBe('today');
    expect(wellnessDayAge('2026-11-22', today)).toBe('yesterday');
    expect(wellnessDayAge('2026-11-21', today)).toBe('earlier');
    expect(wellnessDayAge('2026-10-31', '2026-11-01')).toBe('yesterday');
  });
});

describe('workouts', () => {
  it('lists the most recent day that had any, longest first, and leaves out zero-length rows', () => {
    const tile = buildWellnessTile(
      streams({
        activities: [
          { day: '2026-11-18', name: 'Ride', duration_minutes: 90 },
          { day: '2026-11-21', name: 'Walk', duration_minutes: 12 },
          {
            day: '2026-11-21',
            name: 'Chesterfield Hiking',
            duration_minutes: 28.2,
          },
          { day: '2026-11-22', name: 'Active Calories', duration_minutes: 0 },
        ],
      }),
      kg
    );
    expect(tile.activities).toEqual({
      day: '2026-11-21',
      items: [
        {
          day: '2026-11-21',
          name: 'Chesterfield Hiking',
          duration_minutes: 28.2,
        },
        { day: '2026-11-21', name: 'Walk', duration_minutes: 12 },
      ],
    });
    expect(buildWellnessTile(streams(), kg).activities).toBeNull();
  });
});

describe('weight trend', () => {
  const w = (d: string, value: number) => ({ day: d, value });

  it('covers the seven days ending today, converted to the unit read, with the change from first to last', () => {
    const tile = buildWellnessTile(
      streams({
        weights_kg: [
          w('2026-11-16', 99), // outside: the window is the days after 16 Nov
          w('2026-11-17', 90),
          w('2026-11-20', 89.4),
          w('2026-11-23', 88.8),
        ],
      }),
      (n) => n * 2
    );
    expect(tile.weight).toEqual({
      latest: 177.6,
      delta: -2.4,
      points: [180, 178.8, 177.6],
    });
  });

  it('shows the latest reading without a change when there is only one', () => {
    expect(
      buildWellnessTile(streams({ weights_kg: [w('2026-11-22', 91.234)] }), kg)
        .weight
    ).toEqual({ latest: 91.23, delta: null, points: [91.234] });
    expect(buildWellnessTile(streams(), kg).weight).toBeNull();
  });

  it('rounds the change to two decimals', () => {
    expect(
      buildWellnessTile(
        streams({
          weights_kg: [w('2026-11-18', 90), w('2026-11-23', 89.6666)],
        }),
        kg
      ).weight!.delta
    ).toBe(-0.33);
  });
});
