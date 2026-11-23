import {
  medicationBlendListSchema,
  type MedicationBlendInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listMedicationBlends = async (signal?: AbortSignal) =>
  medicationBlendListSchema.parse(
    await apiCall('/v2/medication-blends', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

/** Replaces what a medication is made of; an empty list makes it a plain medication again. */
export const saveMedicationBlend = (
  id: string,
  body: MedicationBlendInput
): Promise<unknown> =>
  apiCall(`/v2/medication-blends/${id}`, {
    method: 'PUT',
    body,
    suppressErrorToast: true,
  });
