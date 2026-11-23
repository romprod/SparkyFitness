import { useQuery } from '@tanstack/react-query';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { reportKeys } from '@/api/keys/reports';
import { getMedicationWellnessStreams } from '@/api/Medications/wellnessService';

/**
 * The records behind the recovery and weight tile. Kept under the report keys, so logging a dose
 * or a weight refreshes it with the rest of the medication reports.
 */
export const useMedicationWellnessStreams = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: reportKeys.medicationWellness(activeUserId ?? undefined),
    queryFn: ({ signal }) => getMedicationWellnessStreams(signal),
    staleTime: 5 * 60_000,
  });
};
