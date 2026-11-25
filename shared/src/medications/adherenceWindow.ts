import { daysBetween } from '../utils/timezone.ts';

/** The trailing window the per-medicine adherence figure covers, today included. */
export const ADHERENCE_WINDOW_DAYS = 90;

/** Doses taken out of taken plus missed; `pct` is null when none was scored. */
export interface AdherenceFigure {
  pct: number | null;
  taken: number;
  missed: number;
  /** Calendar days from the earliest to the latest day with a taken or missed dose, inclusive. */
  days_of_data: number;
}

export interface MedicationAdherenceRow extends AdherenceFigure {
  medication_id: string;
  name: string;
}

export interface MedicationAdherenceWindow {
  today: string;
  from_day: string;
  to_day: string;
  overall: AdherenceFigure;
  medications: MedicationAdherenceRow[];
}

/**
 * Adherence over scored days. Skipped and not-yet-due doses are never passed in. The same date may
 * appear several times (one entry per plan); counts add up. Pure.
 */
export function adherenceFigure(
  days: ReadonlyArray<{ date: string; taken: number; missed: number }>
): AdherenceFigure {
  let taken = 0;
  let missed = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const day of days) {
    if (day.taken + day.missed <= 0) continue;
    taken += day.taken;
    missed += day.missed;
    if (first === null || day.date < first) first = day.date;
    if (last === null || day.date > last) last = day.date;
  }
  const scored = taken + missed;
  return {
    pct: scored > 0 ? Math.round((taken / scored) * 100) : null,
    taken,
    missed,
    days_of_data:
      first !== null && last !== null ? daysBetween(first, last) + 1 : 0,
  };
}
