import { Decimal } from 'decimal.js';
import type { MedicationPreparationCorrectionValues } from '../schemas/api/MedicationPreparation.api.zod.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
/** Corrected label arithmetic; never rounds a historical physical draw again. */
export function preparationCorrectionValues(
  input: MedicationPreparationCorrectionValues
) {
  const volume = new D(input.final_volume_ml);
  const mass =
    input.mode === 'premixed'
      ? new D(input.label_concentration_value).times(volume)
      : new D(input.mass_value).times(input.mass_unit === 'mcg' ? '0.001' : 1);
  const concentration =
    input.mode === 'premixed'
      ? new D(input.label_concentration_value)
      : mass.div(volume);
  if (
    ![volume, mass, concentration].every(
      (value) => value.isFinite() && value.gt(0)
    )
  )
    throw new Error('Preparation amounts must be finite and positive');
  if (
    ![volume, mass, concentration].every(
      (value) => Number.isFinite(value.toNumber()) && value.toNumber() > 0
    )
  )
    throw new Error('Preparation amounts exceed supported storage precision');
  return {
    mass_value:
      input.mode === 'premixed'
        ? mass.toString()
        : new D(input.mass_value).toString(),
    mass_unit: input.mode === 'premixed' ? ('mg' as const) : input.mass_unit,
    mass_mg: mass.toString(),
    concentration_mg_ml: concentration.toString(),
    final_volume_ml: volume.toString(),
    label_concentration_value:
      input.mode === 'premixed'
        ? new D(input.label_concentration_value).toString()
        : null,
    label_concentration_unit:
      input.mode === 'premixed' ? ('mg/ml' as const) : null,
  };
}
export function correctedDeliveredMass(
  volumeMl: string,
  concentrationMgMl: string
) {
  const volume = new D(volumeMl);
  const concentration = new D(concentrationMgMl);
  if (
    !volume.isFinite() ||
    volume.lt(0) ||
    !concentration.isFinite() ||
    concentration.lte(0)
  )
    throw new Error('Physical volume and concentration are invalid');
  return volume.times(concentration).toString();
}

export function isRecordedNonnegativeDecimal(value: string | null): boolean {
  if (value === null) return false;
  try {
    const n = new D(value);
    return n.isFinite() && n.gte(0);
  } catch {
    return false;
  }
}
export function samePreparationConcentration(left: string, right: string) {
  return new D(left).eq(right);
}
/** Uses the same known-mass criteria as existing stock; unknown remains unknown. */
export function preparationCorrectionBalance(
  concentration: string,
  fill: string,
  doses: {
    dose_mg: string | null;
    volume_ml: string | null;
    dose_input_unit: string | null;
  }[],
  accounted: boolean
) {
  const unknown =
    !accounted ||
    doses.some(
      (dose) =>
        !isRecordedNonnegativeDecimal(dose.dose_mg) ||
        (new D(dose.dose_mg ?? 0).eq(0) &&
          (dose.volume_ml === null || dose.dose_input_unit === null))
    );
  const used = unknown
    ? null
    : doses.reduce((sum, dose) => sum.plus(dose.dose_mg!), new D(0));
  const raw =
    used === null ? null : new D(concentration).times(fill).minus(used);
  const remaining = raw === null ? null : D.max(raw, 0);
  return {
    view: {
      concentration_mg_ml: concentration,
      final_volume_ml: fill,
      remaining_mg: remaining?.toString() ?? null,
      remaining_ml: remaining?.div(concentration).toString() ?? null,
    },
    overdrawn: raw === null ? null : D.max(raw.neg(), 0).toString(),
  };
}

/** Avoid treating a historical JS-number projection's repeating-ratio tail as a label edit. */
export function unchangedPreparationRatio(
  nextConcentration: string,
  previousMass: string,
  previousVolume: string
) {
  return new D(nextConcentration).eq(new D(previousMass).div(previousVolume));
}
