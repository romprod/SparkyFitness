import type {
  MedicationCourse,
  MedicationCourseActivity,
  MedicationCourseBucket,
  MedicationCourseStatus,
} from '../schemas/api/MedicationCourses.api.zod.ts';

/** Source precedence; date endpoints are inclusive and current status is not history. */
export function courseBucket(
  revision: {
    status: MedicationCourseStatus;
    start_date: string | null;
    end_date: string | null;
  },
  today: string
): MedicationCourseBucket {
  if (revision.status === 'completed') return 'completed';
  if (revision.status === 'paused') return 'paused';
  if (revision.start_date !== null && revision.start_date > today)
    return 'scheduled';
  if (revision.end_date !== null && revision.end_date < today) return 'ended';
  return 'active';
}
/** A tombstoned tip does not promote or resurrect a predecessor. */
export function isCurrentCourseTip(
  course: MedicationCourse,
  revisionId: string
): boolean {
  return (
    course.deleted_at === null &&
    course.current_revision_id === revisionId &&
    course.revisions.some(
      (revision) => revision.id === revisionId && revision.deleted_at === null
    )
  );
}
/** Returns a new end-day stamp, or null when the existing end must remain unchanged. */
export function courseEndOnComplete(input: {
  wasStatus: MedicationCourseStatus;
  nowStatus: MedicationCourseStatus;
  currentEndDate: string | null;
  today: string;
}): string | null {
  if (input.nowStatus !== 'completed' || input.wasStatus === 'completed')
    return null;
  if (input.currentEndDate !== null && input.currentEndDate <= input.today)
    return null;
  return input.today;
}
/** Half-open instant intervals retain earlier same-day activity through pause/completion. */
export function courseActivityContains(
  activity: Pick<MedicationCourseActivity, 'from_at' | 'until_at'>[],
  instant: string
): boolean {
  const at = Date.parse(instant);
  return (
    Number.isFinite(at) &&
    activity.some(
      (interval) =>
        Date.parse(interval.from_at) <= at &&
        (interval.until_at === null || at < Date.parse(interval.until_at))
    )
  );
}
/** Storage owns IDs/audits; this pure decision never rewrites previous intervals. */
export function courseActivityTransition(input: {
  activity: MedicationCourseActivity[];
  nextStatus: MedicationCourseStatus;
  at: string;
}): {
  close_ids: string[];
  close_at: Record<string, string>;
  open_from_at: string | null;
} {
  const at = Date.parse(input.at);
  if (!Number.isFinite(at)) throw new RangeError('Invalid activity instant');
  const open = input.activity.filter((interval) => interval.until_at === null);
  if (input.nextStatus === 'active')
    return {
      close_ids: [],
      close_at: {},
      open_from_at: open.length ? null : input.at,
    };
  return {
    close_ids: open.map((interval) => interval.id),
    close_at: Object.fromEntries(
      open.map((interval) => [
        interval.id,
        Date.parse(interval.from_at) > at ? interval.from_at : input.at,
      ])
    ),
    open_from_at: null,
  };
}
