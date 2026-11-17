import type {
  MedicationCourseTimelineResponse,
  MedicationCourseTimelineRow,
  MedicationCourseTimelineSegment,
} from '../schemas/api/MedicationCourseTimeline.api.zod.ts';
import {
  addDays,
  dayOfWeek,
  daysBetween,
  instantToDay,
  isDayString,
} from '../utils/timezone.ts';
import { courseBucket } from './courseLifecycle.ts';
import {
  courseProjectionEligibility,
  type CourseProjectionRevisionFacts,
} from './courseProjectionEligibility.ts';

export interface TimelineRevisionFacts extends CourseProjectionRevisionFacts {
  revision_no: number;
  name: string;
  start_date: string | null;
  closed_date: string | null;
  activity: { from_at: string; until_at: string | null }[];
}
export interface TimelineCourseFacts {
  id: string;
  user_id: string;
  medication_id: string | null;
  medication_name_snapshot: string | null;
  current_revision_id: string | null;
  version: number;
  captured_at: string;
  timezone: string;
  deleted_at: string | null;
  revisions: TimelineRevisionFacts[];
}
export interface MedicationCourseTimelineInput {
  courses: TimelineCourseFacts[];
  medications: ReadonlyMap<string, { name: string; is_active: boolean }>;
  as_of: string;
  today: string;
  timezone: string;
}
const minDay = (days: string[]): string | null =>
  days.length ? [...days].sort()[0]! : null;
