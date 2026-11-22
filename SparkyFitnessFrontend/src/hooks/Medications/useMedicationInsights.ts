import { useQuery } from '@tanstack/react-query';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { reportKeys } from '@/api/keys/reports';
import { getMedicationInsightStreams } from '@/api/Medications/insightService';

/**
 * The records behind the Insights card. Kept under the report keys, so logging or editing a dose
 * refreshes it with the rest of the medication reports.
 */
export const useMedicationInsightStreams = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: reportKeys.medicationInsights(activeUserId ?? undefined),
    queryFn: ({ signal }) => getMedicationInsightStreams(signal),
    staleTime: 5 * 60_000,
  });
};
