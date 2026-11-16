import { medicationInventoryDashboardResponseSchema } from '@workspace/shared';
import { apiCall } from '@/api/api';

/** Server-current, coherent supply/queue snapshot; no client demand inference. */
export const getMedicationStockDashboard = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationInventoryDashboardResponseSchema.parse(
    await apiCall('/v2/medication-inventory/dashboard', {
      method: 'GET',
      params: { expected_owner_id: ownerId },
      signal,
      suppressErrorToast: true,
    })
  );