const maxDay = (a: string, b: string) => (a > b ? a : b);
function intervals(
  course: TimelineCourseFacts,
  revision: TimelineRevisionFacts
) {
  const baseline = Date.parse(course.captured_at);
  return revision.activity.flatMap((interval) => {
    const from = Math.max(Date.parse(interval.from_at), baseline),
      until =
        interval.until_at === null ? Infinity : Date.parse(interval.until_at);
    if (!Number.isFinite(from) || Number.isNaN(until) || until <= from)
      return [];
    return [
      {
        from: instantToDay(from, course.timezone),
        to:
          until === Infinity ? null : instantToDay(until - 1, course.timezone),
      },
    ];
  });
}
/** Compares civil date labels in each saved calendar, never simultaneous exposure. */
export function buildMedicationCourseTimeline(
  input: MedicationCourseTimelineInput
): MedicationCourseTimelineResponse {
  if (!isDayString(input.today) || !Number.isFinite(Date.parse(input.as_of)))
    throw new RangeError('Invalid timeline snapshot');
  const start = addDays(input.today, -21 - dayOfWeek(input.today)),
    end = addDays(start, 139);
  if (!isDayString(start) || !isDayString(end))
    throw new RangeError('Unsupported timeline calendar range');
  const rows: MedicationCourseTimelineRow[] = [];
  const planned = Array.from({ length: 140 }, () => new Set<string>()),
    projected = Array.from({ length: 140 }, () => new Set<string>());
  for (const course of [...input.courses].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    if (course.deleted_at !== null) continue;
    const medication =
      course.medication_id === null
        ? undefined
        : input.medications.get(course.medication_id);
    const localToday = instantToDay(input.as_of, course.timezone);
    const seen = new Set<string>();
    for (const revision of [...course.revisions].sort(
      (a, b) => a.revision_no - b.revision_no || a.id.localeCompare(b.id)
    )) {
      if (revision.deleted_at !== null || seen.has(revision.id)) continue;
      seen.add(revision.id);
      const limitations = new Set<
        MedicationCourseTimelineRow['limitations'][number]
      >();
      const successor = course.revisions.find(
        (row) => row.predecessor_id === revision.id
      );
      let stop: string | null = null,
        unknownStop = false;
      try {
        stop = minDay(
          [
            revision.end_date,
            revision.closed_date,
            successor?.start_date ? addDays(successor.start_date, -1) : null,
          ].filter((day): day is string => day !== null)
        );
        if (stop !== null && !isDayString(stop))
          throw new RangeError('Unsupported boundary');
      } catch {
        limitations.add('date_out_of_range');
        unknownStop = true;
      }
      if (revision.status === 'completed' && stop === null) {
        const ends = revision.activity.filter(
          (row) =>
            Number.isFinite(Date.parse(row.from_at)) &&
            row.until_at !== null &&
            Date.parse(row.until_at) > Date.parse(row.from_at)
        );
        if (ends.length && ends.length === revision.activity.length) {
          const until = Math.max(
            ...ends.map((row) => Date.parse(row.until_at!))
          );
          stop = instantToDay(until - 1, course.timezone);
        } else {
          unknownStop = true;
          limitations.add('unknown_stop');
        }
      }
      const segments: MedicationCourseTimelineSegment[] = [];
      const append = (
        kind: MedicationCourseTimelineSegment['kind'],
        from: string,
        to: string
      ) => {
        const offset = daysBetween(start, from),
          days = daysBetween(from, to) + 1;
        segments.push({ kind, from, to, offset, days });
      };
      const overlay = (
        kind: MedicationCourseTimelineSegment['kind'],
        day: string
      ) => {
        const previous = segments.at(-1);
        if (previous?.kind === kind && addDays(previous.to, 1) === day) {
          previous.to = day;
          previous.days++;
        } else append(kind, day, day);
      };
      const active = intervals(course, revision);
      const hasActivity = (day: string) =>
        active.some(
          (interval) =>
            interval.from <= day && (interval.to === null || day <= interval.to)
        );
      const current = course.current_revision_id === revision.id;
      const overlapEligible =
        current &&
        revision.status === 'active' &&
        medication?.is_active === true;
      let projection: ReturnType<
        typeof courseProjectionEligibility<TimelineRevisionFacts>
      > = null;
      let anchor: string | null = null,
        on: number | null = null,
        off: number | null = null;
      let cycleKnown = true;
      if (
        revision.course_cycle_on_weeks !== null ||
        revision.course_cycle_off_weeks !== null
      ) {
        anchor = revision.course_cycle_anchor_date;
        on = revision.course_cycle_on_weeks;
        off = revision.course_cycle_off_weeks;
        if (
          anchor === null ||
          on === null ||
          !Number.isInteger(on) ||
          on < 1 ||
          on > 104 ||
          (off !== null && (!Number.isInteger(off) || off < 1 || off > 104))
        ) {
          cycleKnown = false;
          limitations.add('unknown_cycle_anchor');
        } else {
          try {
            if (!isDayString(addDays(anchor, on * 7 - 1)))
              throw new RangeError('Unsupported cycle');
          } catch {
            cycleKnown = false;
            limitations.add('date_out_of_range');
          }
        }
      }
      if (revision.start_date === null) {
        limitations.add('unknown_start');
      } else if (!isDayString(revision.start_date)) {
        limitations.add('date_out_of_range');
      } else {
        try {
          projection = courseProjectionEligibility({
            course,
            medicationActive: medication?.is_active === true,
          });
          if (projection?.revision.id !== revision.id) projection = null;
        } catch {
          limitations.add('date_out_of_range');
        }
        if (!unknownStop) {
          const from = maxDay(start, revision.start_date),
            to = stop === null ? end : stop < end ? stop : end;
          if (from <= to) append('authored_window', from, to);
          for (let day = from; day <= to; day = addDays(day, 1)) {
            if (!cycleKnown) continue;
            if (anchor !== null && day < anchor) {
              limitations.add('cycle_before_anchor');
              continue;
            }
            if (!hasActivity(day)) continue;
            let kind: 'planned_on' | 'advisory_break' = 'planned_on';
            if (anchor !== null && on !== null) {
              const elapsed = daysBetween(anchor, day);
              if (off === null) {
                if (elapsed >= on * 7) continue;
              } else if (elapsed % ((on + off) * 7) >= on * 7)
                kind = 'advisory_break';
            }
            overlay(kind, day);
            if (overlapEligible && kind === 'planned_on')
              planned[daysBetween(start, day)]!.add(course.id);
          }
        }
        if (projection && !unknownStop) {
          const from = maxDay(
            start,
            maxDay(
              revision.start_date,
              maxDay(localToday, addDays(projection.committed_end_date, 1))
            )
          );
          const bound = minDay(
            [
              revision.closed_date,
              successor?.start_date ? addDays(successor.start_date, -1) : null,
            ].filter((day): day is string => day !== null)
          );
          const to = bound !== null && bound < end ? bound : end;
          for (let day = from; day <= to; day = addDays(day, 1)) {
            if (!hasActivity(day) || day < projection.anchor_date) continue;
            const elapsed = daysBetween(projection.anchor_date, day);
            const kind =
              elapsed % ((projection.on_weeks + projection.off_weeks) * 7) <
              projection.on_weeks * 7
                ? 'projected_on'
                : 'projected_break';
            overlay(kind, day);
            if (overlapEligible && kind === 'projected_on')
              projected[daysBetween(start, day)]!.add(course.id);
          }
        }
      }
      if (!segments.length && !limitations.size) continue;
      if (revision.start_date !== null && revision.start_date > end) continue;
      if (
        stop !== null &&
        stop < start &&
        !projection &&
        !limitations.has('unknown_start')
      )
        continue;
      rows.push({
        course_id: course.id,
        revision_id: revision.id,
        revision_no: revision.revision_no,
        name: revision.name,
        medication_id: course.medication_id,
        medication_name:
          medication?.name ?? course.medication_name_snapshot ?? '',
        timezone: course.timezone,
        local_today: localToday,
        status: revision.status,
        bucket: courseBucket(revision, localToday),
        is_current_tip: current,
        medication_active: medication?.is_active ?? null,
        version: course.version,
        start_date: revision.start_date,
        end_date: revision.end_date,
        closed_date: revision.closed_date,
        open_end:
          revision.status !== 'completed' &&
          stop === null &&
          !unknownStop &&
          revision.start_date !== null,
        overlap_eligible: overlapEligible,
        segments,
        limitations: [...limitations],
      });
    }
  }
  return {
    as_of: input.as_of,
    today: input.today,
    timezone: input.timezone,
    window: { start_date: start, end_date: end, days: 140 },
    today_offset: daysBetween(start, input.today),
    week_ticks: Array.from({ length: 20 }, (_, i) => ({
      day: addDays(start, i * 7),
      offset: i * 7,
    })),
    rows,
    overlap: Array.from({ length: 140 }, (_, i) => ({
      day: addDays(start, i),
      planned_on: planned[i]!.size,
      projected_on: [...projected[i]!].filter((id) => !planned[i]!.has(id))
        .length,
    })),
  };
}
