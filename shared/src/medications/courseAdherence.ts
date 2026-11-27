import type { MedicationCourse } from '../schemas/api/MedicationCourses.api.zod.ts';
import { addDays, dayToUtcRange } from '../utils/timezone.ts';
import {
  courseSlotsForDay,
  type CourseDeliveredDose,
  type CourseExpectedSlot,
} from './courseSchedules.ts';

/**
 * Exact managed matching is explicit: a medication match, injection or legacy
 * rule is never enough. The only other way a dose fills a slot is the narrow
 * same-day fallback in `courseUnlinkedSlotMatches`, which runs after this.
 */
export function courseEntryMatchesSlot(
  entry: Pick<
    CourseDeliveredDose,
    | 'course_revision_id'
    | 'course_rule_id'
    | 'course_slot_key'
    | 'scheduled_day'
  >,
  slot: Pick<
    CourseExpectedSlot,
    | 'course_revision_id'
    | 'course_rule_id'
    | 'course_slot_key'
    | 'scheduled_day'
  >
): boolean {
  return (
    entry.course_revision_id === slot.course_revision_id &&
    entry.course_rule_id === slot.course_rule_id &&
    entry.course_slot_key === slot.course_slot_key &&
    entry.scheduled_day === slot.scheduled_day
  );
}

type UnlinkedEntry = Pick<
  CourseDeliveredDose,
  | 'id'
  | 'status'
  | 'course_revision_id'
  | 'course_rule_id'
  | 'course_slot_key'
  | 'scheduled_day'
  | 'entry_date'
  | 'occurred_at'
>;
type UnlinkedSlot = Pick<
  CourseExpectedSlot,
  | 'course_revision_id'
  | 'course_rule_id'
  | 'course_slot_key'
  | 'scheduled_day'
  | 'scheduled_for'
>;

/**
 * Mirrors Pitstop linking a logged dose to the nearest planned dose on its
 * day. Run after the exact pass, with only the slots still open and the
 * entries not yet used. A taken or skipped dose that carries the course
 * revision but no slot link fills the open slot on its own day whose time is
 * nearest its own (ties go to the earlier slot). Never crosses days; each
 * entry fills at most one slot and each slot takes at most one entry.
 * Returns slot key -> entry.
 */
export function courseUnlinkedSlotMatches<
  S extends UnlinkedSlot,
  E extends UnlinkedEntry,
>(input: { slots: S[]; entries: E[]; timezone: string }): Map<string, E> {
  const { timezone } = input;
  const slotTime = (slot: S) =>
    slot.scheduled_for === null || slot.scheduled_for === undefined
      ? dayToUtcRange(slot.scheduled_day, timezone).start.getTime()
      : Date.parse(slot.scheduled_for);
  const entryTime = (entry: E) =>
    entry.occurred_at
      ? Date.parse(entry.occurred_at)
      : dayToUtcRange(entry.entry_date.slice(0, 10), timezone).start.getTime();
  const result = new Map<string, E>();
  const eligible = input.entries
    .filter(
      (entry) =>
        (entry.status === 'taken' || entry.status === 'skipped') &&
        !entry.course_slot_key &&
        !entry.scheduled_day &&
        entry.course_revision_id !== null &&
        entry.course_revision_id !== undefined
    )
    .map((entry) => ({ entry, at: entryTime(entry) }))
    .sort((a, b) => a.at - b.at || a.entry.id.localeCompare(b.entry.id));
  for (const { entry, at } of eligible) {
    const day = entry.entry_date.slice(0, 10);
    let best: { slot: S; time: number } | null = null;
    for (const slot of input.slots) {
      if (
        result.has(slot.course_slot_key) ||
        slot.scheduled_day !== day ||
        slot.course_revision_id !== entry.course_revision_id ||
        (entry.course_rule_id && entry.course_rule_id !== slot.course_rule_id)
      )
        continue;
      const time = slotTime(slot);
      if (
        !best ||
        Math.abs(time - at) < Math.abs(best.time - at) ||
        (Math.abs(time - at) === Math.abs(best.time - at) &&
          (time < best.time ||
            (time === best.time &&
              slot.course_slot_key.localeCompare(best.slot.course_slot_key) <
                0)))
      )
        best = { slot, time };
    }
    if (best) result.set(best.slot.course_slot_key, entry);
  }
  return result;
}

