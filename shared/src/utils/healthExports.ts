import type { CsvCell } from './csv.ts';

/**
 * The two daily-record CSVs Pitstop offers beside doses and labs: the wearable's daily figures
 * and the journal of a day's weight, mood, sleep, calories, protein, water and side effects. Pure row builders: the server reads
 * the records, these lay them out, and `toCsv` writes them. Numbers stay numbers, so a spreadsheet
 * can total them, and a figure that was not recorded is an empty cell, never a zero.
 */

type Num = number | null;

/** One wearable day from one source; every figure may be missing. */
export interface WearableExportRecord {
  entry_date: string;
  source: string;
  sleep_seconds: Num;
  sleep_deep_seconds: Num;
  sleep_light_seconds: Num;
  sleep_rem_seconds: Num;
  sleep_awake_seconds: Num;
  sleep_score: Num;
  bedtime: string | null;
  wake_time: string | null;
  resting_hr: Num;
  hrv_ms: Num;
  body_battery_high: Num;
  body_battery_low: Num;
  body_battery_charged: Num;
  body_battery_drained: Num;
  stress_avg: Num;
  stress_max: Num;
  steps: Num;
  distance_m: Num;
  floors_climbed: Num;
  active_calories: Num;
  total_calories: Num;
  exercise_minutes: Num;
  moderate_minutes: Num;
  vigorous_minutes: Num;
  vo2_max: Num;
  training_readiness: Num;
  recovery_time_hours: Num;
  spo2_avg: Num;
  respiration_avg: Num;
  synced_at: string | null;
}

export const WEARABLE_EXPORT_HEADERS = [
  'date',
  'source',
  'sleep_seconds',
  'sleep_deep_seconds',
  'sleep_light_seconds',
  'sleep_rem_seconds',
  'sleep_awake_seconds',
  'sleep_score',
  'bedtime',
  'wake_time',
  'resting_hr',
  'hrv_ms',
  'body_battery_high',
  'body_battery_low',
  'body_battery_charged',
  'body_battery_drained',
  'stress_avg',
  'stress_max',
  'steps',
  'distance_m',
  'floors_climbed',
  'active_calories',
  'total_calories',
  'exercise_minutes',
  'moderate_minutes',
  'vigorous_minutes',
  'vo2_max',
  'training_readiness',
  'recovery_time_hours',
  'spo2_avg',
  'respiration_avg',
  'synced_at',
] as const;

/** Newest day first, a source's rows together within a day. */
export function wearableExportRows(
  records: readonly WearableExportRecord[]
): CsvCell[][] {
  return [...records]
    .sort(
      (a, b) =>
        b.entry_date.localeCompare(a.entry_date) ||
        a.source.localeCompare(b.source)
    )
    .map((record) => [
      record.entry_date,
      record.source,
      record.sleep_seconds,
      record.sleep_deep_seconds,
      record.sleep_light_seconds,
      record.sleep_rem_seconds,
      record.sleep_awake_seconds,
      record.sleep_score,
      record.bedtime,
      record.wake_time,
      record.resting_hr,
      record.hrv_ms,
      record.body_battery_high,
      record.body_battery_low,
      record.body_battery_charged,
      record.body_battery_drained,
      record.stress_avg,
      record.stress_max,
      record.steps,
      record.distance_m,
      record.floors_climbed,
      record.active_calories,
      record.total_calories,
      record.exercise_minutes,
      record.moderate_minutes,
      record.vigorous_minutes,
      record.vo2_max,
      record.training_readiness,
      record.recovery_time_hours,
      record.spo2_avg,
      record.respiration_avg,
      record.synced_at,
    ]);
}

/** What the journal reads, as separate lists the server loads; any day can appear in any list. */
export interface JournalParts {
  measurements: {
    day: string;
    at: string;
    weight_kg: Num;
    body_fat_percent: Num;
    muscle_mass_kg: Num;
  }[];
  moods: {
    day: string;
    at: string;
    mood: Num;
    energy: Num;
    focus: Num;
    notes: string | null;
  }[];
  water: { day: string; water_ml: Num }[];
  sleep: { day: string; seconds: Num }[];
  /** The food diary's daily totals; a figure the diary does not know is null. */
  nutrition: { day: string; calories: Num; protein_g: Num }[];
  /** Symptom log entries; `at` orders a day's entries. */
  symptoms: {
    day: string;
    at: string;
    name: string;
    severity_label: string | null;
  }[];
}

