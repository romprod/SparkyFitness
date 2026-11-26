import {
  medicationStackListSchema,
  medicationStackScheduleResultSchema,
  medicationStackScheduleReviewSchema,
  medicationStackSetupResultSchema,
  type MedicationStackInput,
  type MedicationStackScheduleClearInput,
  type MedicationStackScheduleReviewInput,
  type MedicationStackScheduleSaveInput,
  type MedicationStackSetupInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listMedicationStacks = async (signal?: AbortSignal) =>
  medicationStackListSchema.parse(
    await apiCall('/v2/medication-stacks', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createMedicationStack = (
  body: MedicationStackInput
): Promise<{ id: string }> =>
  apiCall('/v2/medication-stacks', {
    method: 'POST',
    body,
    suppressErrorToast: true,
  });

export const updateMedicationStack = (
  id: string,
  body: MedicationStackInput
): Promise<void> =>
  apiCall(`/v2/medication-stacks/${id}`, {
    method: 'PUT',
    body,
    suppressErrorToast: true,
  });

export const deleteMedicationStack = (id: string): Promise<void> =>
  apiCall(`/v2/medication-stacks/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });

export const setupPremixedStack = async (body: MedicationStackSetupInput) =>
  medicationStackSetupResultSchema.parse(
    await apiCall('/v2/medication-stacks/setup', {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );

/** Read only: what a stack schedule would do to each member. */
export const reviewStackSchedule = async (
  id: string,
  body: MedicationStackScheduleReviewInput
) =>
  medicationStackScheduleReviewSchema.parse(
    await apiCall(`/v2/medication-stacks/${id}/schedule/review`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );

/** Save the schedule and rewrite the members' timing. Reuse `operation_id` on retry. */
export const saveStackSchedule = async (
  id: string,
  body: MedicationStackScheduleSaveInput
) =>
  medicationStackScheduleResultSchema.parse(
    await apiCall(`/v2/medication-stacks/${id}/schedule`, {
      method: 'PUT',
      body,
      suppressErrorToast: true,
    })
  );

/** Remove the schedule. Plans keep the rules they have. */
export const clearStackSchedule = (
  id: string,
  body: MedicationStackScheduleClearInput
): Promise<void> =>
  apiCall(`/v2/medication-stacks/${id}/schedule`, {
    method: 'DELETE',
    body,
    suppressErrorToast: true,
  });
