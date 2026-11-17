import { addDays, isDayString } from '../utils/timezone.ts';

/** The single existing I07 gate, independent of doses, recurrence rules and stock. */
export interface CourseProjectionRevisionFacts {
  id: string;
  predecessor_id: string | null;
  deleted_at: string | null;
  status: 'active' | 'paused' | 'completed';
  end_date: string | null;
  course_cycle_on_weeks: number | null;
  course_cycle_off_weeks: number | null;
  course_cycle_anchor_date: string | null;
}
export interface CourseProjectionCourseFacts<
  R extends CourseProjectionRevisionFacts = CourseProjectionRevisionFacts,
> {
  id: string;
  current_revision_id: string | null;
  deleted_at: string | null;
  revisions: R[];
}
export function courseProjectionEligibility<
  R extends CourseProjectionRevisionFacts,
>(input: {
  course: CourseProjectionCourseFacts<R>;
  medicationActive: boolean;
}): {
  revision: R;
  anchor_date: string;
  committed_end_date: string;
  on_weeks: number;
  off_weeks: number;
  next_restart_date: string;
} | null {
  const { course } = input;
  const revision = course.revisions.find(
    (row) => row.id === course.current_revision_id
  );
  if (
    !input.medicationActive ||
    course.deleted_at !== null ||
    !revision ||
    revision.deleted_at !== null ||
    revision.status !== 'active' ||
    course.revisions.some((row) => row.predecessor_id === revision.id)
  )
    return null;
  const on = revision.course_cycle_on_weeks,
    off = revision.course_cycle_off_weeks,
    anchor = revision.course_cycle_anchor_date;
  if (
    !on ||
    !off ||
    !Number.isInteger(on) ||
    !Number.isInteger(off) ||
    on < 1 ||
    off < 1 ||
    on > 104 ||
    off > 104 ||
    !anchor
  )
    return null;
  const stop = addDays(anchor, on * 7 - 1),
    restart = addDays(anchor, (on + off) * 7);
  // Existing I07 callers qualify the range failure as unknown, rather than
  // silently accepting or clamping an unsupported calendar date.
  if (!isDayString(stop) || !isDayString(restart))
    throw new RangeError('Unsupported projection calendar date');
  if (revision.end_date !== stop) return null;
  return {
    revision,
    anchor_date: anchor,
    committed_end_date: stop,
    on_weeks: on,
    off_weeks: off,
    next_restart_date: restart,
  };
}
