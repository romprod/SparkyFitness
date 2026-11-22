import type { LifeEventKind } from '../schemas/api/LifeEvents.api.zod.ts';
import { daysInRange } from './timezone.ts';

/**
 * Illness, travel and other windows. A window is context for a chart, never an explanation of a
 * change: these helpers only place windows on a range of days and count the days they cover.
 * Days are 'YYYY-MM-DD' and both ends of a window are included.
 */
export interface LifeEventWindow {
  id: string;
  kind: LifeEventKind;
  start_day: string;
  end_day: string;
  label: string | null;
}

/** True when the day lies inside any window. ISO day strings compare in order as text. */
export function isLifeEventDay(
  events: readonly LifeEventWindow[],
  day: string
): boolean {
  return events.some((e) => e.start_day <= day && day <= e.end_day);
}

export interface LifeEventDayCounts {
  illness: number;
  travel: number;
  other: number;
  /** Days inside a window of any kind; a day inside two windows counts once. */
  any: number;
}

/**
 * Days from `fromDay` to `toDay`, both included, that fall inside a window, per kind. A day
 * inside two windows of one kind counts once for that kind.
 */
export function lifeEventDayCounts(
  events: readonly LifeEventWindow[],
  fromDay: string,
  toDay: string
): LifeEventDayCounts {
  const out: LifeEventDayCounts = { illness: 0, travel: 0, other: 0, any: 0 };
  if (events.length === 0 || toDay < fromDay) return out;
  for (const day of daysInRange(fromDay, toDay)) {
    const kinds = new Set<LifeEventKind>();
    for (const e of events)
      if (e.start_day <= day && day <= e.end_day) kinds.add(e.kind);
    for (const kind of kinds) out[kind] += 1;
    if (kinds.size > 0) out.any += 1;
  }
  return out;
}

export interface LifeEventShade {
  id: string;
  kind: LifeEventKind;
  label: string | null;
  /** The part of the window inside the range. */
  from_day: string;
  to_day: string;
}

/** The windows that overlap the range, cut to it, oldest first; a window outside it is left out. */
export function lifeEventShades(
  events: readonly LifeEventWindow[],
  fromDay: string,
  toDay: string
): LifeEventShade[] {
  return events
    .filter((e) => e.end_day >= fromDay && e.start_day <= toDay)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      from_day: e.start_day > fromDay ? e.start_day : fromDay,
      to_day: e.end_day < toDay ? e.end_day : toDay,
    }))
    .sort(
      (a, b) => a.from_day.localeCompare(b.from_day) || a.id.localeCompare(b.id)
    );
}
