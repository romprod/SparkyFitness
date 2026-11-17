import { Decimal } from 'decimal.js';
import type { MedicationCourse } from '../schemas/api/MedicationCourses.api.zod.ts';
import type {
  MedicationLogWeekActual,
  MedicationLogWeekCoverage,
  MedicationLogWeekFulfilment,
  MedicationLogWeekLane,
  MedicationLogWeekPlannedSlot,
  MedicationLogWeekResponse,
} from '../schemas/api/MedicationLogWeek.api.zod.ts';
import {
  addDays,
  dayOfWeek,
  dayToUtcRange,
  instantHourMinute,
  instantToDay,
  isDayString,
  localDateTimeToUtc,
} from '../utils/timezone.ts';
import { computeCourseAdherence } from './courseAdherence.ts';
import type {
  CourseDeliveredDose,
  CourseExpectedSlot,
} from './courseSchedules.ts';
import { getDueDosesForDate, type SharedScheduleRule } from './schedules.ts';

export interface MedicationWeekMedicationFacts {
  id: string;
  name: string;
  is_active: boolean;
  is_supplement: boolean | null;
  dose_amount: string | null;
  dose_unit: string | null;
}
export type MedicationWeekLegacyScheduleFacts = Omit<
  SharedScheduleRule,
  'dose_amount'
> & { id: string; medication_id: string; dose_amount: string | null };
export type MedicationWeekActualFacts = Omit<
  MedicationLogWeekActual,
  'key' | 'lane_id'
