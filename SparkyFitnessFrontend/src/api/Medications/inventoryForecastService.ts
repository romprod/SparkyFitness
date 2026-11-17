import {
  medicationInventoryPlannedForecastResponseSchema,
  medicationReorderDefaultsSchema,
  type MedicationReorderDefaultsInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const getMedicationInventoryForecast = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationInventoryPlannedForecastResponseSchema.parse(
    await apiCall('/v2/medication-inventory/forecast', {
      signal,
      params: { expected_owner_id: ownerId, forecast_mode: 'planned_cycles' },
      suppressErrorToast: true,
    })
  );
export const getMedicationReorderDefaults = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationReorderDefaultsSchema.parse(
    await apiCall('/v2/preferences/medication-reorder', {
      signal,
      params: { expected_owner_id: ownerId },
      suppressErrorToast: true,
    })
  );
export const saveMedicationReorderDefaults = async (
  body: MedicationReorderDefaultsInput,
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationReorderDefaultsSchema.parse(
    await apiCall('/v2/preferences/medication-reorder', {
      method: 'PUT',
      body,
      signal,
      params: { expected_owner_id: ownerId },
      suppressErrorToast: true,
    })
  );
