import { addDays } from '../utils/timezone.ts';

/**
 * The recovery and weight tile on the medication page, as Pitstop's dashboard Wellness tile has
 * it: the latest Garmin recovery figures (Body Battery, sleep score, HRV, resting heart rate) with
 * the day they are from, the latest workouts, and the last seven days of weight. Plain values the
 * screen words in the person's language; nothing here is a score or advice.
 *
 * Pure: the server sends the records, the screen passes a function that puts kilograms in the unit
 * the person reads.
 */

/** How far back the latest recovery figures and workouts are looked for, today included. */
export const WELLNESS_LOOKBACK_DAYS = 14;
/** The weight trend covers the days after `today - 7`, as Pitstop's does. */
export const WELLNESS_WEIGHT_DAYS = 7;

/** One day of Garmin's figures; any may be missing. */
export interface WellnessDay {
  day: string;
  resting_hr: number | null;
  hrv_ms: number | null;
  body_battery: number | null;
  sleep_score: number | null;
  sleep_seconds: number | null;
  avg_stress: number | null;
}
export interface WellnessActivity {
  day: string;
  name: string;
  duration_minutes: number;
}
export interface WellnessWeightPoint {
  day: string;
  value: number;
}

/** What the server sends: the records of the look-back window, not yet summarised. */
export interface MedicationWellnessStreams {
  /** The owner's current day, 'YYYY-MM-DD'. */
  today: string;
  days: WellnessDay[];
  activities: WellnessActivity[];
  /** Weights in kilograms, the last seven days. */
  weights_kg: WellnessWeightPoint[];
}

export interface WellnessSnapshot {
  /** The latest day that has any recovery figure. */
  as_of: string;
  resting_hr: number | null;
  hrv_ms: number | null;
  body_battery: number | null;
  sleep_score: number | null;
  /** The sleep behind the score: the same night, not a different day's. */
  sleep_seconds: number | null;
  avg_stress: number | null;
}
export interface WellnessWeight {
  latest: number;
  /** Latest minus earliest in the window, to two decimals; null with fewer than two readings. */
  delta: number | null;
  /** Readings oldest first, for the sparkline. */
  points: number[];
}
export interface WellnessTileModel {
  snapshot: WellnessSnapshot | null;
  /** Workouts from the most recent day that had any; that day can differ from the snapshot's. */
  activities: { day: string; items: WellnessActivity[] } | null;
  weight: WellnessWeight | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Whether a day is today, yesterday or earlier, so a sync gap shows yesterday's recovery as
 * yesterday's rather than as current.
 */
export function wellnessDayAge(
  day: string,
  today: string
): 'today' | 'yesterday' | 'earlier' {
  if (day === today) return 'today';
  return day === addDays(today, -1) ? 'yesterday' : 'earlier';
}

export function buildWellnessTile(
  streams: MedicationWellnessStreams,
  fromKg: (kg: number) => number
): WellnessTileModel {
  const from = addDays(streams.today, -(WELLNESS_LOOKBACK_DAYS - 1));
  const inWindow = (day: string) => day >= from && day <= streams.today;
  const days = streams.days
    .filter((row) => inWindow(row.day))
    .sort((a, b) => a.day.localeCompare(b.day));

  // The latest figure of each kind, as Pitstop scans ascending and keeps the last hit. Sleep is
  // taken as one night so the duration never belongs to a different day than its score.
  let snapshot: WellnessSnapshot | null = null;
  const latest: Omit<WellnessSnapshot, 'as_of'> = {
    resting_hr: null,
    hrv_ms: null,
    body_battery: null,
    sleep_score: null,
    sleep_seconds: null,
    avg_stress: null,
  };
  let asOf: string | null = null;
  for (const row of days) {
    const signals =
      finite(row.resting_hr) ||
      finite(row.hrv_ms) ||
      finite(row.body_battery) ||
      finite(row.sleep_score);
    if (signals) asOf = row.day;
    if (finite(row.resting_hr)) latest.resting_hr = row.resting_hr;
    if (finite(row.hrv_ms)) latest.hrv_ms = row.hrv_ms;
    if (finite(row.body_battery)) latest.body_battery = row.body_battery;
    if (finite(row.avg_stress)) latest.avg_stress = row.avg_stress;
    if (finite(row.sleep_score) || finite(row.sleep_seconds)) {
      latest.sleep_score = finite(row.sleep_score) ? row.sleep_score : null;
      latest.sleep_seconds = finite(row.sleep_seconds)
        ? row.sleep_seconds
        : null;
    }
  }
  if (
    asOf !== null &&
    (latest.resting_hr !== null ||
      latest.hrv_ms !== null ||
      latest.body_battery !== null ||
      latest.sleep_score !== null)
  )
    snapshot = { as_of: asOf, ...latest };

  const workouts = streams.activities
    .filter(
      (a) =>
        inWindow(a.day) && finite(a.duration_minutes) && a.duration_minutes > 0
    )
    .sort((a, b) => a.day.localeCompare(b.day));
  const lastDay = workouts.at(-1)?.day;
  const activities = lastDay
    ? {
        day: lastDay,
        items: workouts
          .filter((a) => a.day === lastDay)
          .sort(
            (a, b) =>
              b.duration_minutes - a.duration_minutes ||
              a.name.localeCompare(b.name)
          ),
      }
    : null;

  const cutoff = addDays(streams.today, -WELLNESS_WEIGHT_DAYS);
  const readings = streams.weights_kg
    .filter(
      (point) =>
        finite(point.value) && point.day > cutoff && point.day <= streams.today
    )
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((point) => fromKg(point.value));
  const weight: WellnessWeight | null = readings.length
    ? {
        latest: round2(readings.at(-1)!),
        delta:
          readings.length >= 2 ? round2(readings.at(-1)! - readings[0]!) : null,
        points: readings,
      }
    : null;

  return { snapshot, activities, weight };
}
