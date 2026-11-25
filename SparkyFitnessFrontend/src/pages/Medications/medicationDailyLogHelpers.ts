import {
  buildCheckinCreateBody,
  buildCheckinUpdateBody,
  buildEntryBody,
  defaultCheckinTime,
  draftFromEntry,
  hasCheckinContent,
  keepMostDetailedSleepEntries,
  mainSleepEntry,
  resolveSections,
  severityBand,
  slugifySymptomName,
  type CheckinDraft,
  type CreateSymptomEntryBody,
  type MoodCheckinCreateBody,
  type MoodCheckinUpdateBody,
  type SymptomChoice,
  type SymptomEntryResponse,
  type SymptomScaleType,
} from '@workspace/shared';
import type { MoodEntry } from '@/types/mood';
import type { SleepEntry } from '@/types';
import { kgToLbs, lbsToKg } from '@/utils/unitConversions';
import { prettifySource } from '@/utils/sourceLabels';

// ---------------------------------------------------------------------------
// Mood 1-5 <-> stored mood value (10-100, ten-point grid)
// ---------------------------------------------------------------------------

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** A 1-5 rating as the stored value: 1 -> 10, 2 -> 30, 3 -> 50, 4 -> 70, 5 -> 90. */
export const moodRatingToValue = (rating: number): number =>
  10 + (rating - 1) * 20;

/** A stored 10-100 mood value as the nearest 1-5 rating, or null when none. */
export const moodValueToRating = (
  value: number | string | null | undefined
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(
    RATING_MAX,
    Math.max(RATING_MIN, Math.round((numeric - 10) / 20) + 1)
  );
};

// ---------------------------------------------------------------------------
// Weight (stored in kg, typed in the user's unit)
// ---------------------------------------------------------------------------

export type DailyLogWeightUnit = 'kg' | 'lbs';

/** `st_lbs` users type pounds, the same as the wellness tile shows. */
export const weightInputUnit = (preference: string): DailyLogWeightUnit =>
  preference === 'kg' ? 'kg' : 'lbs';

const roundTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** The stored kg figure as the text prefilled in the field, to one decimal. */
export const weightToInputText = (
  kg: number | null | undefined,
  unit: DailyLogWeightUnit
): string => {
  if (kg === null || kg === undefined || !Number.isFinite(Number(kg)))
    return '';
  const value = unit === 'kg' ? Number(kg) : kgToLbs(Number(kg));
  return String(roundTo(value, 1));
};

const MAX_WEIGHT_KG = 999;

export type WeightCheck =
  | { status: 'unchanged' }
  | { status: 'invalid' }
  | { status: 'save'; kg: number };

/**
 * What typing `text` means for the day's weight. Blank leaves the weight alone,
 * and so does a value equal to the prefilled one (so the rounding shown in the
 * field never rewrites the stored figure).
 */
export const checkWeight = (
  text: string,
  storedKg: number | null | undefined,
  unit: DailyLogWeightUnit
): WeightCheck => {
  const trimmed = text.trim();
  if (trimmed === '') return { status: 'unchanged' };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(trimmed)) return { status: 'invalid' };
  const typed = Number(trimmed);
  if (!Number.isFinite(typed) || typed <= 0) return { status: 'invalid' };
  const kg = roundTo(unit === 'kg' ? typed : lbsToKg(typed), 2);
  if (kg <= 0 || kg > MAX_WEIGHT_KG) return { status: 'invalid' };
  const prefill = weightToInputText(storedKg, unit);
  if (prefill !== '' && Number(prefill) === typed)
    return { status: 'unchanged' };
  if (storedKg != null && Math.abs(Number(storedKg) - kg) < 0.005)
    return { status: 'unchanged' };
  return { status: 'save', kg };
};

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export const MAX_WATER_ML = 10000;

export type WaterCheck =
  { status: 'none' } | { status: 'invalid' } | { status: 'add'; ml: number };

/** A blank field adds nothing; otherwise a positive whole number of mL, at most 10000. */
export const checkWater = (text: string): WaterCheck => {
  const trimmed = text.trim();
  if (trimmed === '') return { status: 'none' };
  if (!/^\d+$/.test(trimmed)) return { status: 'invalid' };
  const ml = Number(trimmed);
  if (!Number.isSafeInteger(ml) || ml <= 0 || ml > MAX_WATER_ML)
    return { status: 'invalid' };
  return { status: 'add', ml };
};

// ---------------------------------------------------------------------------
// Severity: Mild / Moderate / Severe on a symptom's own scale
// ---------------------------------------------------------------------------

