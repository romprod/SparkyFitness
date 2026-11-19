import type { MedicationLogWeekResponse } from '../schemas/api/MedicationLogWeek.api.zod.ts';
import {
  DEFAULT_DOSE_REMINDER_SETTINGS,
  type DoseReminderSettings,
} from '../schemas/api/MedicationReminders.api.zod.ts';
import { localDateTimeToUtc } from '../utils/timezone.ts';

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
