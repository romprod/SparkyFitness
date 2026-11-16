import { apiCall } from '@/api/api';
import type {
  MedicationSyringe,
  MedicationSyringeInput,
  MedicationSyringeListResponse,
  DrawPreviewInput,
  DrawResult,
} from '@workspace/shared';

export const listSyringes = (
  signal?: AbortSignal
): Promise<MedicationSyringeListResponse> =>
  apiCall('/v2/medications/syringes', { method: 'GET', signal });
export const createSyringe = (
  body: MedicationSyringeInput
): Promise<MedicationSyringe> =>
  apiCall('/v2/medications/syringes', { method: 'POST', body });
export const updateSyringe = (
  id: string,
  body: MedicationSyringeInput
): Promise<MedicationSyringe> =>
  apiCall(`/v2/medications/syringes/${id}`, { method: 'PUT', body });
export const deleteSyringe = (id: string): Promise<void> =>
  apiCall(`/v2/medications/syringes/${id}`, { method: 'DELETE' });
export const setDefaultSyringe = (syringeId: string | null): Promise<void> =>
  apiCall('/v2/medications/syringes/default', {
    method: 'PUT',
    body: { syringe_id: syringeId },
  });
export const previewDraw = (
  penId: string,
  body: DrawPreviewInput
): Promise<DrawResult> =>
  apiCall(`/v2/medications/pens/${penId}/draw-preview`, {
    method: 'POST',
    body,
  });
