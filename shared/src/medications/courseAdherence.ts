import type { MedicationCourse } from '../schemas/api/MedicationCourses.api.zod.ts';
import { addDays, dayToUtcRange } from '../utils/timezone.ts';
import {
  courseSlotsForDay,
  type CourseDeliveredDose,
  type CourseExpectedSlot,
} from './courseSchedules.ts';

/** Managed matching is explicit. A medication match, injection or legacy rule is never enough. */
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
  const scored = all.map((slot, index): CourseScoredSlot => {
    const matches = input.entries.filter(
      (entry) => !consumed.has(entry.id) && courseEntryMatchesSlot(entry, slot)
    );
    const skip = matches.find((entry) => entry.status === 'skipped');
    if (skip) {
      consumed.add(skip.id);
      return { ...slot, status: 'skipped', entry_id: skip.id };
    }
    const taken = matches.find(
      (entry) => entry.status === 'taken' || entry.status === 'prn_taken'
    );
    if (taken) {
      consumed.add(taken.id);
      return { ...slot, status: 'taken', entry_id: taken.id };
    }
    const next = all[index + 1];
    return {
      ...slot,
      status: next && start(next) <= now ? 'missed' : 'pending',
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
