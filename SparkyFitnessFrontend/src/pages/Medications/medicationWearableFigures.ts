import {
  keepMostDetailedSleepEntries,
  mainSleepEntry,
  type DailyHealthMetrics,
  type ExerciseSessionResponse,
} from '@workspace/shared';
import type { SleepEntry } from '@/types';

/**
 * Pure helpers for the Garmin figures on the medication calendar: the day
 * detail's wellness block and the month cells. Ported from Pitstop's
 * month-metrics, with figures read from Sparky's own records.
 */

export interface WearableSleep {
  seconds: number | null;
  score: number | null;
  hrvMs: number | null;
  restingHr: number | null;
}

export interface WearableWorkout {
  key: string;
  name: string;
  minutes: number | null;
  km: number | null;
}

export interface WearableDay {
  steps: number | null;
  sleep: Pick<WearableSleep, 'seconds' | 'score'> | null;
  activeCalories: number | null;
  intensityMinutes: number | null;
  weightKg: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  bodyBattery: number | null;
  workouts: WearableWorkout[];
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};

const sameDay = (value: string | null | undefined, day: string): boolean =>
  !!value && value.slice(0, 10) === day;

const isGarmin = (row: Pick<DailyHealthMetrics, 'source_provider'>): boolean =>
  /garmin/i.test(row.source_provider ?? '');

/**
 * The day's figure from the metrics rows (one per provider): Garmin's row
 * first, then any other, so an empty shell from one provider never hides the
 * figure another reported.
 */
export const dayMetricsRows = (
  rows: readonly DailyHealthMetrics[] | undefined,
  day: string
): DailyHealthMetrics[] =>
  (rows ?? [])
    .filter((row) => sameDay(row.entry_date, day))
    .sort((a, b) => Number(isGarmin(b)) - Number(isGarmin(a)));

const firstValue = (
  rows: readonly DailyHealthMetrics[],
  pick: (row: DailyHealthMetrics) => unknown,
  zeroOk = true
): number | null => {
  for (const row of rows) {
    const v = zeroOk ? num(pick(row)) : positive(pick(row));
    if (v !== null) return v;
  }
  return null;
};

/** The night a device recorded for the day; typed-in sleep is not a device's. */
export const wearableSleepForDay = (
  entries: readonly SleepEntry[] | undefined,
  day: string
): WearableSleep | null => {
  const forDay = (entries ?? []).filter(
    (entry) => sameDay(entry.entry_date, day) && entry.source !== 'manual'
  );
  const main = mainSleepEntry(keepMostDetailedSleepEntries(forDay));
  if (!main) return null;
  // Time asleep when present, as Sparky's own sleep displays do.
  const seconds = positive(
    main.time_asleep_in_seconds ?? main.duration_in_seconds
  );
  const score = positive(main.sleep_score);
  if (seconds === null && score === null) return null;
  return {
    seconds,
    score,
    hrvMs: positive(main.avg_overnight_hrv),
    restingHr: positive(main.resting_heart_rate),
  };
};

/** Logged workouts, leaving out the device-wide "Active Calories" summary. */
export const workoutsFromSessions = (
  sessions: readonly ExerciseSessionResponse[] | undefined
): WearableWorkout[] => {
  const out: WearableWorkout[] = [];
  for (const session of sessions ?? []) {
    if (session.type === 'preset') {
      const distances = session.exercises
        .map((e) => num(e.distance))
        .filter((d): d is number => d !== null && d > 0);
      out.push({
        key: `preset:${session.id}`,
        name: session.name,
        minutes: positive(session.total_duration_minutes),
        km: distances.length ? distances.reduce((a, b) => a + b, 0) : null,
      });
      continue;
    }
    const name = session.exercise_snapshot?.name ?? session.name ?? '';
    if (name === 'Active Calories') continue;
    out.push({
      key: `entry:${session.id}`,
      name: name || session.category || '',
      minutes: positive(session.duration_minutes),
      km: positive(session.distance),
    });
  }
  return out;
};

