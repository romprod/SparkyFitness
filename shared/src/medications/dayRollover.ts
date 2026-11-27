import {
  addDays,
  instantHourMinute,
  instantToDay,
  localDateTimeToUtc,
} from '../utils/timezone.ts';

/**
 * Hours after local midnight in which the Today page offers a way back to
 * yesterday's page. Sparky still changes day at midnight; this only drives a
 * prompt, never how doses, schedules or adherence are worked out.
 */
export const DAY_ROLLOVER_GRACE_HOURS = 2;

export interface AfterMidnightGrace {
  /** True while the wall-clock hour in the zone is before DAY_ROLLOVER_GRACE_HOURS. */
  active: boolean;
  /** The calendar day (YYYY-MM-DD) in the zone. */
  today: string;
  /** The day before `today`. */
  yesterday: string;
  /** The instant the grace ends (02:00 local today) while active, else null. */
  endsAt: Date | null;
}

/** The instant of 02:00 local on `day`. When clocks skip that time, this is the first real instant after it. */
function graceEnd(day: string, tz: string): Date {
  const hh = String(DAY_ROLLOVER_GRACE_HOURS).padStart(2, '0');
  return localDateTimeToUtc(`${day}T${hh}:00`, tz);
}

/**
 * Whether `now` falls in the first two wall-clock hours of a day in `timezone`.
 * On a night the clocks go back the repeated hour is counted by wall clock, so
 * the grace then lasts three real hours; on a night they go forward it ends at
 * the first real instant at or after 02:00.
 */
export function afterMidnightGrace(
  now: Date,
  timezone: string
): AfterMidnightGrace {
  const today = instantToDay(now, timezone);
  const yesterday = addDays(today, -1);
  const { hour } = instantHourMinute(now, timezone);
  const active = hour < DAY_ROLLOVER_GRACE_HOURS;
  return {
    active,
    today,
    yesterday,
    endsAt: active ? graceEnd(today, timezone) : null,
  };
}

/**
 * The next instant the grace state can change: the end of the grace while it
 * is active, otherwise the start of the next local day.
 */
export function nextGraceBoundary(now: Date, timezone: string): Date {
  const grace = afterMidnightGrace(now, timezone);
  if (grace.endsAt) return grace.endsAt;
  return localDateTimeToUtc(`${addDays(grace.today, 1)}T00:00`, timezone);
}
