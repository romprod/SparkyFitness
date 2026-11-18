import {
  medicationCostAnalyticsSchema,
  medicationCourseCostsSchema,
  medicationCourseCostsQuerySchema,
  medicationPrescriptionCostAnalyticsSchema,
  medicationPrescriptionCostAnalyticsQuerySchema,
  medicationPrescriptionVialCostsSchema,
  medicationPrescriptionVialCostsQuerySchema,
  type MedicationCostWindow,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import type {
  MedicationPurchaseCreateInput,
  MedicationPurchaseDeleteInput,
  MedicationPurchaseEditorData,
  MedicationPurchaseUpdateInput,
  MedicationPurchaseView,
  MedicationVialCost,
  MedicationPackCost,
} from '@workspace/shared';

const base = '/v2/medication-purchases';
/** Existing nonfinancial identity endpoint, including the authenticated actor. */
export const getMedicationPurchaseIdentity = (
  signal?: AbortSignal
): Promise<{ authenticatedUserId: string; activeUserId: string }> =>
  apiCall('/identity/user', {
    method: 'GET',
    signal,
    suppressErrorToast: true,
  });
export const listMedicationPurchases = (
  ownerId: string
): Promise<{ purchases: MedicationPurchaseView[] }> =>
  apiCall(base, { method: 'GET', params: { expected_owner_id: ownerId } });
export const getMedicationPurchase = (
  ownerId: string,
  id: string
): Promise<MedicationPurchaseView> =>
  apiCall(`${base}/${id}`, {
    method: 'GET',
    params: { expected_owner_id: ownerId },
  });
export const getMedicationPurchaseEditorData = (
  ownerId: string,
  purchaseId?: string
): Promise<MedicationPurchaseEditorData> =>
  apiCall(`${base}/editor-data`, {
    method: 'GET',
    params: {
      expected_owner_id: ownerId,
      ...(purchaseId ? { purchase_id: purchaseId } : {}),
    },
  });
export const getMedicationVialCosts = (
  ownerId: string
): Promise<{ vials: MedicationVialCost[] }> =>
  apiCall(`${base}/vial-costs`, {
    method: 'GET',
    params: { expected_owner_id: ownerId },
  });
export const getMedicationPackCosts = (
  ownerId: string,
  signal?: AbortSignal
): Promise<{ packs: MedicationPackCost[] }> =>
  apiCall(`${base}/pack-costs`, {
    method: 'GET',
    params: { expected_owner_id: ownerId },
    signal,
  });
export const createMedicationPurchase = (
  body: MedicationPurchaseCreateInput
): Promise<MedicationPurchaseView> =>
  apiCall(base, { method: 'POST', body, suppressErrorToast: true });
export const updateMedicationPurchase = (
  id: string,
  body: MedicationPurchaseUpdateInput
): Promise<MedicationPurchaseView> =>
  apiCall(`${base}/${id}`, { method: 'PATCH', body, suppressErrorToast: true });
export const deleteMedicationPurchase = (
  id: string,
  body: MedicationPurchaseDeleteInput
): Promise<void> =>
  apiCall(`${base}/${id}`, {
    method: 'DELETE',
    body,
    suppressErrorToast: true,
  });

export const getMedicationCostAnalytics = async (
  ownerId: string,
  window: MedicationCostWindow,
  signal?: AbortSignal
) =>
  medicationCostAnalyticsSchema.parse(
    await apiCall(`${base}/analytics`, {
      method: 'GET',
      params: { expected_owner_id: ownerId, window },
      signal,
      suppressErrorToast: true,
    })
  );

export const getMedicationCourseCosts = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationCourseCostsSchema.parse(
    await apiCall(`${base}/course-costs`, {
      method: 'GET',
      params: medicationCourseCostsQuerySchema.parse({
        expected_owner_id: ownerId,
      }),
      signal,
      suppressErrorToast: true,
    })
  );

/** Expanded owner read; legacy omitted-mode service methods remain invoice-only. */
export const getMedicationCostAnalyticsWithPrescriptionEstimates = async (
  ownerId: string,
  window: MedicationCostWindow,
  signal?: AbortSignal
) =>
  medicationPrescriptionCostAnalyticsSchema.parse(
    await apiCall(`${base}/analytics`, {
      method: 'GET',
      params: medicationPrescriptionCostAnalyticsQuerySchema.parse({
        expected_owner_id: ownerId,
        window,
        cost_basis: 'with_prescription_estimates',
      }),
      signal,
      suppressErrorToast: true,
    })
  );
export const getMedicationVialCostsWithPrescriptionEstimates = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationPrescriptionVialCostsSchema.parse(
    await apiCall(`${base}/vial-costs`, {
      method: 'GET',
      params: medicationPrescriptionVialCostsQuerySchema.parse({
        expected_owner_id: ownerId,
        cost_basis: 'with_prescription_estimates',
      }),
      signal,
      suppressErrorToast: true,
    })
  );
