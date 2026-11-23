import { apiCall } from '@/api/api';
import type { MedicationWellnessStreams } from '@workspace/shared';

/** Garmin recovery figures and workouts of the last 14 days and the last 7 days of weight. */
export const getMedicationWellnessStreams = (
  signal?: AbortSignal
): Promise<MedicationWellnessStreams> =>
  apiCall('/v2/medication-wellness', {
    method: 'GET',
    signal,
    suppressErrorToast: true,
  });
