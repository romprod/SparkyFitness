import { Decimal } from 'decimal.js';
import { addDays, daysBetween, dayOfWeek } from '../utils/timezone.ts';
import type { BlendSource } from '../schemas/api/MedicationBlends.api.zod.ts';
import {
  expandBlendDose,
  weakestBlendSource,
  type BlendComponentRatio,
} from './blends.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** The slice of a logged dose the history views read; real entries and injections both fit. */
export interface DoseHistoryEntry {
  medication_id: string | null;
  status: string;
  entry_date: string;
  dose_amount_snapshot: number | string | null;
  dose_unit_snapshot: string | null;
  med_name_snapshot: string | null;
}

const TAKEN = new Set(['taken', 'prn_taken']);

/** What exposure needs to know about a blend: which medication it is and what is in it. */
export interface BlendCompositionRef {
  blend_medication_id: string;
  components: readonly BlendComponentRatio[];
}

export interface DoseHeatmapDay {
  date: string;
  count: number;
}

export const DOSE_HEATMAP_MAX_DAYS = 364;

/**
 * One bucket per calendar day from the first logged dose (at most a year back) through today,
 * counting taken doses. Skipped, missed and snoozed entries are not doses. Empty with no doses.
 */
export function doseHeatmap(
  entries: readonly DoseHistoryEntry[],
  today: string,
  maxDays: number = DOSE_HEATMAP_MAX_DAYS
): { from: string | null; days: DoseHeatmapDay[] } {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!TAKEN.has(entry.status) || entry.entry_date > today) continue;
    counts.set(entry.entry_date, (counts.get(entry.entry_date) ?? 0) + 1);
  }
  if (counts.size === 0) return { from: null, days: [] };
  const first = [...counts.keys()].sort()[0]!;
  const earliest = addDays(today, -(maxDays - 1));
  const from = first > earliest ? first : earliest;
  const days: DoseHeatmapDay[] = [];
  for (let n = 0, span = daysBetween(from, today); n <= span; n++) {
    const date = addDays(from, n);
    days.push({ date, count: counts.get(date) ?? 0 });
  }
  return { from, days };
}

/** Monday-first column index (0 = Monday … 6 = Sunday) of a calendar day. */
export const mondayIndex = (day: string): number => (dayOfWeek(day) + 6) % 7;

const MG_PER_UNIT: Record<string, string> = {
  mcg: '0.001',
  µg: '0.001',
  μg: '0.001',
  ug: '0.001',
  mg: '1',
  g: '1000',
};

/** A dose in mass units as milligrams; null for counts, volumes and anything unrecognised. */
export function doseAsMg(
  amount: number | string | null | undefined,
  unit: string | null | undefined
): string | null {
  const factor = MG_PER_UNIT[(unit ?? '').trim().toLowerCase()];
  if (factor === undefined || amount === null || amount === undefined)
    return null;
  try {
    const value = new D(amount);
    if (!value.isFinite() || value.lt(0)) return null;
    return value.mul(factor).toString();
  } catch {
    return null;
  }
}

export interface ExposureRow {
  medication_id: string | null;
  name: string;
  doses: number;
  /** Everything counted for the medication: what was logged for it plus what blends delivered. */
  total_mg: string;
  /** The part of `total_mg` that came through a blend's stated ratio, not a dose logged for it. */
  via_blends_mg: string;
  /** The weakest ratio source among the blends that delivered some of it; null when none did. */
  derived_source: BlendSource | null;
  first_date: string;
  last_date: string;
}

/**
 * All-time mass per medication from taken doses recorded in mass units. Doses in tablets,
 * millilitres or other units are left out rather than converted by guesswork.
 *
 * A dose of a blend that has components is counted for each of its components by their share of
 * the vial, as Pitstop's exposure table does, and no longer under the blend's own name. A blend
 * with no components stays under its own name.
 */
export function cumulativeExposure(
  entries: readonly DoseHistoryEntry[],
  blends: readonly BlendCompositionRef[] = []
): ExposureRow[] {
  const composition = new Map(
    blends
      .filter((blend) => blend.components.length > 0)
      .map((blend) => [blend.blend_medication_id, blend.components])
  );
  const rows = new Map<
    string,
    {
      row: ExposureRow;
      total: Decimal;
      via: Decimal;
      sources: BlendSource[];
      names: Map<string, number>;
    }
  >();
  const slotFor = (
    key: string,
    medication_id: string | null,
    name: string,
    date: string
  ) => {
    let slot = rows.get(key);
    if (!slot) {
      slot = {
        row: {
          medication_id,
          name,
          doses: 0,
          total_mg: '0',
          via_blends_mg: '0',
          derived_source: null,
          first_date: date,
          last_date: date,
        },
        total: new D(0),
        via: new D(0),
        sources: [],
        names: new Map(),
      };
      rows.set(key, slot);
    }
    if (date < slot.row.first_date) slot.row.first_date = date;
    if (date > slot.row.last_date) slot.row.last_date = date;
    return slot;
  };
  for (const entry of entries) {
    if (!TAKEN.has(entry.status)) continue;
    const mg = doseAsMg(entry.dose_amount_snapshot, entry.dose_unit_snapshot);
    if (mg === null) continue;
    const components =
      entry.medication_id === null
        ? undefined
        : composition.get(entry.medication_id);
    if (components) {
      const blendSource = weakestBlendSource(components);
      for (const part of expandBlendDose(mg, components)) {
        const slot = slotFor(
          part.component_medication_id,
          part.component_medication_id,
          part.name,
          entry.entry_date
        );
        slot.total = slot.total.plus(part.dose_mg);
        slot.via = slot.via.plus(part.dose_mg);
        slot.sources.push(blendSource);
        slot.row.doses++;
      }
      continue;
    }
    const slot = slotFor(
      entry.medication_id ?? `name:${entry.med_name_snapshot ?? ''}`,
      entry.medication_id,
      entry.med_name_snapshot ?? '',
      entry.entry_date
    );
    slot.total = slot.total.plus(mg);
    slot.row.doses++;
    if (entry.med_name_snapshot)
      slot.names.set(
        entry.med_name_snapshot,
        (slot.names.get(entry.med_name_snapshot) ?? 0) + 1
      );
  }
  return [...rows.values()]
    .map(({ row, total, via, sources, names }) => ({
      ...row,
      // The most-used snapshot name, so a rename does not split one medication into two rows.
      name:
        [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.name,
      total_mg: total.toString(),
      via_blends_mg: via.toString(),
      derived_source: sources.length
        ? weakestBlendSource(sources.map((source) => ({ source })))
        : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
