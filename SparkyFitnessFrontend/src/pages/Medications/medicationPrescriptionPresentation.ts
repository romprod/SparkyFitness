import {
  addDays,
  type MedicationPrescriptionClient,
  type MedicationPrescriptionCoverage,
} from '@workspace/shared';
/** A prescription as the web reads it; an older server omits `medications`. */
export type PrescriptionRecord = MedicationPrescriptionClient;
/** Recorded date notice only: stored status/counters are deliberately untouched. */
export function prescriptionRefillNotice(
  record: Pick<PrescriptionRecord, 'next_refill' | 'expiration'>,
  today: string
) {
  return (
    !!record.next_refill &&
    record.next_refill <= addDays(today, 7) &&
    (!record.expiration || record.expiration >= today)
  );
}
/** The covered medicines in display order, falling back to the single legacy target. */
export function prescriptionCoverage(
  record: Pick<
    PrescriptionRecord,
    'medications' | 'medication_id' | 'medication_name'
  >
): MedicationPrescriptionCoverage[] {
  return (
    record.medications ?? [
      {
        medication_id: record.medication_id,
        medication_name: record.medication_name,
        position: 0,
      },
    ]
  );
}
/** Whether the prescription covers a medication; a legacy row covers only its one target. */
export function coversMedication(
  record: Pick<
    PrescriptionRecord,
    'medications' | 'medication_id' | 'medication_name'
  >,
  medicationId: string
): boolean {
  return prescriptionCoverage(record).some(
    (entry) => entry.medication_id === medicationId
  );
}
/** Names of the other covered medicines (deleted ones included), for "also covers". */
export function otherCoveredNames(
  record: Pick<
    PrescriptionRecord,
    'medications' | 'medication_id' | 'medication_name'
  >,
  medicationId: string
): string[] {
  return prescriptionCoverage(record)
    .filter((entry) => entry.medication_id !== medicationId)
    .map((entry) => entry.medication_name);
}
/** Live covered medication ids in order; a fully deleted prescription has none. */
export function liveCoveredIds(
  record: Pick<
    PrescriptionRecord,
    'medications' | 'medication_id' | 'medication_name'
  >
): string[] {
  return prescriptionCoverage(record).flatMap((entry) =>
    entry.medication_id ? [entry.medication_id] : []
  );
}
export type PrescriptionBasisChoice = 'per_vial' | 'per_prescription' | '';
/**
 * What a save says about the price basis. A single medication keeps the original rule (typing a cost
 * confirms it per vial); several medicines never use per-vial, so the owner picks the whole-prescription
 * basis explicitly and adding a second medicine to a per-vial price clears that confirmation.
 */
export function prescriptionBasisIntent(input: {
  medicationCount: number;
  baseBasis: PrescriptionRecord['cost_basis'] | undefined;
  hasBase: boolean;
  costTouched: boolean;
  cost: string;
  choice: PrescriptionBasisChoice;
}): { cost_basis?: 'per_vial' | 'per_prescription' | null } {
  const hasCost = !!input.cost.trim();
  const showsChoice =
    input.medicationCount > 1 || input.baseBasis === 'per_prescription';
  if (!showsChoice)
    return input.costTouched
      ? { cost_basis: hasCost ? 'per_vial' : null }
      : input.baseBasis === 'per_vial' && hasCost
        ? { cost_basis: 'per_vial' }
        : {};
  if (input.choice === 'per_prescription' && hasCost)
    return input.costTouched || input.baseBasis !== 'per_prescription'
      ? { cost_basis: 'per_prescription' }
      : {};
  // Anything else on a whole fill is unconfirmed: send an explicit clear only when something was confirmed.
  return input.hasBase && input.baseBasis ? { cost_basis: null } : {};
}
