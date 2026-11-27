import { z } from 'zod';
import {
  medicationCourseDaySchema as day,
  medicationCourseInstantSchema as instant,
} from './MedicationCourses.api.zod.ts';
import { addDays, dayOfWeek, isDayString } from '../../utils/timezone.ts';

const uuid = z.string().uuid();
const nullableId = uuid.nullable();
const nullableText = z.string().nullable();
/** Serialized existing injection row for a fresh exact-ID correction read. */
export const medicationInjectionReadSchema = z
  .object({
    id: uuid,
    medication_id: nullableId,
    user_id: uuid,
    pen_id: nullableId,
    preparation_id: nullableId,
    injected_at: instant.nullable(),
    entry_date: day,
    site: nullableText,
    administration_route: nullableText,
    dose_mg: z.union([z.number().finite(), z.string()]).nullable(),
    dose_mg_exact: nullableText,
    volume_ml: nullableText,
    syringe_units: nullableText,
    dose_input_unit: nullableText,
    syringe_id: nullableId,
    notes: nullableText,
    source: z.string(),
    custom_fields: z.unknown(),
    created_at: instant.nullable(),
    updated_at: instant.nullable(),
    scheduled_for: instant.nullable(),
    course_revision_id: nullableId,
    course_rule_id: nullableId,
    course_step_id: nullableId,
    scheduled_day: day.nullable(),
    course_slot_key: nullableText,
    course_origin: z.boolean().nullable(),
    medication_name_snapshot: nullableText,
  })
  .strict();
export const medicationLogWeekQuerySchema = z
  .object({
    week_start: day.optional(),
    expected_owner_id: uuid.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.week_start &&
      (dayOfWeek(query.week_start) !== 1 ||
        !isDayString(addDays(query.week_start, 6)))
    )
      context.addIssue({
        code: 'custom',
        path: ['week_start'],
        message:
          'Week start must be a Monday with seven supported calendar dates',
      });
  });

export const medicationLogWeekLaneSchema = z
  .object({
    id: z.string().min(1),
    medication_id: nullableId,
    name: z.string(),
    is_supplement: z.boolean().nullable(),
  })
  .strict();

/** Recorded native values only. Full injection correction reads its exact row lazily. */
export const medicationLogWeekActualSchema = z
  .object({
    key: z.string().min(1),
    id: uuid,
    source_kind: z.enum(['entry', 'injection']),
    lane_id: z.string().min(1),
    medication_id: nullableId,
    medication_name: nullableText,
    status: z.enum(['taken', 'prn_taken', 'skipped', 'snoozed']),
    entry_date: day,
    occurred_at: instant.nullable(),
    dose_amount: nullableText,
    dose_unit: nullableText,
    dose_mg_exact: nullableText,
    schedule_id: nullableId,
    course_origin: z.boolean().nullable(),
    course_revision_id: nullableId,
    course_rule_id: nullableId,
    course_step_id: nullableId,
    course_slot_key: nullableText,
    scheduled_day: day.nullable(),
    scheduled_for: instant.nullable(),
    notes: nullableText,
    site: nullableText,
    administration_route: nullableText,
  })
  .strict()
  .superRefine((actual, context) => {
    if (actual.key !== `${actual.source_kind}:${actual.id}`)
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'Actual identity must include its source kind',
      });
    const lane =
      actual.medication_id === null
        ? `orphan:${actual.source_kind}:${actual.id}`
        : `medication:${actual.medication_id}`;
    if (actual.lane_id !== lane)
      context.addIssue({
        code: 'custom',
        path: ['lane_id'],
        message: 'Actual lanes must retain their recorded medication identity',
      });
  });

