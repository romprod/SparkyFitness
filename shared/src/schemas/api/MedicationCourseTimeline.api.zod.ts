import { z } from 'zod';
import {
  medicationCourseBucketSchema,
  medicationCourseDaySchema,
  medicationCourseInstantSchema,
  medicationCourseStatusSchema,
} from './MedicationCourses.api.zod.ts';
import { addDays, dayOfWeek } from '../../utils/timezone.ts';

export const MEDICATION_COURSE_TIMELINE_DAYS = 140;
const uuid = z.string().uuid();
const offset = z.number().int().min(0).max(139);

/** An assertion about the selected profile, never an owner assignment. */
export const medicationCourseTimelineQuerySchema = z
  .object({ expected_owner_id: uuid.optional() })
  .strict();

export const medicationCourseTimelineSegmentSchema = z
  .object({
    kind: z.enum([
      'authored_window',
      'planned_on',
      'advisory_break',
      'projected_on',
      'projected_break',
    ]),
    from: medicationCourseDaySchema,
    to: medicationCourseDaySchema,
    offset,
    days: z.number().int().min(1).max(MEDICATION_COURSE_TIMELINE_DAYS),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.from > segment.to || segment.offset + segment.days > 140)
      context.addIssue({
        code: 'custom',
        message: 'Timeline segments require ordered, bounded civil dates',
      });
  });

export const medicationCourseTimelineRowSchema = z
  .object({
    course_id: uuid,
    revision_id: uuid,
    revision_no: z.number().int().positive(),
    name: z.string(),
    medication_id: uuid.nullable(),
    medication_name: z.string(),
    timezone: z.string().min(1),
    local_today: medicationCourseDaySchema,
    status: medicationCourseStatusSchema,
    bucket: medicationCourseBucketSchema,
    is_current_tip: z.boolean(),
    medication_active: z.boolean().nullable(),
    version: z.number().int().positive(),
    start_date: medicationCourseDaySchema.nullable(),
    end_date: medicationCourseDaySchema.nullable(),
    closed_date: medicationCourseDaySchema.nullable(),
    open_end: z.boolean(),
    overlap_eligible: z.boolean(),
    segments: z.array(medicationCourseTimelineSegmentSchema),
    limitations: z.array(
      z.enum([
        'unknown_start',
        'unknown_stop',
        'cycle_before_anchor',
        'unknown_cycle_anchor',
        'date_out_of_range',
      ])
    ),
  })
  .strict()
  .superRefine((row, context) => {
    if (
      row.overlap_eligible &&
      (!row.is_current_tip ||
        row.status !== 'active' ||
        row.medication_id === null ||
        row.medication_active !== true)
    )
      context.addIssue({
        code: 'custom',
        path: ['overlap_eligible'],
        message:
          'Overlap requires the current active plan and linked active medication',
      });
    if (
      !row.overlap_eligible &&
      row.segments.some((segment) => segment.kind.startsWith('projected_'))
    )
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Ineligible rows cannot acquire hypothetical cycle windows',
      });
    if (row.start_date === null && row.segments.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'An unknown course start cannot fill the viewing window',
      });
    if (row.status === 'completed' && row.open_end)
      context.addIssue({
        code: 'custom',
        path: ['open_end'],
        message: 'A completed plan cannot claim an open future window',
      });
    if (
      row.segments.some(
        (segment) =>
          segment.kind.startsWith('projected_') &&
          (segment.from < row.local_today ||
            row.end_date === null ||
            segment.from <= row.end_date)
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message:
          'Hypothetical windows must be current or future and beyond the authored end',
      });
  });

export const medicationCourseTimelineOverlapSchema = z
  .object({
    day: medicationCourseDaySchema,
    planned_on: z.number().int().nonnegative(),
    projected_on: z.number().int().nonnegative(),
  })
  .strict();

/** Civil date labels are compared, not simultaneous administration instants. */
export const medicationCourseTimelineResponseSchema = z
  .object({
    as_of: medicationCourseInstantSchema,
    today: medicationCourseDaySchema,
    timezone: z.string().min(1),
    window: z
      .object({
        start_date: medicationCourseDaySchema,
        end_date: medicationCourseDaySchema,
        days: z.literal(MEDICATION_COURSE_TIMELINE_DAYS),
      })
      .strict(),
    today_offset: offset,
    week_ticks: z
      .array(z.object({ day: medicationCourseDaySchema, offset }).strict())
      .length(20),
    rows: z.array(medicationCourseTimelineRowSchema),
    overlap: z.array(medicationCourseTimelineOverlapSchema).length(140),
  })
  .strict()
  .superRefine((timeline, context) => {
    const start = timeline.window.start_date;
    if (
      addDays(start, 139) !== timeline.window.end_date ||
      addDays(start, timeline.today_offset) !== timeline.today ||
      dayOfWeek(start) !== 0 ||
      timeline.today_offset < 21 ||
      timeline.today_offset > 27
    )
      context.addIssue({
        code: 'custom',
        path: ['window'],
        message:
          'Timeline dates must agree with the fixed civil viewing window',
      });
    for (const [index, tick] of timeline.week_ticks.entries())
      if (tick.offset !== index * 7 || tick.day !== addDays(start, index * 7))
        context.addIssue({
          code: 'custom',
          path: ['week_ticks', index],
          message:
            'Week ticks must retain their authoritative calendar offsets',
        });
    for (const [index, day] of timeline.overlap.entries())
      if (day.day !== addDays(start, index))
        context.addIssue({
          code: 'custom',
          path: ['overlap', index],
          message: 'Overlap must use the same consecutive civil-date columns',
        });
    const revisions = new Set<string>();
    for (const [index, row] of timeline.rows.entries()) {
      if (revisions.has(row.revision_id))
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'revision_id'],
          message: 'A revision appears once in the timeline',
        });
      revisions.add(row.revision_id);
      for (const [segmentIndex, segment] of row.segments.entries())
        if (
          segment.from !== addDays(start, segment.offset) ||
          segment.to !== addDays(start, segment.offset + segment.days - 1)
        )
          context.addIssue({
            code: 'custom',
            path: ['rows', index, 'segments', segmentIndex],
            message: 'Segment dates must match their bounded visual geometry',
          });
    }
  });

export type MedicationCourseTimelineQuery = z.infer<
  typeof medicationCourseTimelineQuerySchema
>;
export type MedicationCourseTimelineSegment = z.infer<
  typeof medicationCourseTimelineSegmentSchema
>;
export type MedicationCourseTimelineRow = z.infer<
  typeof medicationCourseTimelineRowSchema
>;
export type MedicationCourseTimelineOverlap = z.infer<
  typeof medicationCourseTimelineOverlapSchema
>;
export type MedicationCourseTimelineResponse = z.infer<
  typeof medicationCourseTimelineResponseSchema
>;
