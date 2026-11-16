import type {
  MedicationCourse,
  MedicationCourseRevision,
  MedicationCourseRule,
} from '../schemas/api/MedicationCourses.api.zod.ts';
import type { CourseDeliveredDose } from './courseSchedules.ts';
import {
  courseCurrentPhase,
  courseInjectionsPerWeek,
} from './courseRevisions.ts';

export const coursePhaseActualKey = (
  entry: Pick<CourseDeliveredDose, 'id' | 'source_kind'>
): string => `${entry.source_kind ?? 'unknown'}:${entry.id}`;

/** Phase provenance never changes the revision/rule identity of an actual or expected slot. */
export const coursePhaseFamilyId = (
  revision: MedicationCourseRevision
): string => revision.phase_family_id ?? revision.id;

export function coursePhaseContext(input: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
}): {
  family_id: string;
  origin: MedicationCourseRevision | null;
  window: { start_date: string; end_date: string | null } | null;
} {
  const family_id = coursePhaseFamilyId(input.revision);
  const origin =
    input.course.revisions.find((row) => row.id === family_id) ?? null;
  // A legacy self-family retains its existing interpretation. A continuation must
  // use the captured pre-boundary window, including when the origin is tombstoned.
  const window =
    origin?.phase_origin_context ??
    (origin?.id === input.revision.id
      ? { start_date: origin.start_date, end_date: origin.end_date }
      : null);
  return { family_id, origin, window };
}

export function coursePhaseFrequency(input: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
}): number | null {
  const { origin, window } = coursePhaseContext(input);
  return origin && window
    ? courseInjectionsPerWeek(origin.rules, window)
    : null;
}

export function coursePhaseForRevision(input: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  deliveredCount: number | null;
}): ReturnType<typeof courseCurrentPhase> {
  const { origin, window } = coursePhaseContext(input);
  const phase = courseCurrentPhase({
    revision:
      origin && window
        ? { ...input.revision, ...window, rules: origin.rules }
        : input.revision,
    deliveredCount: origin && window ? input.deliveredCount : null,
  });
  return origin && window
    ? phase
    : {
        ...phase,
        injections_per_week: null,
        dose_amount:
          input.revision.dose_basis === 'per_week' ? null : phase.dose_amount,
      };
}

export function coursePhaseActuals<T extends CourseDeliveredDose>(input: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  delivered: T[];
}): T[] {
  const family = coursePhaseFamilyId(input.revision);
  const revisions = new Map(input.course.revisions.map((row) => [row.id, row]));
  return [
    ...new Map(
      input.delivered
        .filter((entry) => {
          if (entry.status !== 'taken' && entry.status !== 'prn_taken')
            return false;
          if (entry.phase_family_id != null)
            return entry.phase_family_id === family;
          const linked =
            entry.course_revision_id === null
              ? null
              : revisions.get(entry.course_revision_id);
          return linked != null && coursePhaseFamilyId(linked) === family;
        })
        .map((entry) => [coursePhaseActualKey(entry), entry])
    ).values(),
  ];
}

/** Existing frozen tracking-day and authored rule ordering, applied to phase-only history. */
export function coursePhaseDeliveredBeforeSlot(input: {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
  rule: MedicationCourseRule;
  day: string;
  at: string | null;
  key: string;
  delivered: CourseDeliveredDose[];
}): number {
  return coursePhaseActuals(input).filter((entry) => {
    if (entry.course_slot_key === input.key) return false;
    const day = entry.entry_date.slice(0, 10);
    if (day !== input.day) return day < input.day;
    if (entry.scheduled_for && input.at)
      return Date.parse(entry.scheduled_for) < Date.parse(input.at);
    if (entry.course_rule_id) {
      const linked = input.course.revisions.find(
        (row) => row.id === entry.course_revision_id
      );
      const other = linked?.rules.find(
        (row) => row.id === entry.course_rule_id
      );
      if (other) return other.rule_index < input.rule.rule_index;
    }
    return (
      input.at !== null &&
      entry.occurred_at != null &&
      Date.parse(entry.occurred_at) < Date.parse(input.at)
    );
  }).length;
}
