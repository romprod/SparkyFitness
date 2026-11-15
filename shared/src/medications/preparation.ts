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
