import type { MedicationPrescriptionClient } from '@workspace/shared';
import { courseIds } from './medicationCourses';
export const prescriptionIds = {
  first: '00000000-0000-4000-8000-000000000071',
  second: '00000000-0000-4000-8000-000000000072',
};
export const prescriptionFixture = (
  changes: Partial<MedicationPrescriptionClient> = {}
): MedicationPrescriptionClient => ({
  id: prescriptionIds.first,
  user_id: courseIds.owner,
  medication_id: courseIds.med,
  medication_name: 'Synthetic medication',
  source: null,
  prescriber: null,
  pharmacy: null,
  dose_instructions: null,
  cost: null,
  currency: 'AUD',
  quantity: null,
  refills_authorized: null,
  refills_remaining: null,
  date_written: null,
  next_refill: null,
  expiration: null,
  lead_time_days: null,
  status: 'active',
  version: 1,
  created_at: '2026-11-17T09:00:00Z',
  updated_at: '2026-11-17T09:00:00Z',
  ...changes,
});
/** A prescription that covers several medicines; `null` ids are deleted ones. The first live one is the primary. */
export const coveredFixture = (
  covered: Array<{ id: string | null; name: string }>,
  changes: Partial<MedicationPrescriptionClient> = {}
): MedicationPrescriptionClient =>
  prescriptionFixture({
    medication_id: covered.find((entry) => entry.id)?.id ?? null,
    medication_name: covered.map((entry) => entry.name).join(' + '),
    medications: covered.map((entry, position) => ({
      medication_id: entry.id,
      medication_name: entry.name,
      position,
    })),
    ...changes,
  });
