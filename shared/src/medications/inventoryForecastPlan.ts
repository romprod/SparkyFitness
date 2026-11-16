import type { MedicationCourse } from '../schemas/api/MedicationCourses.api.zod.ts';
import type { MedicationSyringeInput } from './draw.ts';
import type { CourseDeliveredDose } from './courseSchedules.ts';

export const INVENTORY_FORECAST_HORIZON_DAYS = 365;
export const INVENTORY_FORECAST_MAX_SLOTS = 800;
export type InventoryForecastLimitationCode =
  | 'no_managed_plan'
  | 'no_forecast_slots'
  | 'unmodelled_legacy_demand'
  | 'unknown_dose'
  | 'unsupported_unit'
  | 'missing_device'
  | 'incompatible_device'
  | 'unknown_stock'
  | 'unknown_bud'
  | 'sealed_stock_excluded'
  | 'unsupported_route'
  | 'blocked_draw'
  | 'preferred_device_basis'
  | 'date_out_of_range';
export interface InventoryForecastDevice {
  id: string;
  device: MedicationSyringeInput;
  basis: 'plan' | 'preferred';
}
/** A proved static legacy rule, never a fabricated managed revision or phase history. */
export interface InventoryForecastLegacyPlan {
  id: string;
  rule: import('./schedules.ts').SharedScheduleRule;
  dose_amount: string | null;
  dose_unit: string | null;
  timezone: string;
  device: InventoryForecastDevice | null;
}
export interface InventoryForecastLegacyActual {
  id: string;
  schedule_id: string | null;
  entry_date: string;
  scheduled_day?: string | null;
  scheduled_for?: string | null;
  status: string;
  course_origin?: boolean;
}
export interface InventoryForecastPlanInput {
  today: string;
  now: string;
  timezone: string;
  medication_active: boolean;
  route: 'injection' | 'nasal' | null;
  courses: MedicationCourse[];
  actuals: CourseDeliveredDose[];
  /** Keys are revision IDs; values are real saved devices, never an invented fallback. */
  devices: Readonly<Record<string, InventoryForecastDevice | null>>;
  legacy_plans?: InventoryForecastLegacyPlan[];
  legacy_actuals?: InventoryForecastLegacyActual[];
  /** Backend records active demand it cannot truthfully map to a supported plan. */
  limitations?: InventoryForecastLimitationCode[];
}
export interface InventoryForecastSlot {
  key: string;
  plan_id: string;
  plan_kind: 'course_revision' | 'legacy_schedule';
  rule_id: string;
  day: string;
  scheduled_at: string | null;
  /** Ephemeral ordering instant; untimed slots remain scheduled_at:null. */
  sort_at: number;
  value: string | null;
  unit: string | null;
  step_id: string | null;
  device: InventoryForecastDevice | null;
  status: 'pending' | 'projected';
}
export interface InventoryForecastPlan {
  slots: InventoryForecastSlot[];
  current_targets?: InventoryForecastSlot[];
  basis: 'course_end' | 'horizon' | 'slot_cap';
  coverage_end: string | null;
  limitations: InventoryForecastLimitationCode[];
}

