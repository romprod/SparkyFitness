import {
  administrationsPerWeek,
  courseInjectionsPerWeek,
  coursePhaseTargets,
  daysBetween,
  perAdministrationEstimate,
  type MedicationCoursePlanInput,
} from '@workspace/shared';

export type Steps = MedicationCoursePlanInput['steps'];
export type Rules = MedicationCoursePlanInput['rules'];

export interface RampPhase {
  /** 1-based position in the authored order. */
  number: number;
  /** Per-administration amount, as text. */
  dose: string;
  unit: string;
  /** Day offset from the start date at which this phase begins. */
  startDay: number;
  /** null on the open-ended phase. */
  days: number | null;
  /** Doses the planner counts in this phase; null on the open-ended phase. */
  doses: number | null;
}

export type RampFailure =
  'incomplete' | 'per_week_needs_schedule' | 'no_frequency';

export type RampPlan =
  | {
      ok: true;
      phases: RampPhase[];
      /** Doses a week the planner works from. */
      perWeek: number;
      /** Day the finite phases end (start of maintenance, if any). */
      finiteDays: number;
      maintenance: boolean;
      /** Last day drawn on the axis. */
      endDay: number;
      /** Day offset of today, when the plan is under way. */
      todayDay: number | null;
      /** Phases written after an open-ended one; the planner never reaches them. */
      unreachable: number;
    }
  | { ok: false; reason: RampFailure };

const positive = (raw: string): number | null => {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(value) && value > 0
    ? value
    : null;
};

/**
 * The ramp as the planner reads it. The dose count of each phase comes from
 * the same functions Sparky uses to move a course between phases:
 * `courseInjectionsPerWeek` and `coursePhaseTargets` (duration in weeks times
 * doses a week, rounded). Nothing here is a second copy of that rule.
 */
export function buildRampPlan(input: {
  steps: Steps;
  rules: Rules;
  doseBasis: MedicationCoursePlanInput['dose_basis'];
  startDate: string | null;
  endDate: string | null;
  today: string;
}): RampPlan {
  const { steps, rules, doseBasis, startDate, endDate, today } = input;
  if (
    steps.some(
      (step) =>
        positive(step.dose) === null ||
        (step.duration_days !== null &&
          (!Number.isInteger(step.duration_days) || step.duration_days < 0))
    )
  )
    return { ok: false, reason: 'incomplete' };

  const amounts: string[] = [];
  for (const step of steps) {
    if (doseBasis === 'per_injection') {
      amounts.push(step.dose.trim());
      continue;
    }
    const estimate = perAdministrationEstimate(step.dose, rules);
    if (!estimate)
      return {
        ok: false,
        reason: administrationsPerWeek(rules)
          ? 'incomplete'
          : 'per_week_needs_schedule',
      };
    amounts.push(estimate.per_administration);
  }
  const perWeek = courseInjectionsPerWeek(rules, {
    start_date: startDate,
    end_date: endDate,
  });
  if (perWeek === null) return { ok: false, reason: 'no_frequency' };

  const open = steps.findIndex((step) => step.duration_days === null);
  const reachable = open === -1 ? steps : steps.slice(0, open + 1);
  let targets: (number | null)[];
  try {
    targets = coursePhaseTargets(
      reachable.map((step, step_index) => ({ ...step, step_index })),
      perWeek
    );
  } catch {
    return { ok: false, reason: 'incomplete' };
  }

  let day = 0;
  const phases = reachable.map((step, index): RampPhase => {
    const phase: RampPhase = {
      number: index + 1,
      dose: amounts[index]!,
      unit: step.dose_unit.trim(),
      startDay: day,
      days: step.duration_days,
      doses: targets[index] ?? null,
    };
    day += step.duration_days ?? 0;
    return phase;
  });
  const maintenance = open !== -1;
  const finiteDays = day;

  const todayOffset =
    startDate !== null && startDate <= today
      ? daysBetween(startDate, today)
      : null;
  const planEnded = endDate !== null && endDate < today;
  const todayDay =
    todayOffset !== null &&
    !planEnded &&
    (maintenance || todayOffset <= finiteDays)
      ? todayOffset
      : null;

  let endDay = finiteDays;
  if (maintenance) {
    let tail = Math.max(14, Math.round(finiteDays / 4));
    if (todayDay !== null && todayDay > finiteDays)
      tail = Math.max(tail, todayDay - finiteDays + 7);
    endDay = finiteDays + tail;
  }
  return {
    ok: true,
    phases,
    perWeek,
    finiteDays,
    maintenance,
    endDay: Math.max(endDay, 1),
    todayDay,
    unreachable: steps.length - reachable.length,
  };
}
