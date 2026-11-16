import {
  addDays,
  isDayString,
  type MedicationCoursePlanInput,
  type MedicationCourseRevision,
  type MedicationCourseCyclePlanPreview,
} from '@workspace/shared';
import { courseProblem } from '../models/medicationCourseRepository.js';
export function courseCycleDates(
  on: number | null,
  off: number | null,
  anchor: string | null
) {
  try {
    const planned_stop_date =
      on !== null && anchor !== null ? addDays(anchor, on * 7 - 1) : null;
    const next_restart_date =
      on !== null && off !== null && anchor !== null
        ? addDays(anchor, (on + off) * 7)
        : null;
    if (
      (planned_stop_date !== null && !isDayString(planned_stop_date)) ||
      (next_restart_date !== null && !isDayString(next_restart_date))
    )
      throw new RangeError('Unsupported calendar date');
    return { planned_stop_date, next_restart_date };
  } catch {
    throw courseProblem(
      'Weekly cycle dates exceed the supported calendar range. Review the recorded plan dates.',
      422
    );
  }
}
export function courseWeeklyAnchor(
  plan: MedicationCoursePlanInput,
  previous?: MedicationCourseRevision
): string | null {
  if (
    previous?.course_cycle_anchor_date !== null &&
    previous?.course_cycle_anchor_date !== undefined
  )
    return previous.course_cycle_anchor_date;
  if (
    plan.course_cycle_on_weeks === null ||
    plan.course_cycle_on_weeks === undefined
  )
    return null;
  return previous?.start_date ?? plan.start_date;
}

export function courseCyclePlanPreview(
  plan: MedicationCoursePlanInput,
  anchor: string | null,
  timezone: string
): MedicationCourseCyclePlanPreview | null {
  if (
    plan.course_cycle_on_weeks === null ||
    plan.course_cycle_on_weeks === undefined ||
    anchor === null
  )
    return null;
  return {
    on_weeks: plan.course_cycle_on_weeks,
    off_weeks: plan.course_cycle_off_weeks ?? null,
    anchor_date: anchor,
    planned_stop_date: courseCycleDates(
      plan.course_cycle_on_weeks,
      plan.course_cycle_off_weeks ?? null,
      anchor
    ).planned_stop_date!,
    next_restart_date: courseCycleDates(
      plan.course_cycle_on_weeks,
      plan.course_cycle_off_weeks ?? null,
      anchor
    ).next_restart_date,
    timezone,
    advisory: true,
  };
}
