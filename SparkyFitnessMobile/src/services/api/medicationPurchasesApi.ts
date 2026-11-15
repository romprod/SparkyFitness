import type {
  MedicationPurchaseCreateInput,
  MedicationCostAnalytics,
  MedicationCostWindow,
  MedicationPurchaseDeleteInput,
  MedicationPurchaseEditorData,
  MedicationPurchaseUpdateInput,
  MedicationPurchaseView,
  MedicationVialCost,
} from '@workspace/shared';
import { getActiveServerConfig } from '../storage';
import i18n from '../../localization/i18n';
import { apiFetch } from './apiClient';

export interface MedicationCostIdentity {
  authenticatedUserId: string;
  activeUserId: string;
  configId: string;
  serverUrl: string;
}
export interface MedicationCostContext {
  ownerId: string;
  configId: string;
  serverUrl: string;
}
async function boundFetch<T>(
  context: MedicationCostContext,
  options: Parameters<typeof apiFetch>[0]
): Promise<T> {
  const config = await getActiveServerConfig();
  if (
    !config ||
    config.id !== context.configId ||
    config.url !== context.serverUrl
  )
    throw new Error(
      i18n.t('medications.costs.contextChanged', {
        defaultValue: 'The account changed. Reopen Costs to continue.',
      })
    );
  const result = await apiFetch<T>({ ...options, serverConfig: config });
  const current = await getActiveServerConfig();
  if (
    !current ||
    current.id !== context.configId ||
    current.url !== context.serverUrl
  )
    throw new Error(
      i18n.t('medications.costs.contextChanged', {
        defaultValue: 'The account changed. Reopen Costs to continue.',
      })
    );
  return result;
}
export async function getMedicationCostIdentity(
  signal?: AbortSignal
): Promise<MedicationCostIdentity> {
  const config = await getActiveServerConfig();
  if (!config)
    throw new Error(
      i18n.t('medications.costs.contextChanged', {
        defaultValue: 'The account changed. Reopen Costs to continue.',
      })
    );
  const identity = await apiFetch<MedicationCostIdentity>({
    serverConfig: config,
    endpoint: '/api/identity/user',
    serviceName: 'Medication costs',
    operation: 'check account access',
    signal,
    logResponseBody: false,
  });
  const current = await getActiveServerConfig();
  if (!current || current.id !== config.id || current.url !== config.url)
    throw new Error(
      i18n.t('medications.costs.contextChanged', {
        defaultValue: 'The account changed. Reopen Costs to continue.',
      })
    );
  return {
    authenticatedUserId: identity.authenticatedUserId,
    activeUserId: identity.activeUserId,
    configId: config.id,
    serverUrl: config.url,
  };
}
const base = '/api/v2/medication-purchases';
const read = <T>(
  path: string,
  context: MedicationCostContext,
  signal?: AbortSignal,
  extra?: Record<string, string>
) => {
  const query = new URLSearchParams({
    expected_owner_id: context.ownerId,
    ...extra,
  });
  return boundFetch<T>(context, {
    endpoint: `${base}${path}?${query}`,
    serviceName: 'Medication costs',
    operation: 'load invoice data',
    signal,
    logResponseBody: false,
  });
};
export const listMedicationPurchases = (
  context: MedicationCostContext,
  signal?: AbortSignal
) => read<{ purchases: MedicationPurchaseView[] }>('', context, signal);
export const getMedicationPurchase = (
  context: MedicationCostContext,
  id: string,
  signal?: AbortSignal
) => read<MedicationPurchaseView>(`/${id}`, context, signal);
export const getMedicationPurchaseEditorData = (
  context: MedicationCostContext,
  id?: string,
  signal?: AbortSignal
) =>
  read<MedicationPurchaseEditorData>(
    '/editor-data',
    context,
    signal,
    id ? { purchase_id: id } : undefined
  );
export const getMedicationVialCosts = (
  context: MedicationCostContext,
  signal?: AbortSignal
) => read<{ vials: MedicationVialCost[] }>('/vial-costs', context, signal);
export const createMedicationPurchase = (
  body: MedicationPurchaseCreateInput,
  context: MedicationCostContext
) =>
  boundFetch<MedicationPurchaseView>(context, {
    endpoint: base,
    serviceName: 'Medication costs',
    operation: 'create invoice',
    method: 'POST',
    body,
    logResponseBody: false,
  });
export const updateMedicationPurchase = (
  id: string,
  body: MedicationPurchaseUpdateInput,
  context: MedicationCostContext
) =>
  boundFetch<MedicationPurchaseView>(context, {
    endpoint: `${base}/${id}`,
    serviceName: 'Medication costs',
    operation: 'update invoice',
    method: 'PATCH',
    body,
    logResponseBody: false,
  });
export const deleteMedicationPurchase = (
  id: string,
  body: MedicationPurchaseDeleteInput,
  context: MedicationCostContext
) =>
  boundFetch<void>(context, {
    endpoint: `${base}/${id}`,
    serviceName: 'Medication costs',
    operation: 'delete invoice',
    method: 'DELETE',
    body,
    logResponseBody: false,
  });

export const getMedicationCostAnalytics = (
  context: MedicationCostContext,
  window: MedicationCostWindow,
  signal?: AbortSignal
) => read<MedicationCostAnalytics>('/analytics', context, signal, { window });
