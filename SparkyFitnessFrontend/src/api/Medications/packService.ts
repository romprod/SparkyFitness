import {
  medicationPackListSchema,
  type MedicationPackCreate,
  type MedicationPackUpdate,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

/** Pack stock with server-derived remaining units, doses left and observed pace. */
export const listMedicationPacks = async (signal?: AbortSignal) =>
  medicationPackListSchema.parse(
    await apiCall('/v2/medications/packs', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createMedicationPack = (
  medicationId: string,
  body: MedicationPackCreate
): Promise<{ id: string }> =>
  apiCall(`/v2/medications/${medicationId}/packs`, { method: 'POST', body });

export const updateMedicationPack = (
  id: string,
  body: MedicationPackUpdate
): Promise<void> =>
  apiCall(`/v2/medications/packs/${id}`, { method: 'PUT', body });

export const deleteMedicationPack = (id: string): Promise<void> =>
  apiCall(`/v2/medications/packs/${id}`, { method: 'DELETE' });
