import {
  metabolicTestListSchema,
  type MetabolicTestInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listMetabolicTests = async (signal?: AbortSignal) =>
  metabolicTestListSchema.parse(
    await apiCall('/v2/metabolic-tests', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createMetabolicTest = (
  body: MetabolicTestInput
): Promise<{ id: string }> =>
  apiCall('/v2/metabolic-tests', {
    method: 'POST',
    body,
    suppressErrorToast: true,
  });

export const deleteMetabolicTest = (id: string): Promise<void> =>
  apiCall(`/v2/metabolic-tests/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });
