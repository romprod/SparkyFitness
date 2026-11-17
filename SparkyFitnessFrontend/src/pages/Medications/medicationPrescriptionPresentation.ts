import { addDays, type MedicationPrescription } from '@workspace/shared';
/** Recorded date notice only: stored status/counters are deliberately untouched. */
export function prescriptionRefillNotice(
  record: Pick<MedicationPrescription, 'next_refill' | 'expiration'>,
  today: string
) {
  return (
    !!record.next_refill &&
    record.next_refill <= addDays(today, 7) &&
    (!record.expiration || record.expiration >= today)
  );
}
