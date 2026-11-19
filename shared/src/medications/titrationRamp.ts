import { Decimal } from 'decimal.js';

/**
 * Titration ramp: start dose to target dose in fixed increases, each phase a
 * fixed number of weeks, the last phase open-ended. Pure; the result is a
 * draft the person edits and reviews, never saved or applied by itself.
 */

export const MAX_RAMP_PHASES = 100;

export interface TitrationRampInput {
  start_dose: string;
  target_dose: string;
  increase_by: string;
  weeks_per_phase: number;
  dose_unit: string;
}

export interface TitrationRampPhase {
  dose: string;
  dose_unit: string;
  /** null on the final phase: it stays in place until the person changes it. */
  duration_days: number | null;
  notes: null;
}

export type TitrationRampResult =
  | { ok: true; phases: TitrationRampPhase[] }
  | {
      ok: false;
      error:
        | 'start_invalid'
        | 'target_invalid'
        | 'increase_invalid'
        | 'weeks_invalid'
        | 'unit_missing'
        | 'start_above_target'
        | 'too_many_phases';
    };

const positive = (value: string): Decimal | null => {
  try {
    const dose = new Decimal(value.trim());
    return dose.isFinite() && dose.gt(0) && dose.decimalPlaces() <= 6
      ? dose
      : null;
  } catch {
    return null;
  }
};

export function generateTitrationRamp(
  input: TitrationRampInput
): TitrationRampResult {
  const start = positive(input.start_dose);
  if (!start) return { ok: false, error: 'start_invalid' };
  const target = positive(input.target_dose);
  if (!target) return { ok: false, error: 'target_invalid' };
  const step = positive(input.increase_by);
  if (!step) return { ok: false, error: 'increase_invalid' };
  if (
    !Number.isFinite(input.weeks_per_phase) ||
    input.weeks_per_phase <= 0 ||
    input.weeks_per_phase > 104 ||
    Math.round(input.weeks_per_phase * 7) < 1
  )
    return { ok: false, error: 'weeks_invalid' };
  const unit = input.dose_unit.trim();
  if (!unit) return { ok: false, error: 'unit_missing' };
  if (start.gt(target)) return { ok: false, error: 'start_above_target' };
  // An increase typed in the wrong unit would otherwise build thousands of rows.
  if (
    target
      .minus(start)
      .div(step)
      .gt(MAX_RAMP_PHASES - 1)
  )
    return { ok: false, error: 'too_many_phases' };

  const doses: Decimal[] = [];
  for (let dose = start; dose.lt(target); dose = dose.plus(step))
    doses.push(dose);
  doses.push(target); // always finish exactly on the target
  const days = Math.round(input.weeks_per_phase * 7);
  return {
    ok: true,
    phases: doses.map((dose, index) => ({
      dose: dose.toString(),
      dose_unit: unit,
      duration_days: index === doses.length - 1 ? null : days,
      notes: null,
    })),
  };
}