>;
export interface MedicationLogWeekInput {
  as_of: string;
  today: string;
  timezone: string;
  week_start?: string;
  medications: MedicationWeekMedicationFacts[];
  courses: MedicationCourse[];
  managed_actuals: CourseDeliveredDose[];
  phase_actuals: CourseDeliveredDose[];
  legacy_schedules: MedicationWeekLegacyScheduleFacts[];
  /** Full recorded summaries; only visible dates and exact fulfilment references leave the builder. */
  actuals: MedicationWeekActualFacts[];
}
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const medicationWeekStart = (day: string): string => {
  if (!isDayString(day)) throw new RangeError('Invalid week day');
  const start = addDays(day, -((dayOfWeek(day) + 6) % 7));
  if (!isDayString(start) || !isDayString(addDays(start, 6)))
    throw new RangeError('Unsupported week range');
  return start;
};
const actualKey = (
  row: Pick<MedicationWeekActualFacts, 'source_kind' | 'id'>
) => `${row.source_kind}:${row.id}`;
function delivered(rows: CourseDeliveredDose[]): CourseDeliveredDose[] {
  return [
    ...new Map(
      rows.map((row) => {
        const prefix = row.source_kind ? row.source_kind + ':' : null;
        const id =
          prefix && !row.id.startsWith(prefix) ? prefix + row.id : row.id;
        return [id, { ...row, id }];
      })
    ).values(),
  ];
}
function configured(
  value: string | null,
  unit: string | null
): { amount: string | null; unit: string | null } {
  const knownUnit = unit !== null && unit.trim() !== '' ? unit : null;
  try {
    const number = new D(value ?? '');
    return {
      amount:
        knownUnit && number.isFinite() && number.gt(0)
          ? number.toString()
          : null,
      unit: knownUnit,
    };
  } catch {
    return { amount: null, unit: knownUnit };
  }
}
function actual(row: MedicationWeekActualFacts): MedicationLogWeekActual {
  // Deliberate bounded projection: a full injection row cannot accidentally leak
  // physical correction state into the weekly read or become a fabricated default.
  return {
    key: actualKey(row),
    id: row.id,
    source_kind: row.source_kind,
    lane_id:
      row.medication_id === null
        ? `orphan:${actualKey(row)}`
        : `medication:${row.medication_id}`,
    medication_id: row.medication_id,
    medication_name: row.medication_name,
    status: row.status,
    entry_date: row.entry_date,
    occurred_at: row.occurred_at,
    dose_amount: row.dose_amount,
    dose_unit: row.dose_unit,
    dose_mg_exact: row.dose_mg_exact,
    schedule_id: row.schedule_id,
    course_origin: row.course_origin,
    course_revision_id: row.course_revision_id,
    course_rule_id: row.course_rule_id,
    course_step_id: row.course_step_id,
    course_slot_key: row.course_slot_key,
    scheduled_day: row.scheduled_day,
    scheduled_for: row.scheduled_for,
    notes: row.notes,
    site: row.site,
    administration_route: row.administration_route,
  };
}
function future(
  slot: CourseExpectedSlot,
  asOf: string,
  timezone: string
): boolean {
  return slot.scheduled_for === null
    ? slot.scheduled_day >= instantToDay(asOf, timezone)
    : Date.parse(slot.scheduled_for) > Date.parse(asOf);
}
/** Amount uncertainty is not a phase simulator. Course steps cannot alter recurrence timing. */
function plannedDose(
  course: MedicationCourse,
  slot: CourseExpectedSlot,
  asOf: string
) {
  const revision = course.revisions.find(
    (row) => row.id === slot.course_revision_id
  )!;
  const rule = revision.rules.find((row) => row.id === slot.course_rule_id)!;
  const base = configured(slot.per_dose_amount, slot.dose_unit);
  let unknownFuture = false,
    unit = base.unit,
    step = slot.course_step_id;
  if (future(slot, asOf, course.timezone) && revision.steps.length) {
    const ordered = [...revision.steps].sort(
      (a, b) => a.step_index - b.step_index
    );
    const index = ordered.findIndex((row) => row.id === slot.course_step_id);
    const remaining = index < 0 ? ordered : ordered.slice(index);
    if (remaining.length > 1 || index < 0) step = null;
    if (rule.dose_amount === null || rule.dose_amount === undefined) {
      const first = remaining[0];
      if (!first || remaining.some((row) => row.dose_unit !== first.dose_unit))
        unit = null;
      unknownFuture =
        index < 0 ||
        !first ||
        remaining.some(
          (row) =>
            row.dose_unit !== first.dose_unit || !new D(row.dose).eq(first.dose)
        );
    }
  }
  return {
    dose_amount: unknownFuture ? null : base.amount,
    dose_unit: unit,
    dose_qualification: unknownFuture
      ? ('future_phase_unknown' as const)
      : base.amount === null
        ? ('unknown' as const)
        : ('configured' as const),
    course_step_id: step,
  };
}
function legacyMatches(
  row: MedicationLogWeekActual,
  slot: MedicationLogWeekPlannedSlot
): boolean {
  if (
    row.course_origin === true ||
    row.course_revision_id !== null ||
    row.schedule_id !== slot.schedule_id
  )
    return false;
  return slot.scheduled_for !== null
    ? row.scheduled_for !== null &&
        Date.parse(row.scheduled_for) === Date.parse(slot.scheduled_for)
    : row.scheduled_for === null && row.scheduled_day === slot.scheduled_day;
}
export function buildMedicationLogWeek(
  input: MedicationLogWeekInput
): MedicationLogWeekResponse {
  if (!isDayString(input.today) || !Number.isFinite(Date.parse(input.as_of)))
    throw new RangeError('Invalid week snapshot');
  const weekStart = input.week_start ?? medicationWeekStart(input.today);
  if (
    !isDayString(weekStart) ||
    dayOfWeek(weekStart) !== 1 ||
    !isDayString(addDays(weekStart, 6))
  )
    throw new RangeError('Week start must be a supported Monday');
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    visible = new Set(days);
  const medications = new Map(input.medications.map((row) => [row.id, row]));
  const allActuals = [
    ...new Map(
      input.actuals.map((row) => [actualKey(row), actual(row)])
    ).values(),
  ];
  const byActual = new Map(allActuals.map((row) => [row.key, row]));
  const original = delivered(input.managed_actuals),
    phase = delivered(input.phase_actuals);
  const lanes = new Map<string, MedicationLogWeekLane>(),
    planned: MedicationLogWeekPlannedSlot[] = [],
    coverage: MedicationLogWeekCoverage[] = [],
    links: MedicationLogWeekFulfilment[] = [];
  const usedActual = new Set<string>(),
    usedPlanned = new Set<string>();
  const lane = (
    id: string,
    medicationId: string | null,
    name: string | null
  ) => {
    const med =
      medicationId === null ? undefined : medications.get(medicationId);
    if (!lanes.has(id))
      lanes.set(id, {
        id,
        medication_id: medicationId,
        name: med?.name ?? name ?? '',
        is_supplement: med?.is_supplement ?? null,
      });
  };
  const fulfil = (
    slot: MedicationLogWeekPlannedSlot,
    row: MedicationLogWeekActual | undefined
  ) => {
    if (!row || usedActual.has(row.key) || row.status === 'snoozed') return;
    usedActual.add(row.key);
    slot.status = row.status === 'skipped' ? 'skipped' : 'taken';
    links.push({ planned_id: slot.id, actual: row });
  };
  for (const course of input.courses) {
    if (course.deleted_at !== null) continue;
    const laneId =
      course.medication_id === null
        ? `course:${course.id}`
        : `medication:${course.medication_id}`;
    lane(laneId, course.medication_id, course.medication_name_snapshot);
    // A wholly pre-capture week has no managed expectations. Avoid asking the
    // canonical scorer to scan unsupported centuries through the current day.
    if (
      dayToUtcRange(days[6]!, course.timezone).end.getTime() <=
      Date.parse(course.captured_at)
    ) {
      for (const day of days)
        coverage.push({
          lane_id: laneId,
          course_id: course.id,
          timezone: course.timezone,
          day,
          coverage: 'unavailable',
        });
      continue;
    }
    const score = computeCourseAdherence({
      course,
      entries: original,
      phaseEntries: phase,
      fromDay: weekStart,
      toDay: days[6]!,
      today: instantToDay(input.as_of, course.timezone),
      now: input.as_of,
      medicationActive:
        course.medication_id !== null &&
        medications.get(course.medication_id)?.is_active === true,
    });
    for (const day of score.days) {
      coverage.push({
        lane_id: laneId,
        course_id: course.id,
        timezone: course.timezone,
        day: day.date,
        coverage: day.coverage,
      });
      for (const expected of day.slots) {
        if (usedPlanned.has(expected.course_slot_key)) continue;
        usedPlanned.add(expected.course_slot_key);
        const slot: MedicationLogWeekPlannedSlot = {
          id: expected.course_slot_key,
          lane_id: laneId,
          medication_id: course.medication_id,
          plan_kind: 'managed',
          timezone: course.timezone,
          scheduled_day: expected.scheduled_day,
          scheduled_for: expected.scheduled_for,
          time_of_day: expected.time_of_day,
          status:
            expected.status === 'pending' &&
            (expected.scheduled_day >
              instantToDay(input.as_of, course.timezone) ||
              (expected.scheduled_for !== null &&
                Date.parse(expected.scheduled_for) > Date.parse(input.as_of)))
              ? 'planned'
              : expected.status,
          ...plannedDose(course, expected, input.as_of),
          course_id: course.id,
          course_revision_id: expected.course_revision_id,
          course_rule_id: expected.course_rule_id,
          course_slot_key: expected.course_slot_key,
          course_expected_version: expected.course_expected_version,
          schedule_id: null,
        };
        if (expected.entry_id !== null)
          fulfil(slot, byActual.get(expected.entry_id));
        planned.push(slot);
      }
    }
  }
  const legacyCoverage = new Set<string>();
  for (const schedule of input.legacy_schedules) {
    const med = medications.get(schedule.medication_id);
    if (!med) continue;
    const laneId = `medication:${schedule.medication_id}`;
    lane(laneId, med.id, med.name);
    if (!legacyCoverage.has(laneId)) {
      legacyCoverage.add(laneId);
      for (const day of days)
        coverage.push({
          lane_id: laneId,
          course_id: null,
          timezone: input.timezone,
          day,
          coverage: day < input.today ? 'unavailable' : 'current_schedule_only',
        });
    }
    const { dose_amount: override, ...rule } = schedule;
    for (const day of days) {
      if (
        day < input.today ||
        getDueDosesForDate(
          [{ id: med.id, is_active: med.is_active, schedules: [rule] }],
          day,
          input.timezone
        ).length === 0
      )
        continue;
      const time = schedule.time_of_day
        ? schedule.time_of_day.length === 5
          ? schedule.time_of_day + ':00'
          : schedule.time_of_day
        : null;
      const at =
        time === null
          ? null
          : new Date(
              localDateTimeToUtc(
                `${day}T${time.slice(0, 5)}`,
                input.timezone
              ).getTime() +
                Number(time.slice(6, 8) || 0) * 1000
            ).toISOString();
      const id = JSON.stringify(['legacy', schedule.id, day, time]);
      if (usedPlanned.has(id)) continue;
      usedPlanned.add(id);
      const dose = configured(override ?? med.dose_amount, med.dose_unit);
      const slot: MedicationLogWeekPlannedSlot = {
        id,
        lane_id: laneId,
        medication_id: med.id,
        plan_kind: 'legacy',
        timezone: input.timezone,
        scheduled_day: day,
        scheduled_for: at,
        time_of_day: time,
        status:
          day > input.today ||
          (at !== null && Date.parse(at) > Date.parse(input.as_of))
            ? 'planned'
            : 'pending',
        dose_amount: dose.amount,
        dose_unit: dose.unit,
        dose_qualification: dose.amount === null ? 'unknown' : 'configured',
        course_id: null,
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
        course_expected_version: null,
        schedule_id: schedule.id,
      };
      const candidates = allActuals.filter(
        (row) => !usedActual.has(row.key) && legacyMatches(row, slot)
      );
      fulfil(
        slot,
        candidates.find((row) => row.status === 'skipped') ??
          candidates.find(
            (row) => row.status === 'taken' || row.status === 'prn_taken'
          )
      );
      planned.push(slot);
    }
  }
  const actuals = allActuals.filter((row) => visible.has(row.entry_date));
  for (const row of actuals)
    lane(row.lane_id, row.medication_id, row.medication_name);
  const actualClock = (row: MedicationLogWeekActual) => {
    if (row.occurred_at === null) return Infinity;
    const clock = instantHourMinute(row.occurred_at, input.timezone);
    return clock.hour * 60 + clock.minute;
  };
  actuals.sort(
    (a, b) =>
      a.entry_date.localeCompare(b.entry_date) ||
      actualClock(a) - actualClock(b) ||
      a.key.localeCompare(b.key)
  );
  planned.sort(
    (a, b) =>
      a.scheduled_day.localeCompare(b.scheduled_day) ||
      (a.time_of_day ?? '99:99').localeCompare(b.time_of_day ?? '99:99') ||
      a.id.localeCompare(b.id)
  );
  return {
    as_of: input.as_of,
    today: input.today,
    timezone: input.timezone,
    week_start: weekStart,
    days,
    lanes: [...lanes.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    ),
    planned_slots: planned,
    actuals,
    fulfilled_slots: links,
    coverage,
  };
}