import { Decimal } from 'decimal.js';
import {
  addDays,
  dayOfWeek,
  dayToUtcRange,
  instantToDay,
  localDateTimeToUtc,
} from '../utils/timezone.ts';
import { courseEntryMatchesSlot } from './courseAdherence.ts';
import {
  courseSlotsForDay,
  type CourseExpectedSlot,
} from './courseSchedules.ts';
import { courseCurrentPhase, coursePerDoseAmount } from './courseRevisions.ts';
import { isScheduleDueOnDate } from './schedules.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
interface RawForecastSlot {
  key: string;
  course_id: string;
  revision_id: string;
  rule_index: number;
  day: string;
  at: string | null;
  sort_at: number;
  managed: CourseExpectedSlot | null;
  legacy: InventoryForecastLegacyPlan | null;
  match: CourseDeliveredDose | InventoryForecastLegacyActual | null;
  status: 'taken' | 'skipped' | 'missed' | 'pending' | 'projected';
}
const taken = (status: string) => status === 'taken' || status === 'prn_taken';
const unique = <T extends { id: string }>(rows: T[]): T[] => [
  ...new Map(rows.map((row) => [row.id, row])).values(),
];
function positive(value: string | null): boolean {
  try {
    const d = new D(value ?? '');
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
}
function legacyMatches(
  entry: InventoryForecastLegacyActual,
  slot: RawForecastSlot
): boolean {
  if (entry.course_origin || entry.schedule_id !== slot.legacy?.id)
    return false;
  if (entry.scheduled_for && /^\d{4}-\d{2}-\d{2}T/.test(entry.scheduled_for))
    return (
      slot.at !== null &&
      Date.parse(entry.scheduled_for) === Date.parse(slot.at)
    );
  const day =
    entry.scheduled_day ??
    (entry.scheduled_for && /^\d{4}-\d{2}-\d{2}$/.test(entry.scheduled_for)
      ? entry.scheduled_for
      : null);
  return day !== null && day === slot.day;
}
function bindingFor(
  input: InventoryForecastPlanInput,
  revision: MedicationCourse['revisions'][number]
): InventoryForecastDevice | null {
  const binding = input.devices[revision.id] ?? null;
  if (
    revision.device_choice === 'explicit' &&
    (!revision.device_id || binding?.id !== revision.device_id)
  )
    return null;
  return binding;
}
/** Separate projection cursor: no authored plan, actual log or Today phase is mutated. */
export function buildInventoryForecastPlan(
  input: InventoryForecastPlanInput
): InventoryForecastPlan {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new RangeError('Invalid forecast instant');
  const limitations = new Set(input.limitations ?? []);
  const horizon = addDays(input.today, INVENTORY_FORECAST_HORIZON_DAYS);
  const first = addDays(input.today, -dayOfWeek(input.today));
  const raw: RawForecastSlot[] = [];
  const actuals = unique(input.actuals);
  const legacyActuals = unique(input.legacy_actuals ?? []);
  const revisions = new Map(
    input.courses.flatMap((course) =>
      course.revisions.map((revision) => [revision.id, revision] as const)
    )
  );
  const eligible = new Set<string>();
  for (const course of input.courses) {
    if (course.deleted_at !== null) continue;
    for (const revision of course.revisions) {
      if (revision.deleted_at !== null) continue;
      const localToday = instantToDay(input.now, course.timezone);
      const successor = course.revisions.find(
        (item) => item.predecessor_id === revision.id
      );
      if (
        [
          revision.end_date,
          revision.closed_date,
          successor?.start_date ? addDays(successor.start_date, -1) : null,
        ].some((end) => end != null && end < localToday)
      )
        continue;
      if (
        revision.status === 'active' ||
        revision.activity.some((interval) => {
          const end =
            interval.until_at === null
              ? Infinity
              : Date.parse(interval.until_at);
          return end > now && Date.parse(interval.from_at) < end;
        })
      )
        eligible.add(revision.id);
    }
  }
  const legacy = (input.legacy_plans ?? []).filter(
    (plan) =>
      plan.rule.active !== false &&
      (!plan.rule.end_date ||
        plan.rule.end_date >= instantToDay(input.now, plan.timezone))
  );
  let finite = true,
    hasPlan = false;
  if (input.medication_active) {
    for (const course of input.courses) {
      for (const revision of course.revisions) {
        if (!eligible.has(revision.id)) continue;
        hasPlan = true;
        const successor = course.revisions.find(
          (item) => item.predecessor_id === revision.id
        );
        for (const rule of revision.rules) {
          if (
            rule.end_date &&
            rule.end_date < instantToDay(input.now, course.timezone)
          )
            continue;
          if (rule.schedule_type_id === 'prn') {
            limitations.add('unmodelled_legacy_demand');
            continue;
          }
          const ends = [
            revision.end_date,
            revision.closed_date,
            rule.end_date,
            successor?.start_date ? addDays(successor.start_date, -1) : null,
          ].filter((day): day is string => day != null);
          if (
            revision.activity.length &&
            revision.activity.every((interval) => interval.until_at !== null)
          ) {
            const end = Math.max(
              ...revision.activity.map((interval) =>
                Date.parse(interval.until_at!)
              )
            );
            const finalInstant = new Date(end - 1).toISOString();
            ends.push(instantToDay(finalInstant, course.timezone));
          }
          if (!ends.length || ends.sort()[0]! > horizon) finite = false;
        }
      }
    }
    for (const plan of legacy) {
      hasPlan = true;
      if (plan.rule.schedule_type_id === 'prn')
        limitations.add('unmodelled_legacy_demand');
      if (!plan.rule.end_date || plan.rule.end_date > horizon) finite = false;
    }
    for (let day = first; day <= horizon; day = addDays(day, 1)) {
      for (const course of input.courses) {
        for (const slot of courseSlotsForDay({
          course,
          day,
          today: input.today,
          nowInstant: input.now,
          medicationActive: true,
          delivered: actuals,
        })) {
          if (!eligible.has(slot.course_revision_id)) continue;
          const revision = revisions.get(slot.course_revision_id)!;
          const rule = revision.rules.find(
            (item) => item.id === slot.course_rule_id
          )!;
          if (
            rule.end_date &&
            rule.end_date < instantToDay(input.now, course.timezone)
          )
            continue;
          raw.push({
            key: slot.course_slot_key,
            course_id: course.id,
            revision_id: revision.id,
            rule_index: rule.rule_index,
            day: slot.scheduled_day,
            at: slot.scheduled_for,
            sort_at:
              slot.scheduled_for === null
                ? dayToUtcRange(day, course.timezone).start.getTime()
                : Date.parse(slot.scheduled_for),
            managed: slot,
            legacy: null,
            match: null,
            status: 'pending',
          });
        }
      }
      for (const plan of legacy) {
        if (
          plan.rule.schedule_type_id === 'prn' ||
          (!plan.rule.start_date &&
            !!plan.rule.created_at &&
            day < instantToDay(plan.rule.created_at, plan.timezone)) ||
          !isScheduleDueOnDate(plan.rule, day)
        )
          continue;
        const time = plan.rule.time_of_day;
        const at = time
          ? new Date(
              localDateTimeToUtc(
                `${day}T${time.slice(0, 5)}`,
                plan.timezone
              ).getTime() +
                Number(time.slice(6, 8) || 0) * 1000
            ).toISOString()
          : null;
        raw.push({
          key: JSON.stringify(['legacy', plan.id, day, time ?? null]),
          course_id: `legacy:${plan.id}`,
          revision_id: plan.id,
          rule_index: 0,
          day,
          at,
          sort_at:
            at === null
              ? dayToUtcRange(day, plan.timezone).start.getTime()
              : Date.parse(at),
          managed: null,
          legacy: plan,
          match: null,
          status: 'pending',
        });
      }
    }
  }
  raw.sort(
    (a, b) =>
      a.sort_at - b.sort_at ||
      a.course_id.localeCompare(b.course_id) ||
      a.rule_index - b.rule_index ||
      a.key.localeCompare(b.key)
  );
  const consumed = new Set<string>();
  for (const slot of raw) {
    const candidates = slot.managed
      ? actuals.filter(
          (entry) =>
            !consumed.has(entry.id) &&
            courseEntryMatchesSlot(entry, slot.managed!)
        )
      : legacyActuals.filter(
          (entry) =>
            !entry.course_origin &&
            !consumed.has(entry.id) &&
            legacyMatches(entry, slot)
        );
    const match =
      candidates.find((entry) => entry.status === 'skipped') ??
      candidates.find(
        (entry) =>
          taken(entry.status) && (!slot.legacy || entry.status !== 'prn_taken')
      ) ??
      null;
    if (match) {
      slot.match = match;
      consumed.add(match.id);
      slot.status = match.status === 'skipped' ? 'skipped' : 'taken';
    }
  }
  // Distinct simultaneous rules remain separate demand; only a strictly later
  // authored instant closes their pending window. Ties retain authored rule order.
  const nextByCourse = new Map<
    string,
    { slot: RawForecastSlot; later: RawForecastSlot | undefined }
  >();
  for (let index = raw.length - 1; index >= 0; index--) {
    const slot = raw[index]!;
    if (!slot.match) {
      const group = nextByCourse.get(slot.course_id);
      const next =
        group?.slot.sort_at === slot.sort_at ? group.later : group?.slot;
      slot.status =
        slot.sort_at > now
          ? 'projected'
          : next && next.sort_at <= now
            ? 'missed'
            : 'pending';
    }
    const group = nextByCourse.get(slot.course_id);
    nextByCourse.set(slot.course_id, {
      slot,
      later: group?.slot.sort_at === slot.sort_at ? group.later : group?.slot,
    });
  }
  if (
    legacy.length &&
    legacyActuals.some(
      (entry) =>
        !entry.course_origin &&
        entry.schedule_id === null &&
        (entry.status === 'taken' || entry.status === 'skipped') &&
        entry.entry_date.slice(0, 10) >= first &&
        entry.entry_date.slice(0, 10) <= horizon
    )
  )
    limitations.add('unmodelled_legacy_demand');
  if (
    legacy.length &&
    legacyActuals.some(
      (entry) =>
        !entry.course_origin &&
        !consumed.has(entry.id) &&
        (entry.status === 'taken' || entry.status === 'skipped') &&
        legacy.some((plan) => plan.id === entry.schedule_id) &&
        (entry.scheduled_day ??
          entry.scheduled_for?.slice(0, 10) ??
          entry.entry_date.slice(0, 10)) >= first &&
        (entry.scheduled_day ??
          entry.scheduled_for?.slice(0, 10) ??
          entry.entry_date.slice(0, 10)) <= horizon
    )
  )
    limitations.add('unmodelled_legacy_demand');
  const matchedTaken = new Set(
    raw.filter((slot) => slot.status === 'taken').map((slot) => slot.match!.id)
  );
  const adHoc = actuals.filter(
    (entry) => taken(entry.status) && !matchedTaken.has(entry.id)
  );
  const prior = new Map<string, number>();
  const projected: InventoryForecastSlot[] = [];
  const targets = new Map<string, InventoryForecastSlot>();
  for (const slot of raw) {
    const revision = revisions.get(slot.revision_id);
    const cursorKey = (slot.legacy ? 'legacy:' : 'course:') + slot.revision_id;
    let value: string | null = null,
      unit: string | null = null,
      step: string | null = null,
      device: InventoryForecastDevice | null = null;
    if (slot.managed && revision) {
      const adHocBefore = adHoc.filter(
        (entry) =>
          entry.course_revision_id === revision.id &&
          (entry.entry_date.slice(0, 10) < slot.day ||
            (entry.entry_date.slice(0, 10) === slot.day &&
              slot.at !== null &&
              entry.occurred_at != null &&
              Date.parse(entry.occurred_at) < slot.sort_at))
      ).length;
      const phase = courseCurrentPhase({
        revision,
        deliveredCount: adHocBefore + (prior.get(cursorKey) ?? 0),
      });
      const rule = revision.rules.find(
        (item) => item.id === slot.managed!.course_rule_id
      )!;
      value = coursePerDoseAmount(
        rule.dose_amount ?? phase.authored_dose,
        revision.dose_basis,
        phase.injections_per_week
      );
      unit = rule.dose_amount != null ? revision.dose_unit : phase.dose_unit;
      step = phase.step_id;
      device = bindingFor(input, revision);
    } else if (slot.legacy) {
      value = slot.legacy.dose_amount;
      unit = slot.legacy.dose_unit;
      device = slot.legacy.device;
    }
    if (slot.status === 'pending' || slot.status === 'projected') {
      if (!positive(value)) limitations.add('unknown_dose');
      if (
        unit === null ||
        !['mcg', 'ug', 'µg', 'μg', 'mg', 'g', 'ml', 'units', 'pumps'].includes(
          unit.trim().toLowerCase()
        )
      )
        limitations.add('unsupported_unit');
      if (!device) limitations.add('missing_device');
      else if (device.basis === 'preferred')
        limitations.add('preferred_device_basis');
      const day =
        slot.at === null ? slot.day : instantToDay(slot.at, input.timezone);
      const candidate: InventoryForecastSlot = {
        key: slot.key,
        plan_id: slot.revision_id,
        plan_kind: slot.legacy ? 'legacy_schedule' : 'course_revision',
        rule_id: slot.managed?.course_rule_id ?? slot.legacy!.id,
        day,
        scheduled_at: slot.at,
        sort_at: slot.sort_at,
        value,
        unit,
        step_id: step,
        device,
        status: slot.status,
      };
      projected.push(candidate);
      const targetKey = `${candidate.plan_kind}:${candidate.plan_id}:${candidate.rule_id}`;
      if (!targets.has(targetKey))
        targets.set(targetKey, {
          ...candidate,
          value: slot.managed ? slot.managed.per_dose_amount : value,
          unit: slot.managed ? slot.managed.dose_unit : unit,
          step_id: slot.managed ? slot.managed.course_step_id : step,
        });
    }
    if (
      slot.status === 'taken' ||
      slot.status === 'projected' ||
      slot.status === 'pending'
    )
      prior.set(cursorKey, (prior.get(cursorKey) ?? 0) + 1);
  }
  if (!hasPlan) limitations.add('no_managed_plan');
  if (!projected.length) limitations.add('no_forecast_slots');
  const capped = projected.slice(0, INVENTORY_FORECAST_MAX_SLOTS);
  // Unknown late demand after the cap cannot justify inventing a claim beyond it.
  const basis =
    projected.length >= INVENTORY_FORECAST_MAX_SLOTS
      ? 'slot_cap'
      : finite
        ? 'course_end'
        : 'horizon';
  return {
    slots: capped,
    current_targets: [...targets.values()],
    basis,
    coverage_end: capped.at(-1)?.day ?? null,
    limitations: [...limitations],
  };
}