export const SEVERITY_LABELS = ['Mild', 'Moderate', 'Severe'] as const;
export type SeverityLabel = (typeof SEVERITY_LABELS)[number];

const BAND_FOR_LABEL = {
  Mild: 'low',
  Moderate: 'mid',
  Severe: 'high',
} as const;

const SCALE_VALUES: Record<
  Exclude<SymptomScaleType, 'count' | 'text'>,
  Record<SeverityLabel, number>
> = {
  '1-5': { Mild: 1, Moderate: 3, Severe: 5 },
  '1-10': { Mild: 2, Moderate: 5, Severe: 8 },
  'none-severe': { Mild: 1, Moderate: 2, Severe: 3 },
};

/**
 * The stored severity for a label on a scale. `severityBand` maps it back to
 * the same label's band; counts and free text carry no severity.
 */
export const severityValueForLabel = (
  label: SeverityLabel,
  scale: SymptomScaleType
): number | null =>
  scale === 'count' || scale === 'text' ? null : SCALE_VALUES[scale][label];

/** The label a stored severity reads as on its scale, or null. */
export const severityLabelForValue = (
  value: number | null,
  scale: SymptomScaleType
): SeverityLabel | null => {
  if (value === null || scale === 'count' || scale === 'text') return null;
  const band = severityBand(value, scale);
  return (
    SEVERITY_LABELS.find((label) => BAND_FOR_LABEL[label] === band) ?? null
  );
};

// ---------------------------------------------------------------------------
// Symptom choices and entry bodies
// ---------------------------------------------------------------------------

/** The chips offered: GLP-1 flagged or pinned, pinned first then by name. */
export const sideEffectChoices = (all: SymptomChoice[]): SymptomChoice[] =>
  all
    .filter((choice) => choice.isGlp1 || choice.isPinned)
    .sort(
      (a, b) =>
        Number(b.isPinned) - Number(a.isPinned) ||
        a.displayName.localeCompare(b.displayName)
    );

/** A choice for free text that has no definition yet, as the Symptoms form makes one. */
export const customSymptomChoice = (label: string): SymptomChoice => ({
  name: slugifySymptomName(label),
  displayName: label.trim(),
  template: 'generic',
  category: 'general',
  scaleType: '1-10',
  isEpisodic: false,
  isGlp1: false,
  isPinned: false,
  definitionId: null,
  sections: resolveSections('generic'),
  customFieldDefs: [],
});

/** The same key for a stored entry's name and a choice. */
export const symptomKey = (name: string): string => slugifySymptomName(name);

/** Whether the day already has an entry for this choice. */
export const isSymptomLogged = (
  choice: SymptomChoice,
  entries: Pick<SymptomEntryResponse, 'symptom_id' | 'symptom_name_snapshot'>[]
): boolean =>
  entries.some(
    (entry) =>
      (choice.definitionId !== null &&
        entry.symptom_id === choice.definitionId) ||
      symptomKey(entry.symptom_name_snapshot) === choice.name
  );

/** The request body for one side effect logged for `day`. */
export const buildSideEffectBody = (input: {
  choice: SymptomChoice;
  symptomId: string | null;
  label: SeverityLabel | null;
  day: string;
  today: string;
  now?: Date;
}): CreateSymptomEntryBody => {
  const { choice, symptomId, label, day, today, now } = input;
  const severity = label
    ? severityValueForLabel(label, choice.scaleType)
    : null;
  const body = buildEntryBody({
    state: {
      mode: 'quick',
      startedAt: '',
      ongoing: true,
      endedAt: '',
      severity,
      locations: [],
      phases: {},
      qualities: [],
      associated: [],
      triggers: [],
      impact: null,
      bristol: null,
      medicationId: null,
      notes: '',
      customFields: {},
      treatments: [],
    },
    choice,
    symptomId,
    selectedDate: day,
    today,
    isEdit: false,
    now,
  });
  // The form's default severity is a midpoint; here none chosen means none.
  return { ...body, severity, severity_label: label };
};

// ---------------------------------------------------------------------------
// Mood, energy and notes (one manual mood entry)
// ---------------------------------------------------------------------------

export const isManualMood = (entry: Pick<MoodEntry, 'source'>): boolean =>
  entry.source === 'manual';

/** The day's latest manual mood entry, the one the form edits. */
export const latestManualMood = (entries: MoodEntry[]): MoodEntry | null => {
  const manual = entries
    .filter(isManualMood)
    .sort(
      (a, b) =>
        new Date(a.entry_timestamp).getTime() -
        new Date(b.entry_timestamp).getTime()
    );
  return manual.length > 0 ? manual[manual.length - 1]! : null;
};

