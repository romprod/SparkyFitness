import type {
  WellnessActivity,
  WellnessDay,
  WellnessWeightPoint,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * The records behind the recovery and weight tile, for the days `from_day` to `to_day` inclusive:
 * Garmin's daily figures and workouts (Pitstop's tile uses only that source rather than mixing
 * devices) and the owner's weights. Reads only; nothing is written.
 */
export interface WellnessRecords {
  days: WellnessDay[];
  activities: WellnessActivity[];
  weights_kg: WellnessWeightPoint[];
}

interface HeartRow {
  day: string;
  resting_heart_rate: number | null;
  body_battery_highest: number | null;
  avg_stress_level: number | null;
}
interface SleepRow {
  day: string;
  sleep_score: string | number | null;
  avg_overnight_hrv: string | number | null;
  resting_heart_rate: number | null;
  sleep_seconds: string | number | null;
}
interface ActivityRow {
  day: string;
  name: string | null;
  duration_minutes: string | number;
}
interface WeightRow {
  day: string;
  weight: string | number;
}

const finite = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function loadWellnessRecords(
  userId: string,
  authenticatedUserId: string | undefined,
  window: { from_day: string; to_day: string; weights_from_day: string }
): Promise<WellnessRecords> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const range = [userId, window.from_day, window.to_day];
    const [heart, sleep, activities, weights] = await Promise.all([
      client.query(
        `SELECT entry_date::text AS day, resting_heart_rate, body_battery_highest, avg_stress_level
           FROM daily_health_metrics
          WHERE user_id=$1 AND source_provider='garmin' AND entry_date BETWEEN $2 AND $3`,
        range
      ),
      // One night a day: the longest, so a nap never stands in for the night's score.
      client.query(
        `SELECT DISTINCT ON (entry_date) entry_date::text AS day, sleep_score, avg_overnight_hrv,
                resting_heart_rate,
                COALESCE(time_asleep_in_seconds, duration_in_seconds) AS sleep_seconds
           FROM sleep_entries
          WHERE user_id=$1 AND source='garmin' AND entry_date BETWEEN $2 AND $3
          ORDER BY entry_date, COALESCE(time_asleep_in_seconds, duration_in_seconds) DESC NULLS LAST`,
        range
      ),
      // Garmin also stores a zero-minute "Active Calories" row for each day; it is not a workout.
      client.query(
        `SELECT entry_date::text AS day, exercise_name AS name, duration_minutes
           FROM exercise_entries
          WHERE user_id=$1 AND source='garmin' AND duration_minutes > 0
            AND entry_date BETWEEN $2 AND $3`,
        range
      ),
      client.query(
        `SELECT entry_date::text AS day, weight
           FROM check_in_measurements
          WHERE user_id=$1 AND weight IS NOT NULL AND weight > 0
            AND entry_date BETWEEN $2 AND $3
          ORDER BY entry_date`,
        [userId, window.weights_from_day, window.to_day]
      ),
    ]);

    const byDay = new Map<string, WellnessDay>();
    const dayRow = (day: string): WellnessDay => {
      const row = byDay.get(day) ?? {
        day,
        resting_hr: null,
        hrv_ms: null,
        body_battery: null,
        sleep_score: null,
        sleep_seconds: null,
        avg_stress: null,
      };
      byDay.set(day, row);
      return row;
    };
    for (const row of sleep.rows as SleepRow[]) {
      const entry = dayRow(row.day);
      entry.sleep_score = finite(row.sleep_score);
      entry.hrv_ms = finite(row.avg_overnight_hrv);
      entry.sleep_seconds = finite(row.sleep_seconds);
      // The day's own resting rate wins below; the night's fills in when the day has none.
      entry.resting_hr = row.resting_heart_rate;
    }
    for (const row of heart.rows as HeartRow[]) {
      const entry = dayRow(row.day);
      entry.resting_hr = row.resting_heart_rate ?? entry.resting_hr;
      entry.body_battery = row.body_battery_highest;
      entry.avg_stress = finite(row.avg_stress_level);
    }

    return {
      days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      activities: (activities.rows as ActivityRow[]).flatMap((row) => {
        const minutes = finite(row.duration_minutes);
        return minutes === null || minutes <= 0
          ? []
          : [
              {
                day: row.day,
                name: row.name?.trim() || '',
                duration_minutes: Math.round(minutes * 10) / 10,
              },
            ];
      }),
      weights_kg: (weights.rows as WeightRow[]).flatMap((row) => {
        const value = finite(row.weight);
        return value === null ? [] : [{ day: row.day, value }];
      }),
    };
  } finally {
    client.release();
  }
}
