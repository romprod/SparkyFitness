/**
 * Per-medication dosing guardrails kept in the medication's custom fields: a minimum gap between
 * doses and what to do with a dose that has been missed. Both only advise; nothing here records
 * or skips a dose on its own.
 */

export type MissedDosePolicy = 'prompt' | 'skip' | 'take_now';

export const MISSED_DOSE_POLICIES: readonly MissedDosePolicy[] = [
  'prompt',
  'skip',
  'take_now',
];
/** Longest minimum interval accepted: eight days, so a week of entries is always enough to check. */
export const MAX_MIN_INTERVAL_HOURS = 192;

export interface DosePolicy {
  min_interval_hours: number | null;
  missed_policy: MissedDosePolicy;
}

export function readDosePolicy(customFields: unknown): DosePolicy {
  const fields =
    customFields && typeof customFields === 'object'
      ? (customFields as Record<string, unknown>)
      : {};
  const hours = Number(fields['min_interval_hours']);
  const policy = fields['missed_policy'];
  return {
    min_interval_hours:
      Number.isFinite(hours) && hours > 0
        ? Math.min(hours, MAX_MIN_INTERVAL_HOURS)
        : null,
    missed_policy: MISSED_DOSE_POLICIES.includes(policy as MissedDosePolicy)
      ? (policy as MissedDosePolicy)
      : 'prompt',
  };
}

/** Longest default beyond-use window accepted, in days. */
export const MAX_DEFAULT_BUD_DAYS = 365;

/**
 * The beyond-use days the person chose for a medication, to prefill a new preparation. Their own
 * figure, never an assumed one; the preparation still records its own source.
 */
export function readDefaultBudDays(customFields: unknown): number | null {
  const fields =
    customFields && typeof customFields === 'object'
      ? (customFields as Record<string, unknown>)
      : {};
  const days = Math.floor(Number(fields['default_bud_days']));
  return Number.isFinite(days) && days > 0
    ? Math.min(days, MAX_DEFAULT_BUD_DAYS)
    : null;
}

export interface IntervalWarning {
  hours_since: number;
  min_hours: number;
  /** When the minimum interval is up (ISO). */
  ok_at: string;
}

/** A dose taken sooner than the minimum interval after the latest taken dose before `now`. */
export function intervalWarning(input: {
  takenAt: readonly string[];
  minHours: number | null;
  now: Date;
}): IntervalWarning | null {
  if (!input.minHours || input.minHours <= 0) return null;
  const nowMs = input.now.getTime();
  let latest = -Infinity;
  for (const iso of input.takenAt) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms <= nowMs && ms > latest) latest = ms;
  }
  if (latest === -Infinity) return null;
  const hours = (nowMs - latest) / 3_600_000;
  if (hours >= input.minHours) return null;
  return {
    hours_since: Math.round(hours * 10) / 10,
    min_hours: input.minHours,
    ok_at: new Date(latest + input.minHours * 3_600_000).toISOString(),
  };
}

/** Whole hours a planned dose is overdue, or null when it is not yet due. */
export function overdueHours(scheduledFor: string | null, now: Date) {
  if (!scheduledFor) return null;
  const ms = Date.parse(scheduledFor);
  if (!Number.isFinite(ms) || ms >= now.getTime()) return null;
  return Math.floor((now.getTime() - ms) / 3_600_000);
}
