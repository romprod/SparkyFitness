import { Decimal } from 'decimal.js';
import { addDays } from '../utils/timezone.ts';
import type {
  MedicationCoursePlanInput,
  MedicationCourseRevision,
  MedicationCourseRuleInput,
  MedicationCourseStepInput,
} from '../schemas/api/MedicationCourses.api.zod.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function canonicalCourseDecimal(value: string): string {
  const number = new D(value);
  if (!number.isFinite() || !number.gt(0))
    throw new RangeError('Invalid positive course dose');
  return number.toString();
}
export type CourseIndexedStep = MedicationCourseStepInput & {
  step_index: number;
};
type MaterialPlan = Pick<
  MedicationCoursePlanInput,
  'rules' | 'dose_basis' | 'start_date'
> & {
  cycle_anchor_date?: string | null;
  steps: (MedicationCourseStepInput & { step_index?: number })[];
};
/** Dose values, labels, notes, reminder-only preferences and planned end are source corrections. */
export function courseMaterialChanges(
  before: MaterialPlan,
  after: MaterialPlan
): ('schedule' | 'dose_basis' | 'start_date' | 'steps')[] {
  const cadence = (plan: MaterialPlan) =>
    JSON.stringify(
      plan.rules.map((rule) => ({
        type: rule.schedule_type_id,
        time:
          rule.schedule_type_id === 'prn'
            ? null
            : rule.time_of_day
              ? rule.time_of_day.length === 5
                ? rule.time_of_day + ':00'
                : rule.time_of_day
              : null,
        days:
          rule.schedule_type_id === 'weekly' ||
          rule.schedule_type_id === 'specific_days'
            ? [...new Set(rule.days_of_week ?? [])].sort((a, b) => a - b)
            : [],
        interval:
          rule.schedule_type_id === 'every_n_days'
            ? (rule.interval_days ?? null)
            : null,
        month_day:
          rule.schedule_type_id === 'monthly'
            ? (rule.day_of_month ?? null)
            : null,
        cycle_on:
          rule.schedule_type_id === 'cyclic'
            ? (rule.cycle_on_days ?? null)
            : null,
        cycle_off:
          rule.schedule_type_id === 'cyclic'
            ? (rule.cycle_off_days ?? null)
            : null,
        start: rule.start_date ?? null,
        anchor:
          rule.schedule_type_id === 'cyclic'
            ? (plan.cycle_anchor_date ??
              rule.anchor_date ??
              rule.start_date ??
              plan.start_date)
            : rule.schedule_type_id === 'every_n_days'
              ? (rule.anchor_date ?? rule.start_date ?? plan.start_date)
              : null,
      }))
    );
  const steps = (plan: MaterialPlan) =>
    JSON.stringify(
      plan.steps
        .map((step, index) => ({
          index: step.step_index ?? index,
          duration: step.duration_days,
        }))
        .sort((a, b) => a.index - b.index)
    );
  const changes: ReturnType<typeof courseMaterialChanges> = [];
  if (cadence(before) !== cadence(after)) changes.push('schedule');
  if (before.dose_basis !== after.dose_basis) changes.push('dose_basis');
  if (before.start_date !== after.start_date) changes.push('start_date');
  if (steps(before) !== steps(after)) changes.push('steps');
  return changes;
}
/** Only constant, unambiguous authored recurrence maps to a weekly dose count. */
export function courseInjectionsPerWeek(
  rules: MedicationCourseRuleInput[],
  window?: { start_date: string | null; end_date: string | null }
): number | null {
  if (!rules.length) return null;
  let frequency = new D(0);
  for (const rule of rules) {
    if (
      (rule.start_date != null &&
        (!window?.start_date || rule.start_date > window.start_date)) ||
      (rule.end_date != null &&
        (!window?.end_date || rule.end_date < window.end_date))
    )
      return null;
    if (rule.schedule_type_id === 'daily' || rule.schedule_type_id === 'taper')
      frequency = frequency.plus(7);
    else if (
      rule.schedule_type_id === 'weekly' ||
      rule.schedule_type_id === 'specific_days'
    ) {
      const days = new Set(rule.days_of_week ?? []);
      if (!days.size) return null;
      frequency = frequency.plus(days.size);
    } else if (
      rule.schedule_type_id === 'every_n_days' &&
      rule.interval_days &&
      rule.interval_days > 0
    )
      frequency = frequency.plus(new D(7).div(rule.interval_days));
    else return null;
  }
  return frequency.gt(0) ? frequency.toNumber() : null;
}
export function coursePhaseTargets(
  steps: CourseIndexedStep[],
  injectionsPerWeek: number
): (number | null)[] {
  if (!Number.isFinite(injectionsPerWeek) || injectionsPerWeek <= 0)
    throw new RangeError('Invalid course frequency');
  return [...steps]
    .sort((a, b) => a.step_index - b.step_index)
    .map((step) => {
      if (step.duration_days === null) return null;
      if (step.duration_days < 0 || !Number.isInteger(step.duration_days))
        throw new RangeError('Invalid phase duration');
      return new D(step.duration_days)
        .div(7)
        .times(injectionsPerWeek)
        .toDecimalPlaces(0)
        .toNumber();
    });
}
export function courseActivePhase(
  targets: (number | null)[],
  deliveredCount: number
): number {
  let total = 0;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (target === null) return index;
    total += target!;
    if (deliveredCount < total) return index;
  }
  return Math.max(0, targets.length - 1);
}
export function courseDaysSpentInPhase(input: {
  steps: CourseIndexedStep[];
  oldInjectionsPerWeek: number | null;
  deliveredDayKeys: string[];
  today: string;
}): number {
  if (
    !input.steps.length ||
    input.oldInjectionsPerWeek === null ||
    input.oldInjectionsPerWeek <= 0 ||
    !input.deliveredDayKeys.length
  )
    return 0;
  const targets = coursePhaseTargets(input.steps, input.oldInjectionsPerWeek),
    current = courseActivePhase(targets, input.deliveredDayKeys.length);
  const before = targets
    .slice(0, current)
    .reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (input.deliveredDayKeys.length <= before) return 0;
  const first = [...input.deliveredDayKeys].sort()[before];
  const elapsed =
    (Date.parse(input.today + 'T00:00:00Z') -
      Date.parse(first + 'T00:00:00Z')) /
    86400000;
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed)) : 0;
}
/** Preview uses OLD frequency and explicitly attributed deliveries, never edited cadence. */
export function coursePhaseCarry(input: {
  steps: CourseIndexedStep[];
  oldInjectionsPerWeek: number | null;
  deliveredDayKeys: string[];
  today: string;
}): {
  steps: CourseIndexedStep[];
  progress_known: boolean;
  current_step_index: number | null;
} {
  const ordered = [...input.steps]
    .sort((a, b) => a.step_index - b.step_index)
    .map((step) => ({
      step_index: step.step_index,
      dose: canonicalCourseDecimal(step.dose),
      dose_unit: step.dose_unit,
      duration_days: step.duration_days,
      ...(step.notes === undefined ? {} : { notes: step.notes }),
    }));
  const known =
    input.oldInjectionsPerWeek !== null &&
    Number.isFinite(input.oldInjectionsPerWeek) &&
    input.oldInjectionsPerWeek > 0;
  if (!ordered.length)
    return { steps: [], progress_known: known, current_step_index: null };
  if (!known)
    return {
      steps: ordered.map((step, index) => ({ ...step, step_index: index })),
      progress_known: false,
      current_step_index: null,
    };
  const current = courseActivePhase(
    coursePhaseTargets(ordered, input.oldInjectionsPerWeek!),
    input.deliveredDayKeys.length
  );
  const elapsed = courseDaysSpentInPhase(input);
  return {
    steps: ordered.slice(current).map((step, index) => ({
      ...step,
      step_index: index,
      duration_days:
        index === 0 && step.duration_days !== null
          ? Math.max(1, step.duration_days - elapsed)
          : step.duration_days,
    })),
    progress_known: true,
    current_step_index: ordered[current]!.step_index,
  };
}
export function courseRevisionBoundary(input: {
  predecessor: Pick<
    MedicationCourseRevision,
    'start_date' | 'end_date' | 'cycle_anchor_date' | 'rules'
  >;
  newStart: string;
  replacementEnd?: string | null;
  lastDeliveredDay: string | null;
}): {
  predecessor_end_date: string;
  successor_end_date: string | null;
  cycle_anchor_date: string | null;
} {
  if (
    input.predecessor.start_date !== null &&
    input.newStart <= input.predecessor.start_date
  )
    throw new RangeError('Successor start must follow predecessor start');
  const end = input.replacementEnd || input.predecessor.end_date;
  if (end !== null && end <= input.newStart)
    throw new RangeError('Successor end must follow successor start');
  const previousDay = addDays(input.newStart, -1);
  return {
    predecessor_end_date:
      input.lastDeliveredDay !== null && input.lastDeliveredDay > previousDay
        ? input.lastDeliveredDay
        : previousDay,
    successor_end_date: end,
    cycle_anchor_date: input.predecessor.cycle_anchor_date,
  };
}

