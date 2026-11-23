import type { JournalParts, WearableExportRecord } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * The owner's daily records for the CSV downloads. Reads only; nothing is written. Wearable rows
 * are one per day and source, with the night's sleep laid beside the day's figures.
 */

type Raw = string | number | Date | null | undefined;

const num = (value: Raw): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const instant = (value: Raw): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function listWearableExportRecords(
  userId: string,
  authenticatedUserId?: string
): Promise<WearableExportRecord[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const [daily, sleep] = await Promise.all([
      client.query(
        `SELECT entry_date::text AS day, source_provider AS source, total_steps,
                total_distance_meters, floors_ascended, active_calories, total_calories,
                exercise_minutes, moderate_intensity_minutes, vigorous_intensity_minutes,
                resting_heart_rate, vo2_max, avg_stress_level, max_stress_level,
                body_battery_charged, body_battery_drained, body_battery_highest,
                body_battery_lowest, training_readiness_score, recovery_time_hours, updated_at
           FROM daily_health_metrics
          WHERE user_id=$1`,
        [userId]
      ),
      // The longest night of each day and source, so a nap never stands in for it.
      client.query(
        `SELECT DISTINCT ON (entry_date, source) entry_date::text AS day, source, bedtime,
                wake_time, COALESCE(time_asleep_in_seconds, duration_in_seconds) AS sleep_seconds,
                deep_sleep_seconds, light_sleep_seconds, rem_sleep_seconds, awake_sleep_seconds,
                sleep_score, avg_overnight_hrv, average_spo2_value, average_respiration_value,
                resting_heart_rate
           FROM sleep_entries
          WHERE user_id=$1
          ORDER BY entry_date, source,
                   COALESCE(time_asleep_in_seconds, duration_in_seconds) DESC NULLS LAST`,
        [userId]
      ),
    ]);

    const rows = new Map<string, WearableExportRecord>();
    const rowFor = (day: string, source: string): WearableExportRecord => {
      const key = `${day}|${source}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          entry_date: day,
          source,
          sleep_seconds: null,
          sleep_deep_seconds: null,
          sleep_light_seconds: null,
          sleep_rem_seconds: null,
          sleep_awake_seconds: null,
          sleep_score: null,
          bedtime: null,
          wake_time: null,
          resting_hr: null,
          hrv_ms: null,
          body_battery_high: null,
          body_battery_low: null,
          body_battery_charged: null,
          body_battery_drained: null,
          stress_avg: null,
          stress_max: null,
          steps: null,
          distance_m: null,
          floors_climbed: null,
          active_calories: null,
          total_calories: null,
          exercise_minutes: null,
          moderate_minutes: null,
          vigorous_minutes: null,
          vo2_max: null,
          training_readiness: null,
          recovery_time_hours: null,
          spo2_avg: null,
          respiration_avg: null,
          synced_at: null,
        };
        rows.set(key, row);
      }
      return row;
    };

    for (const r of sleep.rows as Record<string, Raw>[]) {
      const row = rowFor(String(r['day']), String(r['source'] ?? ''));
      row.sleep_seconds = num(r['sleep_seconds']);
      row.sleep_deep_seconds = num(r['deep_sleep_seconds']);
      row.sleep_light_seconds = num(r['light_sleep_seconds']);
      row.sleep_rem_seconds = num(r['rem_sleep_seconds']);
      row.sleep_awake_seconds = num(r['awake_sleep_seconds']);
      row.sleep_score = num(r['sleep_score']);
      row.bedtime = instant(r['bedtime']);
      row.wake_time = instant(r['wake_time']);
      row.hrv_ms = num(r['avg_overnight_hrv']);
      row.spo2_avg = num(r['average_spo2_value']);
      row.respiration_avg = num(r['average_respiration_value']);
      // The day's own resting rate wins below; the night's fills in when the day has none.
      row.resting_hr = num(r['resting_heart_rate']);
    }
    for (const r of daily.rows as Record<string, Raw>[]) {
      const row = rowFor(String(r['day']), String(r['source'] ?? ''));
      row.resting_hr = num(r['resting_heart_rate']) ?? row.resting_hr;
      row.body_battery_high = num(r['body_battery_highest']);
      row.body_battery_low = num(r['body_battery_lowest']);
      row.body_battery_charged = num(r['body_battery_charged']);
      row.body_battery_drained = num(r['body_battery_drained']);
      row.stress_avg = num(r['avg_stress_level']);
      row.stress_max = num(r['max_stress_level']);
      row.steps = num(r['total_steps']);
      row.distance_m = num(r['total_distance_meters']);
      row.floors_climbed = num(r['floors_ascended']);
      row.active_calories = num(r['active_calories']);
      row.total_calories = num(r['total_calories']);
      row.exercise_minutes = num(r['exercise_minutes']);
      row.moderate_minutes = num(r['moderate_intensity_minutes']);
      row.vigorous_minutes = num(r['vigorous_intensity_minutes']);
      row.vo2_max = num(r['vo2_max']);
      row.training_readiness = num(r['training_readiness_score']);
      row.recovery_time_hours = num(r['recovery_time_hours']);
      row.synced_at = instant(r['updated_at']);
    }
    return [...rows.values()];
  } finally {
    client.release();
  }
}

export async function loadJournalExportParts(
  userId: string,
  authenticatedUserId?: string
): Promise<JournalParts> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const [measurements, moods, water, sleep] = await Promise.all([
      client.query(
        `SELECT entry_date::text AS day, COALESCE(updated_at, created_at) AS at, weight,
                body_fat_percentage, muscle_mass_kg
           FROM check_in_measurements
          WHERE user_id=$1`,
        [userId]
      ),
      client.query(
        `SELECT entry_date::text AS day, COALESCE(entry_timestamp, created_at) AS at,
                mood_value, energy_value, focus_value, notes
           FROM mood_entries
          WHERE user_id=$1`,
        [userId]
      ),
      client.query(
        `SELECT entry_date::text AS day, SUM(water_ml) AS water_ml
           FROM water_intake
          WHERE user_id=$1
          GROUP BY entry_date`,
        [userId]
      ),
      client.query(
        `SELECT entry_date::text AS day,
                MAX(COALESCE(time_asleep_in_seconds, duration_in_seconds)) AS seconds
           FROM sleep_entries
          WHERE user_id=$1
          GROUP BY entry_date`,
        [userId]
      ),
    ]);
    return {
      // A weight of zero or less is not a reading.
      measurements: (measurements.rows as Record<string, Raw>[]).map((r) => {
        const weight = num(r['weight']);
        return {
          day: String(r['day']),
          at: instant(r['at']) ?? '',
          weight_kg: weight !== null && weight > 0 ? weight : null,
          body_fat_percent: num(r['body_fat_percentage']),
          muscle_mass_kg: num(r['muscle_mass_kg']),
        };
      }),
      moods: (moods.rows as Record<string, Raw>[]).map((r) => ({
        day: String(r['day']),
        at: instant(r['at']) ?? '',
        mood: num(r['mood_value']),
        energy: num(r['energy_value']),
        focus: num(r['focus_value']),
        notes: r['notes'] === null ? null : String(r['notes']),
      })),
      water: (water.rows as Record<string, Raw>[]).map((r) => ({
        day: String(r['day']),
        water_ml: num(r['water_ml']),
      })),
      sleep: (sleep.rows as Record<string, Raw>[]).map((r) => ({
        day: String(r['day']),
        seconds: num(r['seconds']),
      })),
    };
  } finally {
    client.release();
  }
}
