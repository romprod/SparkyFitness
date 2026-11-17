import {
  medicationLogWeekQuerySchema,
  medicationLogWeekResponseSchema,
  medicationInjectionReadSchema,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

/** Canonical seven-day read; navigation supplies an exact Monday or lets the server choose. */
export const getMedicationLogWeek = async (
  ownerId: string,
  weekStart?: string,
  signal?: AbortSignal
) => {
  const params = medicationLogWeekQuerySchema.parse({
    expected_owner_id: ownerId,
    week_start: weekStart,
  });
  return medicationLogWeekResponseSchema.parse(
    await apiCall('/v2/medications/calendar/week', {
      method: 'GET',
      params,
      signal,
      suppressErrorToast: true,
    })
  );
};

/** Full native correction record, read lazily by its exact injection identity. */
export const getMedicationCalendarInjection = async (
  ownerId: string,
  id: string,
  signal?: AbortSignal
) => {
  const record = medicationInjectionReadSchema.parse(
    await apiCall(`/v2/medications/injections/${id}`, {
      method: 'GET',
      params: { expected_owner_id: ownerId },
      signal,
      suppressErrorToast: true,
    })
  );
  if (record.id !== id || record.user_id !== ownerId)
    throw new Error('The injection does not match the requested record.');
  return record;
};
