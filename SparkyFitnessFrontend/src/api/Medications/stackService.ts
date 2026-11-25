import {
  medicationStackListSchema,
  medicationStackSetupResultSchema,
  type MedicationStackInput,
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
