import {
  bodyCompScanListSchema,
  type BodyCompScanInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listBodyCompScans = async (signal?: AbortSignal) =>
  bodyCompScanListSchema.parse(
    await apiCall('/v2/body-comp-scans', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createBodyCompScan = (
  body: BodyCompScanInput
): Promise<{ id: string }> =>
  apiCall('/v2/body-comp-scans', {
    method: 'POST',
    body,
    suppressErrorToast: true,
  });

export const deleteBodyCompScan = (id: string): Promise<void> =>
  apiCall(`/v2/body-comp-scans/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });
