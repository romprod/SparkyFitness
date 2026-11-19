import { addDays, dayOfWeek } from '../utils/timezone.ts';
import { isScheduleDueOnDate, type SharedScheduleRule } from './schedules.ts';

/**
 * Moving a plain schedule after an off-day dose, or to even out a week.
 *
 * A move never edits history: the current rule is ended on a given day and a copy with the new
 * weekdays (or a new count-from date) starts the day after, so every earlier day is still judged
 * by the rule that was in force. Pure: these functions only propose; the person confirms and the
 * server applies the change in one transaction.
 */

export type MovableSchedule = SharedScheduleRule & { id: string };

/** A dose logged more than this many days ago is no longer offered a move. */
export const LATE_DOSE_WINDOW_DAYS = 2;
/** The planned day a dose is matched to is at most this many days away. */
const NEAREST_DAYS = 3;

export type ScheduleMoveKind = 'weekly' | 'interval';

export interface ScheduleMovePlan {
  kind: ScheduleMoveKind;
  schedule_ids: string[];
  /** The last day the current rule stays in force. */
  end_date: string;
  /** The first day of the moved rule. */
  new_start_date: string;
  /** Weekly: how many days later every weekday moves (1-6). Null for an interval roll. */
  rotate_days: number | null;
  from_days: number[];
  to_days: number[];
  /** Interval: the cadence the dose day now counts from. */
  interval_days: number | null;
  /** The first day the moved rule is due. */
  next_day: string;
}

export interface LateDoseMove extends ScheduleMovePlan {
  /** The day the off-pattern dose was taken. */
  dose_day: string;
  /** Weekly: the planned day the dose stands in for. Null for an interval roll. */
  planned_day: string | null;
  /** Weekly: days the dose day is after the planned day (negative when early). */
  offset_days: number;
}

/** Weekdays (0 Sunday to 6 Saturday) moved `by` days later, sorted and unique. */
export function rotateWeekdays(days: readonly number[], by: number): number[] {
  const shift = ((by % 7) + 7) % 7;
  return [...new Set(days.map((day) => (day + shift) % 7))].sort(
    (a, b) => a - b
  );
}

export function scheduleMoveKind(
  rule: Pick<
    SharedScheduleRule,
    'schedule_type_id' | 'days_of_week' | 'interval_days'
  >
): ScheduleMoveKind | null {
  if (
    (rule.schedule_type_id === 'weekly' ||
      rule.schedule_type_id === 'specific_days') &&
    (rule.days_of_week?.length ?? 0) > 0
  )
    return 'weekly';
  if (
    rule.schedule_type_id === 'every_n_days' &&
    rule.interval_days !== null &&
    rule.interval_days !== undefined &&
    rule.interval_days > 1
  )
    return 'interval';
  return null;
}

function firstDueFrom(
  start: string,
  days: readonly number[],
  end: string | null | undefined
): string | null {
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    if (end && day > end) return null;
    if (days.includes(dayOfWeek(day))) return day;
  }
  return null;
}

/**
 * A dose logged off its schedule's pattern, and the move that would put the schedule back in step
 * with it: weekly days rotate onto the day taken, or an every-N-days schedule counts N days on from
 * it. Only the single live rule of a medication qualifies (several rules for one medication leave
 * the intent ambiguous), only the latest dose, only within a couple of days, and never twice for
 * the same dose.
 */
export function lateDoseMove(input: {
  schedules: readonly MovableSchedule[];
  /** Days a dose was recorded as taken for this medication (any age). */
  takenDays: readonly string[];
  today: string;
}): LateDoseMove | null {
  const { today } = input;
  const live = input.schedules.filter(
    (rule) =>
      rule.active !== false &&
      rule.schedule_type_id !== 'prn' &&
      (!rule.end_date || rule.end_date >= today)
  );
  if (live.length !== 1) return null;
  const rule = live[0]!;
  const kind = scheduleMoveKind(rule);
  if (!kind) return null;

  const earliest = addDays(today, -LATE_DOSE_WINDOW_DAYS);
  const doseDay = input.takenDays
    .filter((day) => day >= earliest && day <= today)
    .sort()
    .pop();
  if (!doseDay) return null;
  // A moved rule starts after the dose it was moved for, so a dose already acted on is never
  // offered again: the rule now in force begins later than that dose.
  if (rule.start_date && doseDay < rule.start_date) return null;
  if (isScheduleDueOnDate(rule, doseDay)) return null;

  const newStart = addDays(doseDay, 1);
  if (kind === 'interval') {
    // An interval is counted from its start date; without one there is no pattern to be off.
    if (!rule.start_date) return null;
    const interval = rule.interval_days!;
    const next = addDays(doseDay, interval);
    if (rule.end_date && rule.end_date < next) return null;
    return {
      kind,
      schedule_ids: [rule.id],
      end_date: doseDay,
      new_start_date: next,
      rotate_days: null,
      from_days: [],
      to_days: [],
      interval_days: interval,
      next_day: next,
      dose_day: doseDay,
      planned_day: null,
      offset_days: 0,
    };
  }

  const planned = new Set(rule.days_of_week);
  const taken = new Set(input.takenDays);
  let standsIn: string | null = null;
  let shift = 0;
  // Nearest planned day that has no dose of its own; a tie goes to the earlier day (a late dose).
  search: for (let distance = 1; distance <= NEAREST_DAYS; distance++)
    for (const sign of [-1, 1]) {
      const day = addDays(doseDay, sign * distance);
      if (planned.has(dayOfWeek(day)) && !taken.has(day)) {
        standsIn = day;
        shift = -sign * distance;
        break search;
      }
    }
  if (!standsIn) return null;
  const from = [...new Set(rule.days_of_week)].sort((a, b) => a - b);
  const to = rotateWeekdays(from, shift);
  const next = firstDueFrom(newStart, to, rule.end_date);
  if (!next) return null;
  return {
    kind,
    schedule_ids: [rule.id],
    end_date: doseDay,
    new_start_date: newStart,
    rotate_days: ((shift % 7) + 7) % 7,
    from_days: from,
    to_days: to,
    interval_days: null,
    next_day: next,
    dose_day: doseDay,
    planned_day: standsIn,
    offset_days: shift,
  };
}

/**
 * Rotating every weekly rule of one medication `shift` days later from `from` (a Monday in
 * practice). Every live rule must be a weekly pattern; otherwise there is no single rotation.
 */
export function weekRotationMove(input: {
  schedules: readonly MovableSchedule[];
  shift: number;
  from: string;
}): ScheduleMovePlan | null {
  const live = input.schedules.filter(
    (rule) =>
      rule.active !== false &&
      rule.schedule_type_id !== 'prn' &&
      (!rule.end_date || rule.end_date >= input.from)
  );
  const shift = ((input.shift % 7) + 7) % 7;
  if (live.length === 0 || shift === 0) return null;
  if (live.some((rule) => scheduleMoveKind(rule) !== 'weekly')) return null;
  if (live.some((rule) => rule.start_date && rule.start_date >= input.from))
    return null;
  const from = [
    ...new Set(live.flatMap((rule) => rule.days_of_week ?? [])),
  ].sort((a, b) => a - b);
  const to = rotateWeekdays(from, shift);
  const next = firstDueFrom(input.from, to, null);
  if (!next) return null;
  return {
    kind: 'weekly',
    schedule_ids: live.map((rule) => rule.id),
    end_date: addDays(input.from, -1),
    new_start_date: input.from,
    rotate_days: shift,
    from_days: from,
    to_days: to,
    interval_days: null,
    next_day: next,
  };
}