export interface JournalExportRecord {
  entry_date: string;
  weight_kg: Num;
  body_fat_percent: Num;
  muscle_mass_kg: Num;
  mood: Num;
  energy: Num;
  focus: Num;
  /** Hours of the longest night, to one decimal. */
  sleep_hours: Num;
  /** The day's food diary total, whole kcal. */
  calories: Num;
  /** The day's food diary protein, to one decimal. */
  protein_g: Num;
  water_ml: Num;
  /** The day's symptoms, oldest first, as "Nausea (moderate), Headache". */
  side_effects: string | null;
  /** Every note of the day, oldest first, joined with " | ". */
  notes: string | null;
}

export const JOURNAL_EXPORT_HEADERS = [
  'date',
  'weight_kg',
  'body_fat_percent',
  'muscle_mass_kg',
  'mood',
  'energy',
  'focus',
  'sleep_hours',
  'calories',
  'protein_g',
  'water_ml',
  'side_effects',
  'notes',
] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One record per day that has anything, newest first. Pitstop's journal holds one entry a day;
 * here a day can have several readings, so each figure takes the latest one that has it, water is
 * the day's total, and the day's notes are all kept.
 */
export function journalExportRecords(
  parts: JournalParts
): JournalExportRecord[] {
  const days = new Map<string, JournalExportRecord>();
  const dayOf = (day: string): JournalExportRecord => {
    let record = days.get(day);
    if (!record) {
      record = {
        entry_date: day,
        weight_kg: null,
        body_fat_percent: null,
        muscle_mass_kg: null,
        mood: null,
        energy: null,
        focus: null,
        sleep_hours: null,
        calories: null,
        protein_g: null,
        water_ml: null,
        side_effects: null,
        notes: null,
      };
      days.set(day, record);
    }
    return record;
  };
  const oldestFirst = <T extends { at: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.at.localeCompare(b.at));

  // Later readings overwrite earlier ones, but only with a figure they actually have.
  for (const row of oldestFirst(parts.measurements)) {
    const record = dayOf(row.day);
    if (row.weight_kg !== null) record.weight_kg = row.weight_kg;
    if (row.body_fat_percent !== null)
      record.body_fat_percent = row.body_fat_percent;
    if (row.muscle_mass_kg !== null) record.muscle_mass_kg = row.muscle_mass_kg;
  }
  const notes = new Map<string, string[]>();
  for (const row of oldestFirst(parts.moods)) {
    const record = dayOf(row.day);
    if (row.mood !== null) record.mood = row.mood;
    if (row.energy !== null) record.energy = row.energy;
    if (row.focus !== null) record.focus = row.focus;
    const text = row.notes?.trim();
    if (text) notes.set(row.day, [...(notes.get(row.day) ?? []), text]);
  }
  for (const [day, list] of notes) dayOf(day).notes = list.join(' | ');
  for (const row of parts.water) {
    if (row.water_ml === null) continue;
    const record = dayOf(row.day);
    record.water_ml = (record.water_ml ?? 0) + row.water_ml;
  }
  for (const row of parts.sleep) {
    if (row.seconds === null || !(row.seconds > 0)) continue;
    const record = dayOf(row.day);
    record.sleep_hours = Math.max(
      record.sleep_hours ?? 0,
      round1(row.seconds / 3600)
    );
  }
  for (const row of parts.nutrition) {
    const calories = row.calories !== null && Number.isFinite(row.calories);
    const protein = row.protein_g !== null && Number.isFinite(row.protein_g);
    if (!calories && !protein) continue;
    const record = dayOf(row.day);
    if (calories) record.calories = Math.round(row.calories as number);
    if (protein) record.protein_g = round1(row.protein_g as number);
  }
  const effects = new Map<string, string[]>();
  for (const row of oldestFirst(parts.symptoms)) {
    const name = row.name?.trim();
    if (!name) continue;
    const label = row.severity_label?.trim().toLowerCase();
    effects.set(row.day, [
      ...(effects.get(row.day) ?? []),
      label ? `${name} (${label})` : name,
    ]);
  }
  for (const [day, list] of effects) dayOf(day).side_effects = list.join(', ');
  return [...days.values()].sort((a, b) =>
    b.entry_date.localeCompare(a.entry_date)
  );
}

export function journalExportRows(
  records: readonly JournalExportRecord[]
): CsvCell[][] {
  return records.map((record) => [
    record.entry_date,
    record.weight_kg,
    record.body_fat_percent,
    record.muscle_mass_kg,
    record.mood,
    record.energy,
    record.focus,
    record.sleep_hours,
    record.calories,
    record.protein_g,
    record.water_ml,
    record.side_effects,
    record.notes,
  ]);
}
