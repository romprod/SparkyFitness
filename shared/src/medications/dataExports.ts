import { LAB_MARKER_PRESETS, labRangeStatus } from '../constants/labMarkers.ts';
import type { CsvCell } from '../utils/csv.ts';
import { doseAsMg } from './doseHistory.ts';
import {
  expandBlendDose,
  weakestBlendSource,
  type BlendComponentRatio,
} from './blends.ts';

/**
 * Rows for the medication and lab CSV downloads. Pure: the server reads the records and these
 * only lay them out, so a column's meaning is fixed in one place.
 */

export const DOSE_EXPORT_HEADERS = [
  'taken_at',
  'local_day',
  'timezone',
  'medication',
  'kind',
  'status',
  'route',
  'dose',
  'dose_unit',
  'volume_ml',
  'syringe_units',
  'injection_site',
  'vial',
  'source',
  'scheduled_for',
  'minutes_from_schedule',
  'plan',
  'notes',
  'derived_from_blend',
] as const;

/** One recorded dose or injection, however it was stored. */
export interface DoseExportRecord {
  /** 'injection' rows come from the injection log, 'entry' rows from the medication log. */
  entry_type: 'entry' | 'injection';
  taken_at: Date | string | null;
  entry_date: string;
  /** The medication's id, so a dose of a blend can be split into its components. */
  medication_id?: string | null;
  medication: string | null;
  is_supplement: boolean | null;
  status: string;
  administration_route: string | null;
  dose_amount: string | number | null;
  dose_unit: string | null;
  volume_ml: string | null;
  syringe_units: string | null;
  site: string | null;
  vial: string | null;
  source: string | null;
  scheduled_for: Date | string | null;
  plan: string | null;
  notes: string | null;
}

const iso = (value: Date | string | null): string | null => {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Whole minutes between the planned instant and the recorded one; negative when taken early. */
const minutesFromSchedule = (
  takenAt: string | null,
  scheduledFor: string | null
): number | null =>
  takenAt === null || scheduledFor === null
    ? null
    : Math.round((Date.parse(takenAt) - Date.parse(scheduledFor)) / 60_000);

/** What the dose rows need to know about a blend: its name and what is in it. */
export interface DoseExportBlend {
  blend_medication_id: string;
  name: string;
  components: readonly BlendComponentRatio[];
}

const TAKEN = new Set(['taken', 'prn_taken']);

/**
 * One row per recorded dose. A taken dose of a blend that has components is followed by one row
 * for each component carrying the mass it received, worked out from the blend's stated ratio and
 * tagged in `derived_from_blend` with the blend and the source of the ratio, as Pitstop's export
 * does. Add up the dose column only for rows where that tag is empty: the component rows divide
 * the blend row's mass, they are not further doses.
 */
export function doseExportRows(
  records: readonly DoseExportRecord[],
  timezone: string,
  blends: readonly DoseExportBlend[] = []
): CsvCell[][] {
  const blendById = new Map(
    blends
      .filter((blend) => blend.components.length > 0)
      .map((blend) => [blend.blend_medication_id, blend])
  );
  return records.flatMap((record) => {
    const takenAt = iso(record.taken_at);
    const scheduledFor = iso(record.scheduled_for);
    const minutes = minutesFromSchedule(takenAt, scheduledFor);
    const route =
      record.administration_route ??
      (record.entry_type === 'injection' ? 'injection' : null);
    const kind = record.is_supplement ? 'supplement' : 'medication';
    const rows: CsvCell[][] = [
      [
        takenAt,
        record.entry_date,
        timezone,
        record.medication,
        kind,
        record.status,
        route,
        record.dose_amount === null ? null : String(record.dose_amount),
        record.dose_unit,
        record.volume_ml,
        record.syringe_units,
        record.site,
        record.vial,
        record.source,
        scheduledFor,
        minutes,
        record.plan,
        record.notes,
        null,
      ],
    ];
    const blend = record.medication_id
      ? blendById.get(record.medication_id)
      : undefined;
    const mg = blend ? doseAsMg(record.dose_amount, record.dose_unit) : null;
    if (blend && mg !== null && TAKEN.has(record.status)) {
      const source = weakestBlendSource(blend.components);
      for (const part of expandBlendDose(mg, blend.components))
        rows.push([
          takenAt,
          record.entry_date,
          timezone,
          part.name,
          kind,
          record.status,
          route,
          part.dose_mg,
          'mg',
          null,
          null,
          null,
          null,
          record.source,
          scheduledFor,
          minutes,
          record.plan,
          null,
          `${blend.name} (derived, ${source})`,
        ]);
    }
    return rows;
  });
}

export const LAB_EXPORT_HEADERS = [
  'collected_date',
  'lab',
  'marker',
  'value',
  'unit',
  'reference_low',
  'reference_high',
  'flag',
  'source',
  'notes',
] as const;

/** One lab result with the name of its marker resolved. */
export interface LabExportRecord {
  entry_date: string;
  lab_name: string | null;
  marker_key: string | null;
  /** The name of the person's own marker, for a result that is not a built-in one. */
  custom_marker_name: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string;
  ref_range_low: number | null;
  ref_range_high: number | null;
  source: string;
  notes: string | null;
}

const presetByKey = new Map(LAB_MARKER_PRESETS.map((p) => [p.key, p]));

export function labExportRows(
  records: readonly LabExportRecord[]
): CsvCell[][] {
  return records.map((record) => {
    const preset = record.marker_key
      ? presetByKey.get(record.marker_key)
      : undefined;
    // A result saved without its own range is judged by the built-in marker's default, but only
    // when it is in the unit that default is in.
    const own = record.ref_range_low !== null || record.ref_range_high !== null;
    const low = own
      ? record.ref_range_low
      : preset && preset.unit === record.unit
        ? preset.refRangeLow
        : null;
    const high = own
      ? record.ref_range_high
      : preset && preset.unit === record.unit
        ? preset.refRangeHigh
        : null;
    const status =
      record.value_numeric === null
        ? 'unknown'
        : labRangeStatus(record.value_numeric, low, high);
    return [
      record.entry_date,
      record.lab_name,
      preset?.displayName ??
        record.custom_marker_name ??
        record.marker_key ??
        null,
      record.value_numeric !== null ? record.value_numeric : record.value_text,
      record.unit,
      low,
      high,
      status === 'unknown' ? null : status,
      record.source,
      record.notes,
    ];
  });
}
