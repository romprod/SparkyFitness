import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type StackConcentrationUnit = 'mcg/ml' | 'mg/ml';
export type StackDoseUnit = 'mcg' | 'mg';

export interface StackComponentAmountsInput {
  concentration_value: number | string;
  concentration_unit: StackConcentrationUnit;
  vial_volume_ml: number | string;
  dose_volume_ml: number | string;
}

export interface StackAmount {
  value: string;
  unit: StackDoseUnit;
}

export interface StackComponentAmounts {
  /** The mass of one dose, in the unit that reads cleanly (mg from 1 mg up). */
  dose: StackAmount;
  /** The mass of one whole vial, in the same style. */
  vial: StackAmount;
  /** The label concentration as the preparation stores it (exact decimal text). */
  concentration_mg_ml: string;
  /** Whole doses a vial gives at this dose volume. */
  doses_per_vial: string;
}

const decimal = (value: number | string): Decimal | null => {
  try {
    const parsed = new D(typeof value === 'string' ? value.trim() : value);
    return parsed.isFinite() && parsed.gt(0) ? parsed : null;
  } catch {
    return null;
  }
};

/** A mass given in mcg, written in mg from 1 mg up and in mcg below that. */
export function stackAmountFromMcg(
  mcg: Decimal.Value,
  places?: number
): StackAmount {
  const mass = new D(mcg);
  const inMg = mass.gte(1000);
  const value = inMg ? mass.div(1000) : mass;
  return {
    value: (places === undefined
      ? value
      : value.toDecimalPlaces(places)
    ).toFixed(),
    unit: inMg ? 'mg' : 'mcg',
  };
}

/**
 * What a premixed component means in mass: dose volume x concentration for one
 * dose, vial volume x concentration for the whole vial. Decimal arithmetic, so
 * 5 mg/mL x 0.2 mL is exactly 1 mg. Pass `places` to round for display only.
 * Returns null while any input is missing or not a positive number.
 */
export function stackComponentAmounts(
  input: StackComponentAmountsInput,
  places?: number
): StackComponentAmounts | null {
  const concentration = decimal(input.concentration_value);
  const vial = decimal(input.vial_volume_ml);
  const dose = decimal(input.dose_volume_ml);
  if (!concentration || !vial || !dose) return null;
  const mcgPerMl =
    input.concentration_unit === 'mg/ml'
      ? concentration.times(1000)
      : concentration;
  return {
    dose: stackAmountFromMcg(mcgPerMl.times(dose), places),
    vial: stackAmountFromMcg(mcgPerMl.times(vial), places),
    concentration_mg_ml: mcgPerMl.div(1000).toFixed(),
    doses_per_vial: vial.div(dose).floor().toFixed(),
  };
}
