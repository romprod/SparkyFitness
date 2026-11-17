import type { z } from 'zod';
import {
  medicationPrescriptionQuerySchema,
  medicationPrescriptionListSchema,
  medicationPrescriptionDetailSchema,
  medicationPrescriptionMutationResultSchema,
  medicationPrescriptionCreateSchema,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionDeleteSchema,
  type MedicationPrescriptionDelete,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

type CreateRequest = z.input<typeof medicationPrescriptionCreateSchema>;
type UpdateRequest = z.input<typeof medicationPrescriptionUpdateSchema>;

const root = '/v2/medication-prescriptions';
const ownerQuery = (ownerId: string) =>
  medicationPrescriptionQuerySchema.parse({ expected_owner_id: ownerId });

export const listMedicationPrescriptions = async (
  ownerId: string,
  signal?: AbortSignal
) => {
  const result = medicationPrescriptionListSchema.parse(
    await apiCall(root, {
      method: 'GET',
      params: ownerQuery(ownerId),
      signal,
      suppressErrorToast: true,
    })
  );
  if (result.prescriptions.some((row) => row.user_id !== ownerId))
    throw new Error('The prescription does not match the requested owner.');
  return result;
};
export const getMedicationPrescription = async (
  ownerId: string,
  id: string,
  signal?: AbortSignal
) => {
  const result = medicationPrescriptionDetailSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'GET',
      params: ownerQuery(ownerId),
      signal,
      suppressErrorToast: true,
    })
  );
  if (result.prescription.id !== id || result.prescription.user_id !== ownerId)
    throw new Error('The prescription does not match the requested record.');
  return result;
};
export const createMedicationPrescription = async (
  ownerId: string,
  body: CreateRequest
) => {
  medicationPrescriptionCreateSchema.parse(body);
  return medicationPrescriptionMutationResultSchema.parse(
    await apiCall(root, {
      method: 'POST',
      params: ownerQuery(ownerId),
      body,
      suppressErrorToast: true,
    })
  );
};

export const updateMedicationPrescription = async (
  ownerId: string,
  id: string,
  body: UpdateRequest
) => {
  medicationPrescriptionUpdateSchema.parse(body);
  const result = medicationPrescriptionMutationResultSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'PUT',
      params: ownerQuery(ownerId),
      body,
      suppressErrorToast: true,
    })
  );
  if (result.id !== id)
    throw new Error(
      'The prescription receipt does not match the requested record.'
    );
  return result;
};
export const deleteMedicationPrescription = async (
  ownerId: string,
  id: string,
  body: MedicationPrescriptionDelete
) => {
  medicationPrescriptionDeleteSchema.parse(body);
  const result = medicationPrescriptionMutationResultSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'DELETE',
      params: ownerQuery(ownerId),
      body,
      suppressErrorToast: true,
    })
  );
  if (result.id !== id)
    throw new Error(
      'The prescription receipt does not match the requested record.'
    );
  return result;
};
