import type { MedicationLogWeekResponse } from '../schemas/api/MedicationLogWeek.api.zod.ts';
import {
  DEFAULT_DOSE_REMINDER_SETTINGS,
  type DoseReminderSettings,
} from '../schemas/api/MedicationReminders.api.zod.ts';
import { daysBetween, localDateTimeToUtc } from '../utils/timezone.ts';
import { courseCycleAlert, type CourseCycleAlertInput } from './cycleAlert.ts';

/**
 * Dose reminder planning: pure, no I/O.
 *
 * The scheduler ticks every few minutes. Each tick reads the owner's dose
 * calendar for the current week (the same source as the Dose calendar) and asks
 * this module which notifications are due now. A notification is due when its
 * moment falls between REMINDER_GRACE_MINUTES ago and REMINDER_LEAD_MINUTES
 * ahead, so a tick at least every REMINDER_GRACE_MINUTES can never skip one.
 *
 * - DUE: one per local clock time. Everything still unlogged at that time
 *   arrives together ("09:00 · Omega 3, Magnesium"). Timed slots use their
 *   own time; slots without a time use settings.untimed_time.
 * - CATCH-UP: one at settings.nag_time, listing doses whose moment has passed
 *   and that are still unlogged. Skipped when nothing is pending.
 *
 * Exactly-once delivery is the caller's job: `key` is unique within the
 * owner's local day. Notifications never carry dose amounts.
 */

export const REMINDER_GRACE_MINUTES = 30;
export const REMINDER_LEAD_MINUTES = 5;

export interface DoseReminderEvent {
  /** Unique within (owner, local day): "due@HH:MM" or "catch-up". */
  key: string;
  title: string;
  body: string;
  /** Notification tag: a newer notification with the same tag replaces the old one. */
  tag: string;
  /** App path opened when the notification is tapped. */
  url: string;
}

export interface DoseReminderPlan {
  /** The owner's local day the keys belong to. */
  day: string;
  events: DoseReminderEvent[];
}

interface DueItem {
  name: string;
  moment: number;
  clock: string;
}

const clockIn = (instant: number, timezone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));

const list = (names: string[]): string => {
  const unique = [...new Set(names)];
  return unique.length <= 4
    ? unique.join(', ')
    : `${unique.slice(0, 4).join(', ')} and ${unique.length - 4} more`;
};

/** Today's unlogged dose slots with the moment each one reminds. */
export function unloggedDosesToday(
  week: MedicationLogWeekResponse,
  settings: DoseReminderSettings = DEFAULT_DOSE_REMINDER_SETTINGS
): DueItem[] {
  const lanes = new Map(week.lanes.map((lane) => [lane.id, lane]));
  const fulfilled = new Set(week.fulfilled_slots.map((row) => row.planned_id));
  const untimed = localDateTimeToUtc(
    `${week.today}T${settings.untimed_time}`,
    week.timezone
  ).getTime();
  const items: DueItem[] = [];
  for (const slot of week.planned_slots) {
    if (slot.scheduled_day !== week.today) continue;
    if (slot.status === 'taken' || slot.status === 'skipped') continue;
    if (fulfilled.has(slot.id)) continue;
    const lane = lanes.get(slot.lane_id);
    if (!lane) continue;
    if (lane.is_supplement === true && !settings.include_supplements) continue;
    const timed =
      slot.time_of_day !== null && slot.scheduled_for !== null
        ? Date.parse(slot.scheduled_for)
        : NaN;
    const moment = Number.isFinite(timed) ? timed : untimed;
    items.push({
      name: lane.name || 'A medication',
      moment,
      clock: clockIn(moment, week.timezone),
    });
  }
  return items.sort(
    (a, b) => a.moment - b.moment || a.name.localeCompare(b.name)
  );
}

export function planDoseReminders(
  week: MedicationLogWeekResponse,
  now: Date,
  settings: DoseReminderSettings = DEFAULT_DOSE_REMINDER_SETTINGS
): DoseReminderPlan {
  const at = now.getTime();
  const lower = at - REMINDER_GRACE_MINUTES * 60_000;
  const upper = at + REMINDER_LEAD_MINUTES * 60_000;
  const inWindow = (moment: number) => moment >= lower && moment <= upper;
  const items = unloggedDosesToday(week, settings);
  const events: DoseReminderEvent[] = [];

  const byClock = new Map<string, DueItem[]>();
  for (const item of items) {
    if (!inWindow(item.moment)) continue;
    byClock.set(item.clock, [...(byClock.get(item.clock) ?? []), item]);
  }
  for (const [clock, group] of byClock) {
    const names = group.map((item) => item.name);
    const count = new Set(names).size;
    events.push({
      key: `due@${clock}`,
      title: count === 1 ? `${names[0]} is due` : `${count} doses are due`,
      body: `${clock} · ${list(names)}`,
      tag: `sparky-dose-${clock}`,
      url: '/medications',
    });
  }

  if (settings.nag_enabled) {
    const nag = localDateTimeToUtc(
      `${week.today}T${settings.nag_time}`,
      week.timezone
    ).getTime();
    if (inWindow(nag)) {
      // Pending means its moment has passed by delivery time, not by the anchor.
      const pending = items.filter((item) => item.moment <= at);
      if (pending.length > 0) {
        const names = pending.map((item) => item.name);
        const count = new Set(names).size;
        events.push({
          key: 'catch-up',
          title:
            count === 1
              ? '1 dose still to log today'
              : `${count} doses still to log today`,
          body: list(names),
          tag: 'sparky-dose-catch-up',
          url: '/medications',
        });
      }
    }
  }
  return { day: week.today, events };
}

