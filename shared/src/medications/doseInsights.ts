import { addDays } from '../utils/timezone.ts';

/**
 * Descriptive cross-metric insights, as Pitstop's Insights card computes them. Every insight is a
 * plain comparison with its sample sizes shown. Nothing here is a causal claim or a statistical
 * test: no p-values, no correlation coefficients. A comparison with fewer than
 * `INSIGHT_MIN_SAMPLE` points on either side is left out rather than shown as noise.
 *
 * Pure: the caller loads the records and passes plain values (weights already in the unit to be
 * shown); the results are numbers, not sentences, so the screen words them in the user's language.
 */

/** Points required on each side of a comparison, and of timed symptom days, before it is shown. */
export const INSIGHT_MIN_SAMPLE = 5;
/** The trailing window the insights cover, today included. */
export const INSIGHT_WINDOW_DAYS = 90;
/** The look-back windows of the weight trend. */
export const INSIGHT_WEIGHT_WINDOWS = [30, 60, 90] as const;
/** How many of the most-logged symptoms are listed. */
export const INSIGHT_TOP_SYMPTOMS = 3;

/** A dose that was taken: the instant, and the calendar day it belongs to for the owner. */
export interface InsightDose {
  at: string;
  day: string;
}
/** One day of the wearable's daily figures; any may be missing. */
export interface InsightWearableDay {
  day: string;
  sleep_seconds: number | null;
  resting_hr: number | null;
  body_battery_high: number | null;
}
export interface InsightWeightPoint {
  day: string;
  value: number;
}
/** One logged symptom, with the instant it began (or was logged). */
export interface InsightSymptom {
  name: string;
  day: string;
  at: string;
  severity_label: string | null;
  severity: number | null;
}

export interface DoseInsightInput {
  /** The owner's current day, 'YYYY-MM-DD'; the window ends on it. */
  today: string;
  doses: readonly InsightDose[];
  wearable: readonly InsightWearableDay[];
  /** Weights in the unit named by `weight_unit`. */
  weights: readonly InsightWeightPoint[];
  weight_unit: string;
  symptoms: readonly InsightSymptom[];
  /** Overall adherence over the window, 0 to 100, or null when no dose was scored. */
  adherence_pct: number | null;
}

/**
 * What the server sends for the insights: the records of the trailing window, not yet compared.
 * Weights are in kilograms; the screen converts them to the unit the person reads.
 */
export interface MedicationInsightStreams {
  /** The owner's current day, and the first day of the window, 'YYYY-MM-DD'. */
  today: string;
  from_day: string;
  doses: InsightDose[];
  wearable: InsightWearableDay[];
  weights_kg: InsightWeightPoint[];
  symptoms: InsightSymptom[];
  /** Taken out of taken plus missed over the window's plan slots, or null when none were scored. */
  adherence_pct: number | null;
}

export type DoseSplitKind =
  'sleep_dose' | 'resting_hr_dose' | 'body_battery_dose';

export interface DoseSplitInsight {
  kind: DoseSplitKind;
  /** The average on dose days: hours of sleep to one decimal, otherwise a whole number. */
  on_dose: number;
  other: number;
  samples: { on_dose: number; other: number };
}
export interface WeightTrendWindow {
  days: number;
  /** Latest minus earliest in the window, to one decimal. */
  delta: number;
  samples: number;
}
export interface WeightTrendInsight {
  kind: 'weight_trend';
  unit: string;
  windows: WeightTrendWindow[];
}
export interface SymptomFrequencyInsight {
  kind: 'symptom_frequency';
  top: { name: string; days: number; mostly: string | null }[];
}
export interface SymptomTimingInsight {
  kind: 'symptom_timing';
  /** Symptom days that had a dose before them. */
  total: number;
  within_24h: number;
  from_24h_to_72h: number;
  after_72h: number;
}
export interface AdherenceWeightInsight {
  kind: 'adherence_weight';
  adherence_pct: number;
  unit: string;
  weight: WeightTrendWindow;
}
export type DoseInsight =
  | DoseSplitInsight
  | WeightTrendInsight
  | SymptomFrequencyInsight
  | SymptomTimingInsight
  | AdherenceWeightInsight;

const HOUR_MS = 3_600_000;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number =>
  xs.reduce((sum, x) => sum + x, 0) / xs.length;

/** The label that most of a symptom's entries carry; a tie goes to the milder one. */
function mostlyLabel(
  entries: readonly { label: string | null; severity: number | null }[]
): string | null {
  const byLabel = new Map<string, { count: number; severities: number[] }>();
  for (const entry of entries) {
    if (!entry.label) continue;
    const key = entry.label.trim().toLowerCase();
    if (!key) continue;
    const group = byLabel.get(key) ?? { count: 0, severities: [] };
    group.count += 1;
    if (entry.severity !== null && Number.isFinite(entry.severity))
      group.severities.push(entry.severity);
    byLabel.set(key, group);
  }
  const ranked = [...byLabel.entries()].sort(
    ([nameA, a], [nameB, b]) =>
      b.count - a.count ||
      (a.severities.length && b.severities.length
        ? mean(a.severities) - mean(b.severities)
        : 0) ||
      nameA.localeCompare(nameB)
  );
  return ranked[0]?.[0] ?? null;
}

