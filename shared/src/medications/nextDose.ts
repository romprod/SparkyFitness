import {
  daysBetween,
  dayToUtcRange,
  instantHourMinute,
  instantToDay,
  localDateTimeToUtc,
} from '../utils/timezone.ts';

/**
 * The next planned dose per medication, and how to word when it is. Pure: it reads planned
 * slots already computed for a week and never plans, logs or changes anything.
 */

/** The part of a week calendar slot the next dose needs. */
export interface NextDoseSlot {
  id: string;
  medication_id: string | null;
  scheduled_day: string;
  scheduled_for: string | null;
  time_of_day: string | null;
  status: string;
  dose_amount: string | null;
  dose_unit: string | null;
}

export interface NextDose {
  slot_id: string;
  medication_id: string;
  scheduled_day: string;
  /** The planned instant; an untimed slot is the start of its day. */
  at: string;
  /** Local planned time as HH:MM; null for an untimed slot. */
  time: string | null;
  dose_amount: string | null;
  dose_unit: string | null;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The earliest planned slot strictly after `now` for each medication, soonest first. Only slots
 * still to come count: planned or pending, never taken, skipped or missed.
 */
export function nextDosesByMedication(input: {
  slots: readonly NextDoseSlot[];
  now: Date | string;
  timezone: string;
  /** Limit to these medications; every medication when omitted. */
  medication_ids?: ReadonlySet<string>;
}): NextDose[] {
  const now = new Date(input.now).getTime();
  const best = new Map<string, { at: number; dose: NextDose }>();
  for (const slot of input.slots) {
    if (
      slot.medication_id === null ||
      (slot.status !== 'planned' && slot.status !== 'pending') ||
      (input.medication_ids && !input.medication_ids.has(slot.medication_id))
    )
      continue;
    let at: Date | null = null;
    let time: string | null = null;
    if (slot.scheduled_for !== null) {
      at = new Date(slot.scheduled_for);
      if (Number.isFinite(at.getTime())) {
        const clock = instantHourMinute(at, input.timezone);
        time = `${pad(clock.hour)}:${pad(clock.minute)}`;
      }
    } else if (slot.time_of_day) {
      time = slot.time_of_day.slice(0, 5);
      at = new Date(
        localDateTimeToUtc(`${slot.scheduled_day}T${time}`, input.timezone)
      );
    } else at = dayToUtcRange(slot.scheduled_day, input.timezone).start;
    if (at === null || !Number.isFinite(at.getTime()) || at.getTime() <= now)
      continue;
    const known = best.get(slot.medication_id);
    if (
      known &&
      (known.at < at.getTime() ||
        (known.at === at.getTime() && known.dose.slot_id <= slot.id))
    )
      continue;
    best.set(slot.medication_id, {
      at: at.getTime(),
      dose: {
        slot_id: slot.id,
        medication_id: slot.medication_id,
        scheduled_day: slot.scheduled_day,
        at: at.toISOString(),
        time,
        dose_amount: slot.dose_amount,
        dose_unit: slot.dose_unit,
      },
    });
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        a.at - b.at || a.dose.medication_id.localeCompare(b.dose.medication_id)
    )
    .map((entry) => entry.dose);
}

export type NextDoseWhen =
  | { kind: 'overdue' }
  | { kind: 'now' }
  /** Later the same calendar day: a live countdown. */
  | { kind: 'later_today'; hours: number; minutes: number }
  | { kind: 'tomorrow' }
  /** Two to six days out: the weekday names it. */
  | { kind: 'weekday'; day: string }
  /** A week or more out: a short date, where a weekday alone would be ambiguous. */
  | { kind: 'date'; day: string };

/**
 * How to say when a dose is, as Pitstop does: only a dose later the same day counts down; a dose on
 * a later day names the day (tomorrow, the weekday, then the date). Days are the person's own.
 */
export function nextDoseWhen(
  at: Date | string,
  now: Date | string,
  timezone: string
): NextDoseWhen {
  const diffMinutes = Math.round(
    (new Date(at).getTime() - new Date(now).getTime()) / 60_000
  );
  if (diffMinutes < 0) return { kind: 'overdue' };
  if (diffMinutes === 0) return { kind: 'now' };
  const atDay = instantToDay(at, timezone);
  const dayDiff = daysBetween(instantToDay(now, timezone), atDay);
  if (dayDiff >= 7) return { kind: 'date', day: atDay };
  if (dayDiff >= 2) return { kind: 'weekday', day: atDay };
  if (dayDiff === 1) return { kind: 'tomorrow' };
  return {
    kind: 'later_today',
    hours: Math.floor(diffMinutes / 60),
    minutes: diffMinutes % 60,
  };
}
