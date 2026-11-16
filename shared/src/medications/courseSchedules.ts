import type {
  MedicationCourse,
  MedicationCourseRevision,
  MedicationCourseRule,
} from '../schemas/api/MedicationCourses.api.zod.ts';
import {
  addDays,
  dayToUtcRange,
  localDateTimeToUtc,
} from '../utils/timezone.ts';
import {
  isScheduleDueOnDate,
  type SharedMedication,
  type SharedScheduleRule,
} from './schedules.ts';
import { courseActivityContains } from './courseLifecycle.ts';
import { courseCurrentPhase, coursePerDoseAmount } from './courseRevisions.ts';

export interface CourseDeliveredDose {
  id: string;
  course_revision_id: string | null;
  course_rule_id?: string | null;
  course_step_id?: string | null;
  course_slot_key?: string | null;
  scheduled_day?: string | null;
  scheduled_for?: string | null;
  entry_date: string;
  occurred_at?: string | null;
  status: string;
}
export interface CourseExpectedSlot {
  course_id: string;
  schedule_type_id: string;
  course_revision_id: string;
  course_rule_id: string;
  course_step_id: string | null;
  course_slot_key: string;
  course_expected_version: number;
  medication_id: string | null;
  scheduled_day: string;
  time_of_day: string | null;
  scheduled_for: string | null;
  per_dose_amount: string | null;
  authored_dose: string | null;
  dose_unit: string;
  dose_basis: 'per_injection' | 'per_week';
  phase_progress_known: boolean;
}
const isDelivered = (entry: CourseDeliveredDose) =>
  entry.status === 'taken' || entry.status === 'prn_taken';
export const courseSlotKey = (
  revisionId: string,
  ruleId: string,
  day: string,
  time: string | null
): string =>
  JSON.stringify([
    revisionId,
    ruleId,
    day,
    time ? time.slice(0, 5) + (time.length > 5 ? time.slice(5) : ':00') : null,
  ]);

