import { resolveGlp1Profile, serumLevelAt, type DoseEvent } from './glp1.ts';

/**
 * Modeled levels of several medications on one chart, as Pitstop's overlay does. The model is the
 * same one-compartment curve the single-medication chart uses: an estimate from published
 * half-lives, never a measured level. Each medication is scaled to its own peak in the window,
 * because medications with different half-lives and doses cannot share one absolute axis.
 */

export interface PkProfile {
  halfLifeDays: number;
  tMaxDays: number;
}

/** A medication's modeled profile, or null when none can be resolved or its parameters are invalid. */
export function resolveMedicationPkProfile(med: {
  name: string;
  custom_fields?: Record<string, unknown> | null;
}): PkProfile | null {
  const fields = med.custom_fields ?? {};
  const drug =
    typeof fields['glp1_drug'] === 'string'
      ? (fields['glp1_drug'] as string)
      : undefined;
  const profile =
    resolveGlp1Profile(med.name) ??
    (drug ? resolveGlp1Profile(drug) : undefined) ??
    (drug === 'custom'
      ? {
          halfLifeDays: Number(fields['custom_half_life_days']) || 7,
          tMaxDays: Number(fields['custom_t_max_days']) || 1.5,
        }
      : undefined);
  if (
    !profile ||
    !Number.isFinite(profile.halfLifeDays) ||
    !(profile.halfLifeDays > 0) ||
    !Number.isFinite(profile.tMaxDays) ||
    !(profile.tMaxDays > 0)
  )
    return null;
  return { halfLifeDays: profile.halfLifeDays, tMaxDays: profile.tMaxDays };
}

export interface PkOverlayDose {
  at: Date | string;
  dose_mg: number;
}
export interface PkOverlaySeries {
  id: string;
  name: string;
  profile: PkProfile;
  /** Doses recorded as taken; those after `now` are ignored. */
  taken: readonly PkOverlayDose[];
  /** Doses planned ahead; those at or before `now` are ignored. */
  planned: readonly PkOverlayDose[];
}
export interface PkOverlayPoint {
  /** Epoch milliseconds. */
  t: number;
  /** Fraction of this medication's own peak in the window, 0 to 1. */
  level: number;
}
export interface PkOverlayLine {
  id: string;
  name: string;
  /** From the start of the window up to now, from doses taken. */
  historical: PkOverlayPoint[];
  /**
   * From now to the end of the window: doses already taken keep acting (a recent dose still rises
   * for a day or two), and planned doses are added when there are any.
   */
  forecast: PkOverlayPoint[];
  /** The modeled level now as a fraction of the window peak. */
  now_level: number;
  /** Whether the forecast includes doses planned ahead, not only doses already taken. */
  includes_planned: boolean;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const usable = (dose: PkOverlayDose): number | null => {
  const at = new Date(dose.at).getTime();
  return Number.isFinite(at) &&
    Number.isFinite(dose.dose_mg) &&
    dose.dose_mg > 0
    ? at
    : null;
};

/**
 * The lines for every series that has at least one usable dose, over `window_days` either side of
 * now. Doses taken before the window still count, since they have not cleared. A series with no
 * level in the window is left out rather than drawn flat.
 */
export function buildPkOverlay(input: {
  series: readonly PkOverlaySeries[];
  now: Date | string;
  window_days: number;
  step_hours?: number;
}): PkOverlayLine[] {
  const nowMs = new Date(input.now).getTime();
  if (!Number.isFinite(nowMs) || !(input.window_days > 0)) return [];
  const stepMs = (input.step_hours ?? 6) * HOUR_MS;
  const fromMs = nowMs - input.window_days * DAY_MS;
  const toMs = nowMs + input.window_days * DAY_MS;
  const lines: PkOverlayLine[] = [];
  for (const series of input.series) {
    const events = (doses: readonly PkOverlayDose[]): DoseEvent[] =>
      doses.flatMap((dose) => {
        const at = usable(dose);
        return at === null
          ? []
          : [{ day: (at - nowMs) / DAY_MS, doseMg: dose.dose_mg }];
      });
    const takenEvents = events(series.taken).filter((e) => e.day <= 0);
    const plannedEvents = events(series.planned).filter(
      (e) => e.day > 0 && e.day * DAY_MS <= toMs - nowMs
    );
    if (!takenEvents.length && !plannedEvents.length) continue;
    const withPlanned = [...takenEvents, ...plannedEvents];
    const times = new Set<number>([nowMs]);
    for (let t = fromMs; t <= toMs; t += stepMs) times.add(t);
    const raw = [...times]
      .sort((a, b) => a - b)
      .map((t) => ({
        t,
        level: serumLevelAt(
          (t - nowMs) / DAY_MS,
          t <= nowMs ? takenEvents : withPlanned,
          series.profile
        ),
      }));
    const peak = raw.reduce((max, point) => Math.max(max, point.level), 0);
    if (!(peak > 1e-12)) continue;
    const points = raw.map((point) => ({
      t: point.t,
      level: point.level / peak,
    }));
    lines.push({
      id: series.id,
      name: series.name,
      historical: points.filter((point) => point.t <= nowMs),
      forecast: points.filter((point) => point.t >= nowMs),
      now_level: points.find((point) => point.t === nowMs)?.level ?? 0,
      includes_planned: plannedEvents.length > 0,
    });
  }
  return lines.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}
