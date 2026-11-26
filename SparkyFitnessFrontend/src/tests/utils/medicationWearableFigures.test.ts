import type { DailyHealthMetrics } from '@workspace/shared';
import type { SleepEntry } from '@/types';
import {
  buildWearableDay,
  fmtSleepDuration,
  fmtSleepShort,
  fmtSteps,
  fmtWorkoutDistance,
  fmtWorkoutDuration,
  monthWearableByDay,
  wearableDayHasAny,
  wearableSleepForDay,
  workoutsFromSessions,
} from '@/pages/Medications/medicationWearableFigures';

const metrics = (extra: object = {}): DailyHealthMetrics =>
  ({
    entry_date: '2026-11-20',
    source_provider: 'garmin',
    total_steps: null,
    active_calories: null,
    moderate_intensity_minutes: null,
    vigorous_intensity_minutes: null,
    resting_heart_rate: null,
    body_battery_highest: null,
    ...extra,
  }) as unknown as DailyHealthMetrics;

const night = (extra: object = {}): SleepEntry =>
  ({
    id: 's1',
    entry_date: '2026-11-20',
    bedtime: '2026-11-19T22:30:00Z',
    wake_time: '2026-11-20T06:30:00Z',
    duration_in_seconds: 28800,
    time_asleep_in_seconds: 26000,
    sleep_score: 81,
    source: 'garmin',
    avg_overnight_hrv: 52,
    resting_heart_rate: 49,
    ...extra,
  }) as unknown as SleepEntry;

describe('formatting', () => {
  it('compacts steps', () => {
    expect(fmtSteps(850)).toBe('850');
    expect(fmtSteps(8200)).toBe('8.2k');
    expect(fmtSteps(12400)).toBe('12k');
  });
  it('formats sleep', () => {
    expect(fmtSleepShort(27000)).toBe('7.5h');
    expect(fmtSleepDuration(28771)).toBe('7h 59m');
  });
  it('formats workout duration and distance', () => {
    expect(fmtWorkoutDuration(30)).toBe('30m');
    expect(fmtWorkoutDuration(72)).toBe('1h 12m');
    expect(fmtWorkoutDistance(0.85, 'km', (km) => km)).toBe('850 m');
    expect(fmtWorkoutDistance(5, 'km', (km) => km)).toBe('5.0 km');
    expect(fmtWorkoutDistance(5, 'miles', (km) => km * 0.621371)).toBe(
      '3.1 mi'
    );
  });
});

describe('wearableSleepForDay', () => {
  it('prefers time asleep and carries score, HRV and resting HR', () => {
    expect(wearableSleepForDay([night()], '2026-11-20')).toEqual({
      seconds: 26000,
      score: 81,
      hrvMs: 52,
      restingHr: 49,
    });
  });
  it('falls back to the duration', () => {
    expect(
      wearableSleepForDay(
        [night({ time_asleep_in_seconds: null })],
        '2026-11-20'
      )?.seconds
    ).toBe(28800);
  });
  it('ignores typed-in sleep and other days', () => {
    expect(
      wearableSleepForDay([night({ source: 'manual' })], '2026-11-20')
    ).toBeNull();
    expect(wearableSleepForDay([night()], '2026-11-21')).toBeNull();
    expect(wearableSleepForDay(undefined, '2026-11-20')).toBeNull();
  });
});

describe('workoutsFromSessions', () => {
  it('lists individual and grouped sessions and skips the Active Calories summary', () => {
    const sessions = [
      {
        type: 'individual',
        id: 'a',
        name: null,
        exercise_snapshot: { name: 'Run' },
        duration_minutes: 30,
        distance: 5,
      },
      {
        type: 'individual',
        id: 'b',
        name: null,
        exercise_snapshot: { name: 'Active Calories' },
        duration_minutes: 0,
        distance: null,
      },
      {
        type: 'preset',
        id: 'c',
        name: 'Push day',
        total_duration_minutes: 45,
        exercises: [{ distance: null }],
      },
    ] as never;
    expect(workoutsFromSessions(sessions)).toEqual([
      { key: 'entry:a', name: 'Run', minutes: 30, km: 5 },
      { key: 'preset:c', name: 'Push day', minutes: 45, km: null },
    ]);
  });
});

describe('buildWearableDay', () => {
  const base = {
    day: '2026-11-20',
    metrics: undefined,
    sleepEntries: undefined,
    weightKg: undefined,
    sessions: undefined,
  };

  it('is empty with nothing recorded', () => {
    expect(wearableDayHasAny(buildWearableDay(base))).toBe(false);
  });

  it('counts vigorous intensity minutes double and reads each figure', () => {
    const day = buildWearableDay({
      ...base,
      metrics: [
        metrics({
          total_steps: 8200,
          active_calories: 410,
          moderate_intensity_minutes: 20,
          vigorous_intensity_minutes: 10,
          resting_heart_rate: 51,
          body_battery_highest: 88,
        }),
      ],
      sleepEntries: [night()],
      weightKg: 82.4,
    });
    expect(day).toMatchObject({
      steps: 8200,
      activeCalories: 410,
      intensityMinutes: 40,
      restingHr: 51,
      bodyBattery: 88,
      hrvMs: 52,
      weightKg: 82.4,
      sleep: { seconds: 26000, score: 81 },
    });
  });

  it('takes Garmin first and fills gaps from another provider', () => {
    const day = buildWearableDay({
      ...base,
      metrics: [
        metrics({
          source_provider: 'fitbit',
          total_steps: 100,
          active_calories: 5,
        }),
        metrics({ total_steps: 9000 }),
      ],
    });
    expect(day.steps).toBe(9000);
    expect(day.activeCalories).toBe(5);
  });

  it('keeps a zero step count but treats zero weight as missing', () => {
    const day = buildWearableDay({
      ...base,
      metrics: [metrics({ total_steps: 0 })],
      weightKg: 0,
    });
    expect(day.steps).toBe(0);
    expect(day.weightKg).toBeNull();
  });

  it('uses the sleep record resting HR when the daily row has none', () => {
    expect(
      buildWearableDay({ ...base, sleepEntries: [night()] }).restingHr
    ).toBe(49);
  });
});

describe('monthWearableByDay', () => {
  it('maps steps and sleep per day and omits empty days', () => {
    const out = monthWearableByDay(
      [metrics({ total_steps: 8200 }), metrics({ entry_date: '2026-11-21' })],
      [night({ entry_date: '2026-11-22' })]
    );
    expect(out).toEqual({
      '2026-11-20': { steps: 8200, sleepSeconds: null },
      '2026-11-22': { steps: null, sleepSeconds: 26000 },
    });
  });
});