/** Canonical reviewed anchors, without positional matching of predecessor rules.
 * Explicit global NULL is meaningful; only an omitted per-rule origin receives
 * the visible source carry fallback. Explicit authored origins stay untouched.
 */
export function courseCarryCyclicAnchors(
  predecessor: Pick<MedicationCourseRevision, 'start_date' | 'rules'>,
  plan: MedicationCoursePlanInput
): MedicationCoursePlanInput {
  const global = plan.cycle_anchor_date ?? null;
  const continuing = predecessor.rules.some(
    (rule) => rule.schedule_type_id === 'cyclic'
  );
  return {
    ...plan,
    cycle_anchor_date: global,
    rules: plan.rules.map((rule) => {
      if (rule.schedule_type_id !== 'cyclic' || global !== null)
        return { ...rule };
      return {
        ...rule,
        anchor_date:
          rule.anchor_date ??
          rule.start_date ??
          (continuing ? predecessor.start_date : plan.start_date),
      };
    }),
  };
}

export function coursePerDoseAmount(
  value: string | null,
  basis: 'per_injection' | 'per_week',
  injectionsPerWeek: number | null
): string | null {
  if (value === null) return null;
  const canonical = canonicalCourseDecimal(value);
  if (basis === 'per_injection') return canonical;
  if (
    injectionsPerWeek === null ||
    !Number.isFinite(injectionsPerWeek) ||
    injectionsPerWeek <= 0
  )
    return null;
  return new D(canonical).div(injectionsPerWeek).toDecimalPlaces(6).toString();
}
/** Authored plan facts, not a recommended dose or an automatically generated ladder. */
export function courseCurrentPhase(input: {
  revision: MedicationCourseRevision;
  deliveredCount: number | null;
}): {
  step_id: string | null;
  current_step_index: number | null;
  authored_dose: string | null;
  dose_amount: string | null;
  dose_unit: string;
  dose_basis: 'per_injection' | 'per_week';
  injections_per_week: number | null;
  progress_known: boolean;
} {
  const { revision } = input;
  const frequency = courseInjectionsPerWeek(revision.rules, revision);
  const ordered = [...revision.steps].sort(
    (a, b) => a.step_index - b.step_index
  );
  const canResolve =
    ordered.length > 0 &&
    revision.start_date !== null &&
    frequency !== null &&
    input.deliveredCount !== null;
  const index = canResolve
    ? courseActivePhase(
        coursePhaseTargets(ordered, frequency!),
        input.deliveredCount!
      )
    : null;
  const step = index === null ? null : ordered[index]!;
  const raw =
    step?.dose ??
    (ordered.length && revision.start_date !== null && !canResolve
      ? null
      : revision.target_dose);
  return {
    step_id: step?.id ?? null,
    current_step_index: step?.step_index ?? null,
    authored_dose: raw === null ? null : canonicalCourseDecimal(raw),
    dose_amount: coursePerDoseAmount(raw, revision.dose_basis, frequency),
    dose_unit: step?.dose_unit ?? revision.dose_unit,
    dose_basis: revision.dose_basis,
    injections_per_week: frequency,
    progress_known: canResolve,
  };
}
