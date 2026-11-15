import type {
  DrawPreviewInput,
  DrawResult,
  MedicationSyringe,
  MedicationSyringeInput,
  MedicationSyringeListResponse,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const endpoint = '/api/v2/medications/syringes';
const serviceName = 'Syringes API';

export const listSyringes = () =>
  apiFetch<MedicationSyringeListResponse>({
    endpoint,
    serviceName,
    operation: 'list syringes',
  });
export const saveSyringe = ({
  id,
  body,
}: {
  id?: string;
  body: MedicationSyringeInput;
}) =>
  apiFetch<MedicationSyringe>({
    endpoint: id ? `${endpoint}/${id}` : endpoint,
    serviceName,
    operation: 'save syringe',
    method: id ? 'PUT' : 'POST',
    body,
  });
export const deleteSyringe = (id: string) =>
  apiFetch<void>({
    endpoint: `${endpoint}/${id}`,
    serviceName,
    operation: 'delete syringe',
    method: 'DELETE',
  });
export const setDefaultSyringe = (syringe_id: string | null) =>
  apiFetch<void>({
    endpoint: `${endpoint}/default`,
    serviceName,
    operation: 'set default syringe',
    method: 'PUT',
    body: { syringe_id },
  });
export const previewSyringeDraw = (
  penId: string,
  body: DrawPreviewInput,
  signal?: AbortSignal
) =>
  apiFetch<DrawResult>({
    endpoint: `/api/v2/medications/pens/${penId}/draw-preview`,
    serviceName,
    operation: 'preview draw',
    method: 'POST',
    body,
    signal,
    logResponseBody: false,
  });