export type MoodPlan =
  | { action: 'none' }
  | { action: 'create'; body: MoodCheckinCreateBody }
  | { action: 'update'; id: string; body: MoodCheckinUpdateBody }
  | { action: 'delete'; id: string };

/**
 * What saving the mood, energy and notes means for the day's mood entry.
 * Focus and tags on an existing entry are carried through untouched; the entry
 * is deleted only when clearing leaves it with no content at all.
 */
export const planMoodSave = (input: {
  entry: MoodEntry | null;
  rating: number | null;
  energy: number | null;
  notes: string;
  day: string;
  timezone: string;
  now?: Date;
}): MoodPlan => {
  const { entry, rating, energy, notes, day, timezone, now } = input;
  if (!entry) {
    const draft: CheckinDraft = {
      mood: rating === null ? null : moodRatingToValue(rating),
      energy,
      focus: null,
      notes,
      tags: [],
      time: defaultCheckinTime(day, timezone, now),
    };
    if (!hasCheckinContent(draft)) return { action: 'none' };
    return {
      action: 'create',
      body: buildCheckinCreateBody(draft, day, timezone),
    };
  }
  const base = draftFromEntry(entry, timezone);
  const keepMood =
    rating !== null && rating === moodValueToRating(entry.mood_value);
  const draft: CheckinDraft = {
    ...base,
    mood:
      rating === null
        ? null
        : keepMood
          ? entry.mood_value
          : moodRatingToValue(rating),
    energy,
    notes,
  };
  const body = buildCheckinUpdateBody(entry, draft, day, timezone);
  if (Object.keys(body).length === 0) return { action: 'none' };
  if (!hasCheckinContent(draft)) return { action: 'delete', id: entry.id };
  return { action: 'update', id: entry.id, body };
};

// ---------------------------------------------------------------------------
// Read view
// ---------------------------------------------------------------------------

export interface DailyLogSources {
  day: string;
  weightKg: number | null;
  mood: MoodEntry | null;
  sleepEntries: SleepEntry[];
  calories: number | null;
  proteinG: number | null;
  waterMl: number;
  waterGoalMl: number | null;
  symptoms: Pick<
    SymptomEntryResponse,
    'id' | 'symptom_name_snapshot' | 'severity_label'
  >[];
}

export interface DailyLogSummary {
  weightKg: number | null;
  mood: number | null;
  energy: number | null;
  notes: string;
  sleep: { hours: number; source: string } | null;
  calories: number | null;
  proteinG: number | null;
  waterMl: number;
  waterGoalMl: number | null;
  symptoms: { id: string; name: string; label: string | null }[];
  hasValues: boolean;
}

/** The night's sleep for the day: the main record, hours asleep and where it came from. */
export const summarizeSleep = (
  entries: SleepEntry[],
  day: string
): DailyLogSummary['sleep'] => {
  const forDay = entries.filter(
    (entry) => entry.entry_date.slice(0, 10) === day
  );
  const main = mainSleepEntry(keepMostDetailedSleepEntries(forDay));
  if (!main) return null;
  const seconds = Number(
    main.time_asleep_in_seconds ?? main.duration_in_seconds
  );
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { hours: roundTo(seconds / 3600, 1), source: main.source };
};

export const formatSleepSource = (source: string): string =>
  source === 'manual' ? 'Manual' : prettifySource(source);

const orNull = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;

export const buildDailyLogSummary = (src: DailyLogSources): DailyLogSummary => {
  const notes = src.mood?.notes?.trim() ?? '';
  const summary: Omit<DailyLogSummary, 'hasValues'> = {
    weightKg: orNull(src.weightKg),
    mood: moodValueToRating(src.mood?.mood_value),
    energy: src.mood?.energy_value ?? null,
    notes,
    sleep: summarizeSleep(src.sleepEntries, src.day),
    calories: orNull(src.calories),
    proteinG: orNull(src.proteinG),
    waterMl: src.waterMl,
    waterGoalMl: src.waterGoalMl,
    symptoms: src.symptoms.map((entry) => ({
      id: entry.id,
      name: entry.symptom_name_snapshot,
      label: entry.severity_label,
    })),
  };
  return { ...summary, hasValues: summaryHasValues(summary) };
};

const summaryHasValues = (s: Omit<DailyLogSummary, 'hasValues'>): boolean =>
  s.weightKg !== null ||
  s.mood !== null ||
  s.energy !== null ||
  s.notes !== '' ||
  s.sleep !== null ||
  s.calories !== null ||
  s.proteinG !== null ||
  s.waterMl > 0 ||
  s.symptoms.length > 0;
