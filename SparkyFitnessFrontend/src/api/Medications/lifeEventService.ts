import { lifeEventListSchema, type LifeEventInput } from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listLifeEvents = async (signal?: AbortSignal) =>
  lifeEventListSchema.parse(
    await apiCall('/v2/life-events', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createLifeEvent = (
  body: LifeEventInput
): Promise<{ id: string }> =>
  apiCall('/v2/life-events', {
    method: 'POST',
    body,
    suppressErrorToast: true,
  });

export const deleteLifeEvent = (id: string): Promise<void> =>
  apiCall(`/v2/life-events/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });
