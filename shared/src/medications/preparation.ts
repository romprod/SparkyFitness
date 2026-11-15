/** Preparation arithmetic only: input amounts come from the product, not a dose recommendation. */
export function calculatePreparation(
  massMg: number,
  volumeMl: number,
  doseMg: number
) {
  if (![massMg, volumeMl, doseMg].every((v) => Number.isFinite(v) && v > 0))
    return null;
  const concentrationMgMl = massMg / volumeMl;
  const drawMl = doseMg / concentrationMgMl;
  if (
    ![concentrationMgMl, drawMl, massMg / doseMg].every(
      (v) => Number.isFinite(v) && v > 0
    )
  )
    return null;
  return {
    concentrationMgMl,
    drawMl,
    dosesAvailable: Math.floor(massMg / doseMg + 1e-10),
    exceedsVial: doseMg > massMg,
  };
}

export function calculateVialStock(
  concentration: number | null,
  volume: number | null,
  usedMg: number,
  missingDoses: number
) {
  if (
    concentration == null ||
    volume == null ||
    ![concentration, volume].every((v) => Number.isFinite(v) && v > 0) ||
    missingDoses > 0 ||
    !Number.isFinite(usedMg) ||
    usedMg < 0
  )
    return null;
  const totalMg = concentration * volume;
  if (!Number.isFinite(totalMg)) return null;
  // Suppress only floating point cancellation, never a meaningful leftover.
  const difference = totalMg - usedMg;
  const balance =
    Math.abs(difference) <= Number.EPSILON * Math.max(totalMg, usedMg) * 8
      ? 0
      : difference;
  const remainingMg = Math.max(0, balance);
  return {
    totalMg,
    usedMg,
    remainingMg,
    remainingMl: remainingMg / concentration,
    overdrawnMg: Math.max(0, -balance),
  };
}

/** Convert a recorded medication dose to mass; volume/device units need an explicit mg dose. */
export function medicationDoseInMg(
  med: {
    dose_amount: number | null;
    dose_unit?: string | null;
    is_glp1?: boolean;
  },
  amount = med.dose_amount
): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const unit = (med.dose_unit?.trim() || (med.is_glp1 ? 'mg' : ''))
    .trim()
    .toLowerCase()
    .replace(/[µμ]/g, 'u');
  const multiplier =
    unit === 'mg'
      ? 1
      : unit === 'mcg' || unit === 'ug'
        ? 0.001
        : unit === 'g'
          ? 1000
          : null;
  if (multiplier === null) return null;
  const mg = amount * multiplier;
  return Number.isFinite(mg) && mg > 0 ? mg : null;
}

/** Canonical preparation values independent of a requested injection dose. */
export function calculatePreparationValues(input: {
  mass_value: number;
  mass_unit: 'mg' | 'mcg';
  final_volume_ml: number;
  mode?: 'reconstituted' | 'premixed';
  label_concentration_value?: string;
}) {
  if (
    ![input.mass_value, input.final_volume_ml].every(
      (v) => Number.isFinite(v) && v > 0
    )
  )
    return null;
  const mass_mg = input.mass_value * (input.mass_unit === 'mcg' ? 0.001 : 1);
  const concentration_mg_ml =
    input.mode === 'premixed' && input.label_concentration_value !== undefined
      ? Number(input.label_concentration_value)
      : mass_mg / input.final_volume_ml;
  return [mass_mg, concentration_mg_ml].every(
    (v) => Number.isFinite(v) && v > 0
  )
    ? { mass_mg, concentration_mg_ml }
    : null;
}
