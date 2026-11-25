import {
  courseBucket,
  daysBetween,
  isCurrentCourseTip,
  type MedicationCourse,
  type MedicationCourseCycleState,
  type MedicationCourseRevision,
} from '@workspace/shared';

export type RunningPlan = {
  course: MedicationCourse;
  revision: MedicationCourseRevision;
};

export type PlanDayReadout =
  | { kind: 'plan'; day: number }
  | { kind: 'on'; day: number; phaseDays: number | null }
  | { kind: 'off'; day: number; phaseDays: number | null };

type CycleView = Pick<
  MedicationCourseCycleState,
  'phase' | 'anchor_date' | 'on_weeks' | 'off_weeks' | 'planned_stop_date'
>;

function currentTip(course: MedicationCourse) {
  if (course.deleted_at) return undefined;
  return course.revisions.find(
    (row) => !row.deleted_at && isCurrentCourseTip(course, row.id)
  );
}

/** True when any of the medicines has a non-deleted plan, running or not. */
export function hasAnyPlan(
  courses: MedicationCourse[],
  medicationIds: ReadonlySet<string>
): boolean {
  return courses.some(
    (course) =>
      course.medication_id !== null &&
      medicationIds.has(course.medication_id) &&
      currentTip(course) != null
  );
}

/**
 * The one plan the tile follows: the most recently started plan running today. Ties go to the
 * medicine name, then the course id, so the choice is stable.
 */
export function pickRunningPlan(
  courses: MedicationCourse[],
  today: string,
  medicationIds: ReadonlySet<string>
): RunningPlan | null {
  const running = courses.flatMap((course): RunningPlan[] => {
    if (
      course.medication_id === null ||
      !medicationIds.has(course.medication_id)
    )
      return [];
    const revision = currentTip(course);
    return revision && courseBucket(revision, today) === 'active'
      ? [{ course, revision }]
      : [];
  });
  running.sort(
    (a, b) =>
      b.revision.start_date.localeCompare(a.revision.start_date ?? '') ||
      a.course.medication_name_snapshot.localeCompare(
        b.course.medication_name_snapshot
      ) ||
      a.course.id.localeCompare(b.course.id)
  );
  return running[0] ?? null;
}

export function isCyclicRevision(revision: MedicationCourseRevision): boolean {
  return revision.course_cycle_on_weeks != null;
}

/** The day to show, or null when no whole day number can be worked out. */
export function planDayReadout(
  revision: Pick<MedicationCourseRevision, 'start_date'>,
  today: string,
  cycle: CycleView | null | undefined
): PlanDayReadout | null {
  if (cycle?.phase === 'on' && cycle.anchor_date) {
    const day = daysBetween(cycle.anchor_date, today) + 1;
    if (day >= 1)
      return {
        kind: 'on',
        day,
        phaseDays: cycle.on_weeks == null ? null : cycle.on_weeks * 7,
      };
  }
  if (cycle?.phase === 'off' && cycle.planned_stop_date) {
    const day = daysBetween(cycle.planned_stop_date, today);
    if (day >= 1)
      return {
        kind: 'off',
        day,
        phaseDays: cycle.off_weeks == null ? null : cycle.off_weeks * 7,
      };
  }
  const day = daysBetween(revision.start_date, today) + 1;
  return day >= 1 ? { kind: 'plan', day } : null;
}