export const medicationLogWeekPlannedSlotSchema = z
  .object({
    id: z.string().min(1),
    lane_id: z.string().min(1),
    medication_id: nullableId,
    plan_kind: z.enum(['managed', 'legacy']),
    timezone: z.string().min(1),
    scheduled_day: day,
    scheduled_for: instant.nullable(),
    time_of_day: nullableText,
    status: z.enum(['planned', 'pending', 'missed', 'taken', 'skipped']),
    dose_amount: nullableText,
    dose_unit: nullableText,
    dose_qualification: z.enum([
      'configured',
      'future_phase_unknown',
      'unknown',
    ]),
    course_id: nullableId,
    course_revision_id: nullableId,
    course_rule_id: nullableId,
    course_step_id: nullableId,
    course_slot_key: nullableText,
    course_expected_version: z.number().int().positive().nullable(),
    schedule_id: nullableId,
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.plan_kind === 'managed') {
      if (
        !slot.course_id ||
        !slot.course_revision_id ||
        !slot.course_rule_id ||
        !slot.course_slot_key ||
        slot.id !== slot.course_slot_key ||
        slot.course_expected_version === null ||
        slot.schedule_id !== null
      )
        context.addIssue({
          code: 'custom',
          message: 'Managed slots require exact versioned attribution',
        });
    } else if (
      !slot.schedule_id ||
      slot.medication_id === null ||
      slot.status === 'missed' ||
      slot.course_id !== null ||
      slot.course_revision_id !== null ||
      slot.course_rule_id !== null ||
      slot.course_step_id !== null ||
      slot.course_slot_key !== null ||
      slot.course_expected_version !== null
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Current legacy schedules cannot acquire managed or missed history',
      });
    }
    const lane =
      slot.medication_id !== null
        ? `medication:${slot.medication_id}`
        : `course:${slot.course_id}`;
    if (slot.lane_id !== lane)
      context.addIssue({
        code: 'custom',
        path: ['lane_id'],
        message: 'Planned lanes require a known medication or explicit course',
      });
    if (slot.dose_qualification !== 'configured' && slot.dose_amount !== null)
      context.addIssue({
        code: 'custom',
        path: ['dose_amount'],
        message: 'Unknown future dose targets cannot assert an amount',
      });
  });

export const medicationLogWeekFulfilmentSchema = z
  .object({
    planned_id: z.string().min(1),
    actual: medicationLogWeekActualSchema,
  })
  .strict();
export const medicationLogWeekCoverageSchema = z
  .object({
    lane_id: z.string().min(1),
    course_id: nullableId,
    timezone: z.string().min(1),
    day,
    coverage: z.enum([
      'available',
      'partial',
      'unavailable',
      'current_schedule_only',
    ]),
  })
  .strict();

