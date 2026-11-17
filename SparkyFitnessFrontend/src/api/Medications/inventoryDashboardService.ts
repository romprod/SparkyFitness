import { medicationInventoryPlannedDashboardResponseSchema } from '@workspace/shared';
import { apiCall } from '@/api/api';

/** Server-current, coherent supply/queue snapshot; no client demand inference. */
export const getMedicationStockDashboard = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationInventoryPlannedDashboardResponseSchema.parse(
    await apiCall('/v2/medication-inventory/dashboard', {
      method: 'GET',
      params: { expected_owner_id: ownerId, forecast_mode: 'planned_cycles' },
      signal,
      suppressErrorToast: true,
    })
  );
