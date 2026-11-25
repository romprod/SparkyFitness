import { latestMedicationCurrency } from '@/pages/Medications/lastUsedCurrency';
import { useMedicationPurchases } from '@/hooks/useMedicationPurchases';
import { useMedicationPrescriptions } from './useMedicationPrescriptions';

/**
 * The currency to prefill on a new prescription or invoice: that of the newest
 * record across both lists. Both lists are the cached ones the medication
 * pages already load; pass `enabled = false` when no new record is being made.
 */
export function useLastUsedMedicationCurrency(enabled: boolean) {
  const prescriptions = useMedicationPrescriptions(enabled);
  const purchases = useMedicationPurchases(
    prescriptions.scope.ownerId,
    enabled && prescriptions.scope.ready
  );
  return latestMedicationCurrency(
    prescriptions.data?.prescriptions,
    purchases.data?.purchases
  );
}