function ruleDue(
  revision: MedicationCourseRevision,
  rule: MedicationCourseRule,
  day: string
): boolean {
  if (revision.start_date !== null && day < revision.start_date) return false;
  if (revision.end_date !== null && day > revision.end_date) return false;
  if (revision.closed_date !== null && day > revision.closed_date) return false;
  if (rule.start_date && day < rule.start_date) return false;
  if (rule.end_date && day > rule.end_date) return false;
  const { dose_amount: _dose, ...recurrence } = rule;
  const anchor =
    rule.schedule_type_id === 'cyclic'
      ? (revision.cycle_anchor_date ??
        rule.anchor_date ??
        rule.start_date ??
        revision.start_date)
      : rule.schedule_type_id === 'every_n_days'
        ? (rule.anchor_date ?? rule.start_date ?? revision.start_date)
        : (rule.start_date ?? revision.start_date);
  return isScheduleDueOnDate(
    {
      ...recurrence,
      active: true,
      start_date: anchor,
      end_date: rule.end_date ?? null,
    },
    day
  );
}
/** Existing recurrence engine, frozen boundaries, explicit lineage and half-open instant history. */
export function courseSlotsForDay(input: {
  course: MedicationCourse;
  day: string;
  today: string;
  nowInstant: string;
  medicationActive: boolean;
  delivered?: CourseDeliveredDose[];
}): CourseExpectedSlot[] {
  const { course, day } = input;
  if (
    course.deleted_at !== null ||
    (day > input.today && !input.medicationActive)
  )
    return [];
  const range = dayToUtcRange(day, course.timezone),
    baseline = Date.parse(course.captured_at);
  if (range.end.getTime() <= baseline) return [];
  const result: CourseExpectedSlot[] = [];
  for (const revision of course.revisions) {
    if (revision.deleted_at !== null) continue;
    // Successor cutoff applies even where a late old actual floored the old end
    // beyond the successor's start, and even when that successor was tombstoned.
    const successor = course.revisions.find(
      (next) => next.predecessor_id === revision.id
    );
    if (successor?.start_date && day >= successor.start_date) continue;
    for (const rule of revision.rules) {
      if (!ruleDue(revision, rule, day)) continue;
      const time = rule.time_of_day
        ? rule.time_of_day.length === 5
          ? rule.time_of_day + ':00'
          : rule.time_of_day
        : null;
      const at =
        time === null
          ? null
          : new Date(
              localDateTimeToUtc(
                `${day}T${time.slice(0, 5)}`,
                course.timezone
              ).getTime() +
                Number(time.slice(6, 8) || 0) * 1000
            ).toISOString();
      if (at !== null) {
        if (
          !input.medicationActive &&
          day === input.today &&
          Date.parse(at) >= Date.parse(input.nowInstant)
        )
          continue;
        if (
          Date.parse(at) < baseline ||
          !courseActivityContains(revision.activity, at)
        )
          continue;
      } else if (
        !revision.activity.some(
          (interval) =>
            Math.max(
              range.start.getTime(),
              baseline,
              Date.parse(interval.from_at)
            ) <
            Math.min(
              !input.medicationActive && day === input.today
                ? Math.min(range.end.getTime(), Date.parse(input.nowInstant))
                : range.end.getTime(),
              interval.until_at === null
                ? Infinity
                : Date.parse(interval.until_at)
            )
        )
      )
        continue;
      const key = courseSlotKey(revision.id, rule.id, day, time);
      const prior =
        input.delivered === undefined
          ? null
          : new Set(
              input.delivered
                .filter((entry) => {
                  if (
                    entry.course_revision_id !== revision.id ||
                    !isDelivered(entry) ||
                    entry.course_slot_key === key
                  )
                    return false;
                  const entryDay = entry.entry_date.slice(0, 10);
                  if (entryDay !== day) return entryDay < day;
                  if (entry.scheduled_for && at)
                    return Date.parse(entry.scheduled_for) < Date.parse(at);
                  if (entry.course_rule_id) {
                    const other = revision.rules.find(
                      (item) => item.id === entry.course_rule_id
                    );
                    if (other) return other.rule_index < rule.rule_index;
                  }
                  return (
                    at !== null &&
                    entry.occurred_at != null &&
                    Date.parse(entry.occurred_at) < Date.parse(at)
                  );
                })
                .map((entry) => entry.id)
            ).size;
      const phase = courseCurrentPhase({ revision, deliveredCount: prior });
      const authored = rule.dose_amount ?? phase.authored_dose;
      result.push({
        course_id: course.id,
        schedule_type_id: rule.schedule_type_id,
        course_revision_id: revision.id,
        course_rule_id: rule.id,
        course_step_id: phase.step_id,
        course_slot_key: key,
        course_expected_version: course.version,
        medication_id: course.medication_id,
        scheduled_day: day,
        time_of_day: time,
        scheduled_for: at,
        per_dose_amount: coursePerDoseAmount(
          authored,
          revision.dose_basis,
          phase.injections_per_week
        ),
        authored_dose: authored,
        dose_unit:
          rule.dose_amount != null ? revision.dose_unit : phase.dose_unit,
        dose_basis: revision.dose_basis,
        phase_progress_known: phase.progress_known,
      });
    }
  }
  const order = new Map(
    course.revisions.flatMap((revision) =>
      revision.rules.map((rule) => [rule.id, rule.rule_index] as const)
    )
  );
  return result.sort(
    (a, b) =>
      (a.time_of_day ?? '99:99').localeCompare(b.time_of_day ?? '99:99') ||
      order.get(a.course_rule_id)! - order.get(b.course_rule_id)! ||
      a.course_rule_id.localeCompare(b.course_rule_id)
  );
}
export type CourseDueSchedule = SharedScheduleRule &
  CourseExpectedSlot & { id: string };
export function courseDueDosesForDay<M extends SharedMedication>(input: {
  medications: M[];
  courses: MedicationCourse[];
  day: string;
  today: string;
  nowInstant: string;
  delivered?: CourseDeliveredDose[];
}): { medication: M; schedule: CourseDueSchedule }[] {
  return input.courses.flatMap((course) => {
    const medication = input.medications.find(
      (med) => med.id === course.medication_id
    );
    if (!medication) return [];
    return courseSlotsForDay({
      course,
      day: input.day,
      today: input.today,
      nowInstant: input.nowInstant,
      medicationActive: medication.is_active,
      delivered: input.delivered,
    }).map((slot) => ({
      medication,
      schedule: {
        ...slot,
        id: slot.course_rule_id,
      },
    }));
  });
}
/** Explicitly selected legacy handoff ends only selected rules; no fabricated past completions. */
export function courseHandoffEndDay(
  existingEnd: string | null,
  cutoverDay: string
): string {
  const previous = addDays(cutoverDay, -1);
  return existingEnd !== null && existingEnd < previous
    ? existingEnd
    : previous;
}
