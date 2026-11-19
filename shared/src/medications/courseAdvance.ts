import { Decimal } from 'decimal.js';
import type {
  MedicationCourseRevision,
  MedicationCourseStepInput,
} from '../schemas/api/MedicationCourses.api.zod.ts';
import {
  coursePerDoseAmount,
  courseInjectionsPerWeek,
} from './courseRevisions.ts';

/**
 * Titration advance suggestion.
 *
 * When a logged dose was attributed to one step of a course and its amount
 * matches the NEXT step (the person moved themselves up), propose the phases
 * from that step on as the draft for a reviewed revision. Pure: it never
 * changes a plan, picks a dose or decides anything; the revision still goes
 * through the normal review and confirmation.
 */

export interface CourseAdvanceProposal {
  /** 1-based phase numbers for wording, e.g. "phase 2 of 4". */
  from_phase: number;
  to_phase: number;
  phase_count: number;
  /** The matched next-phase dose per administration, e.g. "0.5" in "mg". */
  matched_dose: string;
  matched_dose_unit: string;
  /** Phases from the matched one onward, re-indexed from 0, for the revision draft. */
  steps: MedicationCourseStepInput[];
  /** True when the first kept phase was shortened by the dose already taken. */
  shortened: boolean;
}

const MCG_PER_UNIT: Record<string, number> = { mcg: 1, mg: 1000 };

/** Micrograms for a mass dose, or null for anything that cannot be compared by mass. */
function toMcg(value: string, unit: string): Decimal | null {
  const factor = MCG_PER_UNIT[unit];
  if (factor === undefined) return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gt(0) ? amount.times(factor) : null;
  } catch {
    return null;
  }
}

/** Within 0.5 percent: absorbs unit-conversion rounding and nothing more. */
function matches(logged: Decimal, planned: Decimal): boolean {
  return logged.minus(planned).abs().div(planned).lte('0.005');
}

export function courseAdvanceProposal(input: {
  revision: Pick<
    MedicationCourseRevision,
    'steps' | 'rules' | 'start_date' | 'end_date' | 'dose_basis'
  >;
  /** The step the logged dose was attributed to (its recorded course_step_id). */
  attributedStepId: string | null | undefined;
  /** The dose as recorded, in a mass unit. */
  loggedDose: { amount: string | number; unit: string };
}): CourseAdvanceProposal | null {
  const { revision } = input;
  if (!input.attributedStepId || revision.steps.length < 2) return null;
  const ordered = [...revision.steps].sort(
    (a, b) => a.step_index - b.step_index
  );
  const current = ordered.findIndex(
    (step) => step.id === input.attributedStepId
  );
  if (current < 0 || current + 1 >= ordered.length) return null;

  const frequency = courseInjectionsPerWeek(revision.rules, revision);
  const perDose = (index: number): { value: string; unit: string } | null => {
    const step = ordered[index]!;
    const value = coursePerDoseAmount(
      step.dose,
      revision.dose_basis,
      frequency
    );
    return value === null ? null : { value, unit: step.dose_unit };
  };
  const currentDose = perDose(current);
  const nextDose = perDose(current + 1);
  if (!currentDose || !nextDose) return null;

  const logged = toMcg(String(input.loggedDose.amount), input.loggedDose.unit);
  const currentMcg = toMcg(currentDose.value, currentDose.unit);
  const nextMcg = toMcg(nextDose.value, nextDose.unit);
  if (!logged || !currentMcg || !nextMcg) return null;
  // It must match the next phase and clearly differ from the current one.
  if (!matches(logged, nextMcg) || matches(logged, currentMcg)) return null;

  const kept = ordered.slice(current + 1);
  // The dose already taken counts as the first dose of the new phase, so the
  // phase is one dose interval shorter. Unknown frequency leaves it unchanged.
  const interval =
    frequency !== null && frequency > 0
      ? Math.max(1, Math.round(7 / frequency))
      : null;
  const first = kept[0]!;
  const shortened =
    interval !== null &&
    first.duration_days !== null &&
    first.duration_days > interval;
  return {
    from_phase: current + 1,
    to_phase: current + 2,
    phase_count: ordered.length,
    matched_dose: nextDose.value,
    matched_dose_unit: nextDose.unit,
    shortened,
    steps: kept.map((step, index) => ({
      dose: step.dose,
      dose_unit: step.dose_unit,
      duration_days:
        index === 0 && shortened && step.duration_days !== null
          ? step.duration_days - interval!
          : step.duration_days,
      notes: step.notes ?? null,
    })),
  };
}