export interface WearableDayInput {
  day: string;
  metrics: readonly DailyHealthMetrics[] | undefined;
  sleepEntries: readonly SleepEntry[] | undefined;
  weightKg: number | null | undefined;
  sessions: readonly ExerciseSessionResponse[] | undefined;
}

export const buildWearableDay = (src: WearableDayInput): WearableDay => {
  const rows = dayMetricsRows(src.metrics, src.day);
  const sleep = wearableSleepForDay(src.sleepEntries, src.day);
  const moderate = firstValue(rows, (r) => r.moderate_intensity_minutes);
  const vigorous = firstValue(rows, (r) => r.vigorous_intensity_minutes);
  return {
    steps: firstValue(rows, (r) => r.total_steps),
    sleep: sleep ? { seconds: sleep.seconds, score: sleep.score } : null,
    activeCalories: firstValue(rows, (r) => r.active_calories),
    intensityMinutes:
      // Garmin's definition of intensity minutes: vigorous minutes count
      // double, as in Pitstop's wearable-normalise.
      moderate === null && vigorous === null
        ? null
        : Math.round((moderate ?? 0) + 2 * (vigorous ?? 0)),
    weightKg: positive(src.weightKg),
    restingHr:
      firstValue(rows, (r) => r.resting_heart_rate, false) ??
      sleep?.restingHr ??
      null,
    hrvMs: sleep?.hrvMs ?? null,
    bodyBattery: firstValue(rows, (r) => r.body_battery_highest),
    workouts: workoutsFromSessions(src.sessions),
  };
};

/** True when the block has something to show. */
export const wearableDayHasAny = (d: WearableDay): boolean =>
  d.steps !== null ||
  d.sleep !== null ||
  d.activeCalories !== null ||
  d.intensityMinutes !== null ||
  d.weightKg !== null ||
  d.restingHr !== null ||
  d.hrvMs !== null ||
  d.bodyBattery !== null ||
  d.workouts.length > 0;

/** Month cell figures: steps and sleep seconds for each day in the grid. */
export interface WearableCell {
  steps: number | null;
  sleepSeconds: number | null;
}

export const monthWearableByDay = (
  metrics: readonly DailyHealthMetrics[] | undefined,
  sleepEntries: readonly SleepEntry[] | undefined
): Record<string, WearableCell> => {
  const out: Record<string, WearableCell> = {};
  const days = new Set<string>();
  for (const row of metrics ?? []) days.add(row.entry_date.slice(0, 10));
  for (const entry of sleepEntries ?? [])
    days.add(entry.entry_date.slice(0, 10));
  for (const day of days) {
    const steps = firstValue(
      dayMetricsRows(metrics, day),
      (r) => r.total_steps
    );
    const sleepSeconds =
      wearableSleepForDay(sleepEntries, day)?.seconds ?? null;
    if (steps !== null || sleepSeconds !== null)
      out[day] = { steps, sleepSeconds };
  }
  return out;
};

/** 8200 -> "8.2k", 12400 -> "12k", 850 -> "850". */
export const fmtSteps = (steps: number): string => {
  if (steps < 1000) return String(Math.round(steps));
  const k = steps / 1000;
  return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}k`;
};

/** Compact sleep for a month cell: 27000 -> "7.5h". */
export const fmtSleepShort = (seconds: number): string =>
  `${Number((seconds / 3600).toFixed(1))}h`;

/** Sleep seconds as "7h 12m"; minutes are floored so it never prints "7h 60m". */
export const fmtSleepDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Workout minutes as "1h 12m" or "30m". */
export const fmtWorkoutDuration = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Distance stored in km, shown in the user's unit; short km trips as metres. */
export const fmtWorkoutDistance = (
  km: number,
  unit: 'km' | 'miles',
  convert: (km: number) => number
): string => {
  if (unit === 'km' && km < 1) return `${Math.round(km * 1000)} m`;
  return `${convert(km).toFixed(1)} ${unit === 'km' ? 'km' : 'mi'}`;
};