export type MedicationWeekCellItem =
  | {
      kind: 'actual';
      actual: MedicationLogWeekActual;
      planned: MedicationLogWeekPlannedSlot | null;
    }
  | {
      kind: 'planned' | 'fulfilled_reference';
      planned: MedicationLogWeekPlannedSlot;
      actual: MedicationLogWeekActual | null;
    };
/** Same-cell merges use the actual snapshot; cross-day/lane links remain references, never moved glyphs. */
export function medicationWeekCellItems(
  week: MedicationLogWeekResponse,
  day: string,
  laneId: string
): MedicationWeekCellItem[] {
  const links = new Map(
    week.fulfilled_slots.map((link) => [link.planned_id, link.actual])
  );
  const slots = week.planned_slots.filter(
    (slot) => slot.scheduled_day === day && slot.lane_id === laneId
  );
  const actuals = week.actuals.filter(
    (row) => row.entry_date === day && row.lane_id === laneId
  );
  const items: MedicationWeekCellItem[] = actuals.map((row) => ({
    kind: 'actual',
    actual: row,
    planned: slots.find((slot) => links.get(slot.id)?.key === row.key) ?? null,
  }));
  for (const slot of slots) {
    const row = links.get(slot.id) ?? null;
    if (row && actuals.some((actual) => actual.key === row.key)) continue;
    items.push({
      kind: row ? 'fulfilled_reference' : 'planned',
      planned: slot,
      actual: row,
    });
  }
  const clock = (item: MedicationWeekCellItem) => {
    if (item.kind === 'actual') {
      if (item.actual.occurred_at === null) return 1440;
      const time = instantHourMinute(item.actual.occurred_at, week.timezone);
      return time.hour * 60 + time.minute;
    }
    const time = item.planned.time_of_day;
    return time === null
      ? 1440
      : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  };
  return items.sort((a, b) => clock(a) - clock(b));
}
