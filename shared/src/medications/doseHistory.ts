import { Decimal } from 'decimal.js';
import { addDays, daysBetween, dayOfWeek } from '../utils/timezone.ts';

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
  total_mg: string;
  first_date: string;
  last_date: string;
}

/**
 * All-time mass per medication from taken doses recorded in mass units. Doses in tablets,
 * millilitres or other units are left out rather than converted by guesswork.
 */
export function cumulativeExposure(
  entries: readonly DoseHistoryEntry[]
): ExposureRow[] {
  const rows = new Map<
    string,
    { row: ExposureRow; total: Decimal; names: Map<string, number> }
  >();
  for (const entry of entries) {
    if (!TAKEN.has(entry.status)) continue;
    const mg = doseAsMg(entry.dose_amount_snapshot, entry.dose_unit_snapshot);
    if (mg === null) continue;
    const key = entry.medication_id ?? `name:${entry.med_name_snapshot ?? ''}`;
    let slot = rows.get(key);
    if (!slot) {
      slot = {
        row: {
          medication_id: entry.medication_id,
          name: entry.med_name_snapshot ?? '',
          doses: 0,
          total_mg: '0',
          first_date: entry.entry_date,
          last_date: entry.entry_date,
        },
        total: new D(0),
        names: new Map(),
      };
      rows.set(key, slot);
    }
    slot.total = slot.total.plus(mg);
    slot.row.doses++;
    if (entry.entry_date < slot.row.first_date)
      slot.row.first_date = entry.entry_date;
    if (entry.entry_date > slot.row.last_date) {
      slot.row.last_date = entry.entry_date;
    }
    if (entry.med_name_snapshot)
      slot.names.set(
        entry.med_name_snapshot,
        (slot.names.get(entry.med_name_snapshot) ?? 0) + 1
      );
  }
  return [...rows.values()]
    .map(({ row, total, names }) => ({
      ...row,
      // The most-used snapshot name, so a rename does not split one medication into two rows.
      name:
        [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.name,
      total_mg: total.toString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