export const medicationLogWeekResponseSchema = z
  .object({
    as_of: instant,
    today: day,
    timezone: z.string().min(1),
    week_start: day,
    days: z.array(day).length(7),
    lanes: z.array(medicationLogWeekLaneSchema),
    planned_slots: z.array(medicationLogWeekPlannedSlotSchema),
    actuals: z.array(medicationLogWeekActualSchema),
    fulfilled_slots: z.array(medicationLogWeekFulfilmentSchema),
    coverage: z.array(medicationLogWeekCoverageSchema),
  })
  .strict()
  .superRefine((week, context) => {
    if (
      dayOfWeek(week.week_start) !== 1 ||
      week.days.some((date, index) => date !== addDays(week.week_start, index))
    )
      context.addIssue({
        code: 'custom',
        path: ['days'],
        message:
          'The calendar requires exactly seven consecutive Monday-first dates',
      });
    const days = new Set(week.days);
    const lanes = new Map(week.lanes.map((lane) => [lane.id, lane]));
    if (lanes.size !== week.lanes.length)
      context.addIssue({
        code: 'custom',
        path: ['lanes'],
        message: 'Calendar lanes must have distinct identities',
      });
    const actuals = new Map(week.actuals.map((actual) => [actual.key, actual]));
    if (actuals.size !== week.actuals.length)
      context.addIssue({
        code: 'custom',
        path: ['actuals'],
        message: 'Each actual appears once by source kind and ID',
      });
    for (const [index, actual] of week.actuals.entries())
      if (
        !days.has(actual.entry_date) ||
        !lanes.has(actual.lane_id) ||
        lanes.get(actual.lane_id)!.medication_id !== actual.medication_id
      )
        context.addIssue({
          code: 'custom',
          path: ['actuals', index],
          message: 'Actuals stay on their stored visible date and lane',
        });
    const planned = new Map(week.planned_slots.map((slot) => [slot.id, slot]));
    if (planned.size !== week.planned_slots.length)
      context.addIssue({
        code: 'custom',
        path: ['planned_slots'],
        message: 'Planned slots must have distinct canonical identities',
      });
    for (const [index, slot] of week.planned_slots.entries())
      if (
        !days.has(slot.scheduled_day) ||
        !lanes.has(slot.lane_id) ||
        lanes.get(slot.lane_id)!.medication_id !== slot.medication_id ||
        (slot.plan_kind === 'legacy' && slot.scheduled_day < week.today)
      )
        context.addIssue({
          code: 'custom',
          path: ['planned_slots', index],
          message:
            'Planned dates require visible lanes and no guessed legacy past',
        });
    const usedActual = new Set<string>(),
      usedPlanned = new Set<string>();
    for (const [index, link] of week.fulfilled_slots.entries()) {
      const slot = planned.get(link.planned_id),
        actual = link.actual;
      const managed =
        slot?.plan_kind === 'managed' &&
        actual.course_revision_id === slot.course_revision_id &&
        ((actual.course_rule_id === slot.course_rule_id &&
          actual.course_slot_key === slot.course_slot_key &&
          actual.scheduled_day === slot.scheduled_day) ||
          // Same-day fallback: a taken or skipped dose with the revision but no slot link.
          ((actual.status === 'taken' || actual.status === 'skipped') &&
            !actual.course_slot_key &&
            !actual.scheduled_day &&
            (!actual.course_rule_id ||
              actual.course_rule_id === slot.course_rule_id) &&
            actual.entry_date === slot.scheduled_day));
      const legacy =
        slot?.plan_kind === 'legacy' &&
        actual.course_origin !== true &&
        actual.course_revision_id === null &&
        actual.schedule_id === slot.schedule_id &&
        ((slot.scheduled_for !== null &&
          actual.scheduled_for !== null &&
          Date.parse(actual.scheduled_for) ===
            Date.parse(slot.scheduled_for)) ||
          (slot.scheduled_for === null &&
            actual.scheduled_for === null &&
            actual.scheduled_day === slot.scheduled_day));
      if (
        !slot ||
        (!managed && !legacy) ||
        actual.status === 'snoozed' ||
        slot.status !== (actual.status === 'skipped' ? 'skipped' : 'taken') ||
        usedActual.has(actual.key) ||
        usedPlanned.has(link.planned_id)
      )
        context.addIssue({
          code: 'custom',
          path: ['fulfilled_slots', index],
          message:
            'Fulfilment requires one exact explicit actual-to-slot relationship',
        });
      const visible = actuals.get(actual.key);
      if (
        (days.has(actual.entry_date) && !visible) ||
        (visible && JSON.stringify(visible) !== JSON.stringify(actual))
      )
        context.addIssue({
          code: 'custom',
          path: ['fulfilled_slots', index, 'actual'],
          message:
            'References must preserve the same actual snapshot without moving its date',
        });
      usedActual.add(actual.key);
      usedPlanned.add(link.planned_id);
    }
    for (const [index, coverage] of week.coverage.entries())
      if (
        !lanes.has(coverage.lane_id) ||
        !days.has(coverage.day) ||
        (coverage.course_id !== null &&
          coverage.coverage === 'current_schedule_only') ||
        (coverage.course_id === null &&
          coverage.day < week.today &&
          coverage.coverage !== 'unavailable')
      )
        context.addIssue({
          code: 'custom',
          path: ['coverage', index],
          message:
            'Coverage must preserve managed capture and unknown legacy history',
        });
  });

export type MedicationLogWeekQuery = z.infer<
  typeof medicationLogWeekQuerySchema
>;
export type MedicationInjectionRead = z.infer<
  typeof medicationInjectionReadSchema
>;
export type MedicationLogWeekLane = z.infer<typeof medicationLogWeekLaneSchema>;
export type MedicationLogWeekActual = z.infer<
  typeof medicationLogWeekActualSchema
>;
export type MedicationLogWeekPlannedSlot = z.infer<
  typeof medicationLogWeekPlannedSlotSchema
>;
export type MedicationLogWeekFulfilment = z.infer<
  typeof medicationLogWeekFulfilmentSchema
>;
export type MedicationLogWeekCoverage = z.infer<
  typeof medicationLogWeekCoverageSchema
>;
export type MedicationLogWeekResponse = z.infer<
  typeof medicationLogWeekResponseSchema
>;