/**
 * Days left before a planned stop or restart on which a countdown earns a push. Deliberately
 * sparse, as Pitstop's: the banner is always on, a notification is an interruption, so a
 * countdown interrupts twice before the day itself.
 */
export const CYCLE_PUSH_AT_DAYS: readonly number[] = [7, 3];

/** A course on a weekly on/off plan, with its cycle state as the server reads it. */
export interface CycleReminderCourse {
  course_id: string;
  name: string;
  cycle: CourseCycleAlertInput;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
/** "29 Aug" from 'YYYY-MM-DD', on a fixed month table so it reads the same on every runtime. */
const dayLabel = (day: string | null): string => {
  const [, month, date] = (day ?? '').split('-').map(Number);
  return month && date ? `${date} ${MONTHS[month - 1]}` : '';
};

/**
 * The push a course's cycle earns today, or none. Boundary days always fire (the last dose, the
 * first day after a finished run, the restart day); a countdown fires only at CYCLE_PUSH_AT_DAYS.
 * Text never carries a dose amount, and nothing here ends or starts a cycle.
 */
export function cycleReminderEvent(
  course: CycleReminderCourse
): DoseReminderEvent | null {
  const alert = courseCycleAlert(course.cycle);
  if (!alert) return null;
  const date = dayLabel(alert.date);
  const make = (title: string, body: string): DoseReminderEvent => ({
    key: `cycle:${course.course_id}:${alert.kind}`,
    title,
    body,
    tag: `sparky-cycle-${course.course_id}`,
    url: '/medications',
  });
  const name = course.name;
  switch (alert.kind) {
    case 'last_dose':
      return make(
        `${name}: last dose of the cycle`,
        `Today (${date}) is the final day of this run.`
      );
    case 'ending_soon':
      return CYCLE_PUSH_AT_DAYS.includes(alert.days)
        ? make(
            `${name}: cycle ends in ${alert.days} days`,
            `Planned last dose ${date}.`
          )
        : null;
    case 'stop_now':
      // Once, on the first day after the run; the banner carries it after that.
      return alert.date && daysBetween(alert.date, course.cycle.today) === 1
        ? make(
            `${name}: planned run is over`,
            `The run finished on ${date} but the course is still active. Open the course to end the cycle.`
          )
        : null;
    case 'restart_soon':
      return CYCLE_PUSH_AT_DAYS.includes(alert.days)
        ? make(
            `${name}: restart in ${alert.days} days`,
            `The break ends ${date}; the next cycle starts then.`
          )
        : null;
    case 'restart_now':
      // Once, on the restart day itself: the banner stays up for as long as the cycle is not started.
      return alert.date === course.cycle.today
        ? make(
            `${name}: back on today`,
            'The break is over. Open the course to start the next cycle.'
          )
        : null;
    default:
      return null;
  }
}

/**
 * Cycle prompts are day-grain: there is no dose time to anchor them to. They ride the same moment
 * as doses with no time (settings.untimed_time), so they go out in the morning rather than on the
 * first tick after midnight. True when that moment is within the reminder window.
 */
export function isCycleReminderTime(input: {
  day: string;
  timezone: string;
  now: Date;
  settings?: DoseReminderSettings;
}): boolean {
  const settings = input.settings ?? DEFAULT_DOSE_REMINDER_SETTINGS;
  const moment = localDateTimeToUtc(
    `${input.day}T${settings.untimed_time}`,
    input.timezone
  ).getTime();
  const at = input.now.getTime();
  return (
    moment >= at - REMINDER_GRACE_MINUTES * 60_000 &&
    moment <= at + REMINDER_LEAD_MINUTES * 60_000
  );
}

/** The cycle pushes due now, one at most per course; none outside the morning window. */
export function planCycleReminders(input: {
  courses: readonly CycleReminderCourse[];
  day: string;
  timezone: string;
  now: Date;
  settings?: DoseReminderSettings;
}): DoseReminderEvent[] {
  if (!isCycleReminderTime(input)) return [];
  return input.courses.flatMap((course) => {
    const event = cycleReminderEvent(course);
    return event ? [event] : [];
  });
}
