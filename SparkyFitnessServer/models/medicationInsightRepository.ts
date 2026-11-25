import {
  dayToUtcRange,
  instantToDay,
  type InsightDose,
  type InsightSymptom,
  type InsightWearableDay,
  type InsightWeightPoint,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * The records the insights compare, for the days `from_day` to `to_day` inclusive. Doses are the
 * owner's taken injectable doses (medication entries and injection logs); the wearable figures are
 * Garmin's, as Pitstop's insights use only that source rather than mix devices.
 */
export interface InsightRecords {
  doses: InsightDose[];
  wearable: InsightWearableDay[];
  weights_kg: InsightWeightPoint[];
  symptoms: InsightSymptom[];
  /** Medications whose plan slots count toward adherence. */
  injectable_medication_ids: string[];
}

interface DoseRow {
  at: Date | null;
  day: string;
}
interface HeartRow {
  day: string;
  resting_heart_rate: number | null;
  body_battery_highest: number | null;
}
interface SleepRow {
  day: string;
  sleep_seconds: string | number;
}
interface WeightRow {
  day: string;
  weight: string | number;
}
interface SymptomRow {
  name: string;
  day: string;
  logged_at: Date;
  started_at: Date | null;
  severity: string | number | null;
  severity_label: string | null;
}

const finite = (value: string | number | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function loadInsightRecords(
  userId: string,
  authenticatedUserId: string | undefined,
  window: { from_day: string; to_day: string },
  timezone: string
): Promise<InsightRecords> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const range = [userId, window.from_day, window.to_day];
    const [doses, heart, sleep, weights, symptoms, injectables] =
      await Promise.all([
        client.query(
          `SELECT i.injected_at AS at, i.entry_date::text AS day
             FROM injection_entries i
             LEFT JOIN medications m ON m.id=i.medication_id AND m.user_id=i.user_id
            WHERE i.user_id=$1 AND i.entry_date BETWEEN $2 AND $3
              AND m.is_supplement IS NOT TRUE
           UNION ALL
           SELECT e.taken_at, e.entry_date::text
             FROM medication_entries e
             JOIN medications m ON m.id=e.medication_id AND m.user_id=e.user_id
            WHERE e.user_id=$1 AND e.entry_date BETWEEN $2 AND $3
              AND e.status IN ('taken','prn_taken')
              AND m.type_id='injection' AND m.is_supplement IS NOT TRUE`,
          range
        ),
        client.query(
          `SELECT entry_date::text AS day, resting_heart_rate, body_battery_highest
             FROM daily_health_metrics
            WHERE user_id=$1 AND source_provider='garmin' AND entry_date BETWEEN $2 AND $3`,
          range
        ),
        // A night with no time recorded (a placeholder) is not a night of no sleep.
        client.query(
          `SELECT entry_date::text AS day,
                  SUM(COALESCE(time_asleep_in_seconds, duration_in_seconds)) AS sleep_seconds
             FROM sleep_entries
            WHERE user_id=$1 AND source='garmin' AND entry_date BETWEEN $2 AND $3
            GROUP BY entry_date
           HAVING SUM(COALESCE(time_asleep_in_seconds, duration_in_seconds)) > 0`,
          range
        ),
        client.query(
          `SELECT entry_date::text AS day, weight
             FROM check_in_measurements
            WHERE user_id=$1 AND weight IS NOT NULL AND weight > 0
              AND entry_date BETWEEN $2 AND $3`,
          range
        ),
        client.query(
          `SELECT symptom_name_snapshot AS name, entry_date::text AS day,
                  logged_at, started_at, severity, severity_label
             FROM symptom_entries
            WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3`,
          range
        ),
        client.query(
          `SELECT id FROM medications
            WHERE user_id=$1 AND type_id='injection' AND is_supplement IS NOT TRUE`,
          [userId]
        ),
      ]);

    const byDay = new Map<string, InsightWearableDay>();
    const dayRow = (day: string): InsightWearableDay => {
      const row = byDay.get(day) ?? {
        day,
        sleep_seconds: null,
        resting_hr: null,
        body_battery_high: null,
      };
      byDay.set(day, row);
      return row;
    };
    for (const row of heart.rows as HeartRow[]) {
      const entry = dayRow(row.day);
      entry.resting_hr = row.resting_heart_rate;
      entry.body_battery_high = row.body_battery_highest;
    }
    for (const row of sleep.rows as SleepRow[])
      dayRow(row.day).sleep_seconds = finite(row.sleep_seconds);

    return {
      // A dose logged without a time is placed at the start of its day.
      doses: (doses.rows as DoseRow[]).map((row) => ({
        at: (row.at ?? dayToUtcRange(row.day, timezone).start).toISOString(),
        day: row.day,
      })),
      wearable: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      weights_kg: (weights.rows as WeightRow[]).flatMap((row) => {
        const value = finite(row.weight);
        return value === null ? [] : [{ day: row.day, value }];
      }),
      // A symptom takes the time it began, or the time it was logged when that was on its own
      // day; one logged afterwards for an earlier day has no time of its own, so it starts the day.
      symptoms: (symptoms.rows as SymptomRow[]).map((row) => ({
        name: row.name,
        day: row.day,
        at: (
          row.started_at ??
          (instantToDay(row.logged_at, timezone) === row.day
            ? row.logged_at
            : dayToUtcRange(row.day, timezone).start)
        ).toISOString(),
        severity: finite(row.severity),
        severity_label: row.severity_label,
      })),
      injectable_medication_ids: (injectables.rows as { id: string }[]).map(
        (row) => row.id
      ),
    };
  } finally {
    client.release();
  }
}

/** An injectable, non-supplement medication, and whether a taken dose was logged in the window. */
export interface AdherenceMedication {
  id: string;
  name: string;
  dosed_in_window: boolean;
}

export async function loadAdherenceMedications(
  userId: string,
  authenticatedUserId: string | undefined,
  window: { from_day: string; to_day: string }
): Promise<AdherenceMedication[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT m.id, m.name,
              (EXISTS (SELECT 1 FROM injection_entries i
                        WHERE i.user_id=m.user_id AND i.medication_id=m.id
                          AND i.entry_date BETWEEN $2 AND $3)
               OR EXISTS (SELECT 1 FROM medication_entries e
                           WHERE e.user_id=m.user_id AND e.medication_id=m.id
                             AND e.entry_date BETWEEN $2 AND $3
                             AND e.status IN ('taken','prn_taken'))
              ) AS dosed_in_window
         FROM medications m
        WHERE m.user_id=$1 AND m.type_id='injection' AND m.is_supplement IS NOT TRUE
        ORDER BY m.name, m.id`,
      [userId, window.from_day, window.to_day]
    );
    return (result.rows as AdherenceMedication[]).map((row) => ({
      id: row.id,
      name: row.name,
      dosed_in_window: row.dosed_in_window === true,
    }));
  } finally {
    client.release();
  }
}
