import { apiCall } from '@/api/api';
import type { MedicationInsightStreams } from '@workspace/shared';

/** The last 90 days of doses, wearable days, weights and symptoms the insights compare. */
export const getMedicationInsightStreams = (
  signal?: AbortSignal
): Promise<MedicationInsightStreams> =>
  apiCall('/v2/medication-insights', { method: 'GET', signal });
