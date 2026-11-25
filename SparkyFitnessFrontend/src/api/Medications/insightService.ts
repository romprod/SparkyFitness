import { apiCall } from '@/api/api';
import type {
  MedicationAdherenceWindow,
  MedicationInsightStreams,
} from '@workspace/shared';

/** The last 90 days of doses, wearable days, weights and symptoms the insights compare. */
export const getMedicationInsightStreams = (
  signal?: AbortSignal
): Promise<MedicationInsightStreams> =>
  apiCall('/v2/medication-insights', { method: 'GET', signal });

/** Adherence over the last 90 days, per injectable medicine and overall. */
export const getMedicationAdherenceWindow = (
  signal?: AbortSignal
): Promise<MedicationAdherenceWindow> =>
  apiCall('/v2/medication-insights/adherence', { method: 'GET', signal });
