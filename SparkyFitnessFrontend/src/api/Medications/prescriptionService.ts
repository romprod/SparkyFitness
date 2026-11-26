import type { z } from 'zod';
import {
  medicationPrescriptionQuerySchema,
  medicationPrescriptionClientListSchema,
  medicationPrescriptionClientDetailSchema,
  medicationPrescriptionMutationResultSchema,
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchemaV2,
  medicationPrescriptionDeleteSchema,
  PRESCRIPTION_MODEL_VERSION,
  PRESCRIPTION_MODEL_VERSION_HEADER,
  type MedicationPrescriptionDelete,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

type CreateRequest = z.input<typeof medicationPrescriptionCreateSchemaV2>;
type UpdateRequest = z.input<typeof medicationPrescriptionUpdateSchemaV2>;

/**
 * Opts every prescription call into the model that knows several medicines per prescription. An older
 * server ignores the header and answers in the one-medicine shape, which the client schemas accept.
 */
const model = {
  headers: {
    [PRESCRIPTION_MODEL_VERSION_HEADER]: String(PRESCRIPTION_MODEL_VERSION),
  },
};

const root = '/v2/medication-prescriptions';
const ownerQuery = (ownerId: string) =>
  medicationPrescriptionQuerySchema.parse({ expected_owner_id: ownerId });

export const listMedicationPrescriptions = async (
  ownerId: string,
  signal?: AbortSignal
) => {
  const result = medicationPrescriptionClientListSchema.parse(
    await apiCall(root, {
      method: 'GET',
      ...model,
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
  const result = medicationPrescriptionClientDetailSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'GET',
      ...model,
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
  medicationPrescriptionCreateSchemaV2.parse(body);
  return medicationPrescriptionMutationResultSchema.parse(
    await apiCall(root, {
      method: 'POST',
      ...model,
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
  medicationPrescriptionUpdateSchemaV2.parse(body);
  const result = medicationPrescriptionMutationResultSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'PUT',
      ...model,
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
      ...model,
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