function splitInsight(
  kind: DoseSplitKind,
  doseDays: ReadonlySet<string>,
  rows: readonly InsightWearableDay[],
  pick: (row: InsightWearableDay) => number | null,
  tidy: (n: number) => number
): DoseSplitInsight | null {
  const onDose: number[] = [];
  const other: number[] = [];
  for (const row of rows) {
    const value = pick(row);
    if (value === null || !Number.isFinite(value)) continue;
    (doseDays.has(row.day) ? onDose : other).push(value);
  }
  if (onDose.length < INSIGHT_MIN_SAMPLE || other.length < INSIGHT_MIN_SAMPLE)
    return null;
  return {
    kind,
    on_dose: tidy(mean(onDose)),
    other: tidy(mean(other)),
    samples: { on_dose: onDose.length, other: other.length },
  };
}

/**
 * The insights that have enough data, in a fixed order: sleep, resting heart rate, Body Battery,
 * weight trend, most-logged symptoms, symptom timing, then adherence beside weight.
 */
export function computeDoseInsights(input: DoseInsightInput): DoseInsight[] {
  const from = addDays(input.today, -(INSIGHT_WINDOW_DAYS - 1));
  const inWindow = (day: string): boolean => day >= from && day <= input.today;
  const insights: DoseInsight[] = [];

  const doses = input.doses
    .filter((dose) => Number.isFinite(Date.parse(dose.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const doseDays = new Set(
    doses.filter((dose) => inWindow(dose.day)).map((dose) => dose.day)
  );
  const wearable = input.wearable.filter((row) => inWindow(row.day));

  const sleep = splitInsight(
    'sleep_dose',
    doseDays,
    wearable,
    (row) => (row.sleep_seconds === null ? null : row.sleep_seconds / 3600),
    round1
  );
  const restingHr = splitInsight(
    'resting_hr_dose',
    doseDays,
    wearable,
    (row) => row.resting_hr,
    Math.round
  );
  const bodyBattery = splitInsight(
    'body_battery_dose',
    doseDays,
    wearable,
    (row) => row.body_battery_high,
    Math.round
  );
  for (const split of [sleep, restingHr, bodyBattery])
    if (split) insights.push(split);

  // Weight: the change over the last 30, 60 and 90 days, from the first to the latest reading.
  const weights = input.weights
    .filter((point) => Number.isFinite(point.value) && inWindow(point.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  const weightWindows: WeightTrendWindow[] = [];
  for (const days of INSIGHT_WEIGHT_WINDOWS) {
    const cutoff = addDays(input.today, -days);
    const points = weights.filter((point) => point.day > cutoff);
    if (points.length < INSIGHT_MIN_SAMPLE) continue;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    weightWindows.push({
      days,
      delta: round1(last.value - first.value),
      samples: points.length,
    });
  }
  if (weightWindows.length)
    insights.push({
      kind: 'weight_trend',
      unit: input.weight_unit,
      windows: weightWindows,
    });

  // Symptoms: the most often logged, counted in days.
  const symptoms = input.symptoms
    .filter((s) => s.name.trim() && inWindow(s.day))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (symptoms.length) {
    const byName = new Map<
      string,
      {
        name: string;
        days: Set<string>;
        entries: { label: string | null; severity: number | null }[];
      }
    >();
    for (const symptom of symptoms) {
      const key = symptom.name.trim().toLowerCase();
      const group = byName.get(key) ?? {
        name: symptom.name.trim(),
        days: new Set<string>(),
        entries: [],
      };
      group.days.add(symptom.day);
      group.entries.push({
        label: symptom.severity_label,
        severity: symptom.severity,
      });
      byName.set(key, group);
    }
    const top = [...byName.values()]
      .sort((a, b) => b.days.size - a.days.size || a.name.localeCompare(b.name))
      .slice(0, INSIGHT_TOP_SYMPTOMS)
      .map((group) => ({
        name: group.name,
        days: group.days.size,
        mostly: mostlyLabel(group.entries),
      }));
    insights.push({ kind: 'symptom_frequency', top });
  }

  // Timing: for each day with a symptom, the hours since the dose before the first symptom of
  // that day that has one.
  const doseTimes = doses.map((dose) => Date.parse(dose.at));
  const daysWithSymptoms = new Map<string, number[]>();
  for (const symptom of symptoms) {
    const at = Date.parse(symptom.at);
    if (!Number.isFinite(at)) continue;
    daysWithSymptoms.set(symptom.day, [
      ...(daysWithSymptoms.get(symptom.day) ?? []),
      at,
    ]);
  }
  let within24 = 0;
  let within72 = 0;
  let later = 0;
  for (const times of daysWithSymptoms.values()) {
    for (const at of times) {
      const prior = doseTimes.filter((dose) => dose <= at).at(-1);
      if (prior === undefined) continue;
      const hours = (at - prior) / HOUR_MS;
      if (hours <= 24) within24 += 1;
      else if (hours <= 72) within72 += 1;
      else later += 1;
      break;
    }
  }
  const timed = within24 + within72 + later;
  if (timed >= INSIGHT_MIN_SAMPLE)
    insights.push({
      kind: 'symptom_timing',
      total: timed,
      within_24h: within24,
      from_24h_to_72h: within72,
      after_72h: later,
    });

  // Adherence beside weight: shown together, never as cause and effect.
  const longest = weightWindows.at(-1);
  if (input.adherence_pct !== null && longest)
    insights.push({
      kind: 'adherence_weight',
      adherence_pct: input.adherence_pct,
      unit: input.weight_unit,
      weight: longest,
    });

  return insights;
}