export type CourseSlotStatus = 'taken' | 'missed' | 'pending' | 'skipped';
export interface CourseScoredSlot extends CourseExpectedSlot {
  status: CourseSlotStatus;
  entry_id: string | null;
}
export interface CourseAdherenceDay {
  date: string;
  coverage: 'unavailable' | 'partial' | 'available';
  taken: number;
  missed: number;
  pending: number;
  skipped: number;
  slots: CourseScoredSlot[];
}
export interface CourseAdherenceSummary {
  captured_at: string;
  taken: number;
  missed: number;
  pending: number;
  skipped: number;
  /** Source course denominator excludes pending and skipped; null means no scored observations. */
  pct: number | null;
  days: CourseAdherenceDay[];
}
export function computeCourseAdherence(input: {
  course: MedicationCourse;
  entries: CourseDeliveredDose[];
  phaseEntries?: CourseDeliveredDose[];
  fromDay: string;
  toDay: string;
  today: string;
  now: string;
  medicationActive: boolean;
}): CourseAdherenceSummary {
  const { course } = input;
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || input.fromDay > input.toDay)
    throw new RangeError('Invalid adherence range');
  // Expand through today so a historical window's final slot still sees its
  // next real expected slot. No future projected deliveries advance any phase.
  const through = input.toDay > input.today ? input.toDay : input.today;
  const all: CourseExpectedSlot[] = [];
  for (let day = input.fromDay; day <= through; day = addDays(day, 1))
    all.push(
      ...courseSlotsForDay({
        course,
        day,
        today: input.today,
        nowInstant: input.now,
        medicationActive: input.medicationActive,
        delivered: input.entries,
        phaseDelivered: input.phaseEntries,
      })
    );
  const start = (slot: CourseExpectedSlot) =>
    slot.scheduled_for === null
      ? dayToUtcRange(slot.scheduled_day, course.timezone).start.getTime()
      : Date.parse(slot.scheduled_for);
  all.sort(
    (a, b) =>
      start(a) - start(b) || a.course_slot_key.localeCompare(b.course_slot_key)
  );
  const consumed = new Set<string>();
  const exact = new Map<string, CourseScoredSlot>();
  for (const slot of all) {
    const matches = input.entries.filter(
      (entry) => !consumed.has(entry.id) && courseEntryMatchesSlot(entry, slot)
    );
    const skip = matches.find((entry) => entry.status === 'skipped');
    if (skip) {
      consumed.add(skip.id);
      exact.set(slot.course_slot_key, {
        ...slot,
        status: 'skipped',
        entry_id: skip.id,
      });
      continue;
    }
    const taken = matches.find(
      (entry) => entry.status === 'taken' || entry.status === 'prn_taken'
    );
    if (taken) {
      consumed.add(taken.id);
      exact.set(slot.course_slot_key, {
        ...slot,
        status: 'taken',
        entry_id: taken.id,
      });
    }
  }
  const fallback = courseUnlinkedSlotMatches({
    slots: all.filter((slot) => !exact.has(slot.course_slot_key)),
    entries: input.entries.filter((entry) => !consumed.has(entry.id)),
    timezone: course.timezone,
  });
  const scored = all.map((slot, index): CourseScoredSlot => {
    const hit = exact.get(slot.course_slot_key);
    if (hit) return hit;
    const loose = fallback.get(slot.course_slot_key);
    if (loose)
      return {
        ...slot,
        status: loose.status === 'skipped' ? 'skipped' : 'taken',
        entry_id: loose.id,
      };
    const next = all[index + 1];
    const dayOver =
      dayToUtcRange(slot.scheduled_day, course.timezone).end.getTime() <= now;
    return {
      ...slot,
      status: (next && start(next) <= now) || dayOver ? 'missed' : 'pending',
      entry_id: null,
    };
  });
  const days: CourseAdherenceDay[] = [];
  for (let day = input.fromDay; day <= input.toDay; day = addDays(day, 1)) {
    const range = dayToUtcRange(day, course.timezone),
      baseline = Date.parse(course.captured_at);
    const slots = scored.filter((slot) => slot.scheduled_day === day);
    days.push({
      date: day,
      coverage:
        range.end.getTime() <= baseline
          ? 'unavailable'
          : range.start.getTime() < baseline
            ? 'partial'
            : 'available',
      taken: slots.filter((slot) => slot.status === 'taken').length,
      missed: slots.filter((slot) => slot.status === 'missed').length,
      pending: slots.filter((slot) => slot.status === 'pending').length,
      skipped: slots.filter((slot) => slot.status === 'skipped').length,
      slots,
    });
  }
  const sum = (key: 'taken' | 'missed' | 'pending' | 'skipped') =>
    days.reduce((total, day) => total + day[key], 0);
  const taken = sum('taken'),
    missed = sum('missed');
  return {
    captured_at: course.captured_at,
    taken,
    missed,
    pending: sum('pending'),
    skipped: sum('skipped'),
    pct:
      taken + missed > 0 ? Math.round((taken / (taken + missed)) * 100) : null,
    days,
  };
}
