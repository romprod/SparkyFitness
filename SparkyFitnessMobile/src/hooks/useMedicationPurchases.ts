import { useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MedicationPurchaseCreateInput,
  MedicationCostWindow,
  MedicationPurchaseDeleteInput,
  MedicationPurchaseUpdateInput,
} from '@workspace/shared';
import {
  getMedicationCostIdentity,
  getMedicationCostAnalytics,
  listMedicationPurchases,
  getMedicationPurchase,
  getMedicationPurchaseEditorData,
  getMedicationVialCosts,
  createMedicationPurchase,
  updateMedicationPurchase,
  deleteMedicationPurchase,
  type MedicationCostIdentity,
  type MedicationCostContext,
} from '../services/api/medicationPurchasesApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { medicationPurchasesRootQueryKey } from './queryKeys';
import i18n from '../localization/i18n';

const accessKey = ['medicationCostAccess'] as const;
const root = medicationPurchasesRootQueryKey;
export function useMedicationCostsAccess() {
  const client = useQueryClient();
  const access = useQuery({
    queryKey: accessKey,
    queryFn: ({ signal }) => getMedicationCostIdentity(signal),
    staleTime: 0,
    retry: false,
  });
  useRefetchOnFocus(access.refetch);
  const epoch = useRef(0);
  const snapshot = () => {
    const data = client.getQueryData<MedicationCostIdentity>(accessKey);
    return `${epoch.current}:${client.getQueryState(accessKey)?.status ?? ''}:${data?.configId ?? ''}:${data?.serverUrl ?? ''}:${data?.authenticatedUserId ?? ''}:${data?.activeUserId ?? ''}`;
  };
  const scopeKey = useSyncExternalStore(
    (notify) =>
      client.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === accessKey[0]) {
          if (event.type === 'removed') epoch.current++;
          if (event.type === 'removed' || event.type === 'updated') notify();
        }
      }),
    snapshot
  );
  const identity = client.getQueryData<MedicationCostIdentity>(accessKey);
  const ownerId =
    !access.isError &&
    identity?.configId &&
    identity.serverUrl &&
    identity.authenticatedUserId &&
    identity.activeUserId === identity.authenticatedUserId
      ? identity.authenticatedUserId
      : null;
  return {
    ownerId,
    scopeKey,
    isLoading: access.isLoading,
    isError: access.isError,
    refetch: access.refetch,
    isCurrent: () => snapshot() === scopeKey && !!ownerId,
  };
}
function useCostContext(owner: string | null): MedicationCostContext | null {
  const client = useQueryClient();
  const identity = client.getQueryData<MedicationCostIdentity>(accessKey);
  return owner &&
    identity?.configId &&
    identity.serverUrl &&
    identity.authenticatedUserId === owner &&
    identity.activeUserId === owner
    ? {
        ownerId: owner,
        configId: identity.configId,
        serverUrl: identity.serverUrl,
      }
    : null;
}
function requireContext(context: MedicationCostContext | null) {
  if (!context)
    throw new Error(
      i18n.t('medications.costs.contextChanged', {
        defaultValue: 'The account changed. Reopen Costs to continue.',
      })
    );
  return context;
}
export function useMedicationPurchases(owner: string | null) {
  const context = useCostContext(owner);
  const query = useQuery({
    queryKey: [...root, owner, context?.configId, context?.serverUrl, 'list'],
    queryFn: ({ signal }) =>
      listMedicationPurchases(requireContext(context), signal),
    enabled: !!context,
    placeholderData: undefined,
  });
  useRefetchOnFocus(query.refetch, !!context);
  return query;
}
export function useMedicationPurchase(owner: string | null, id?: string) {
  const context = useCostContext(owner);
  return useQuery({
    queryKey: [
      ...root,
      owner,
      context?.configId,
      context?.serverUrl,
      'detail',
      id,
    ],
    queryFn: ({ signal }) =>
      getMedicationPurchase(requireContext(context), id!, signal),
    enabled: !!context && !!id,
    placeholderData: undefined,
  });
}
export function useMedicationPurchaseEditorData(
  owner: string | null,
  id?: string
) {
  const context = useCostContext(owner);
  return useQuery({
    queryKey: [
      ...root,
      owner,
      context?.configId,
      context?.serverUrl,
      'editor',
      id,
    ],
    queryFn: ({ signal }) =>
      getMedicationPurchaseEditorData(requireContext(context), id, signal),
    enabled: !!context,
    placeholderData: undefined,
  });
}
export function useMedicationVialCosts(owner: string | null) {
  const context = useCostContext(owner);
  return useQuery({
    queryKey: [
      ...root,
      owner,
      context?.configId,
      context?.serverUrl,
      'vialCosts',
    ],
    queryFn: ({ signal }) =>
      getMedicationVialCosts(requireContext(context), signal),
    enabled: !!context,
    placeholderData: undefined,
  });
}
export function useMedicationPurchaseMutations(
  owner: string,
  isCurrent: () => boolean
) {
  const client = useQueryClient();
  const context = useCostContext(owner);
  const check = () => {
    if (!isCurrent())
      throw new Error(
        i18n.t('medications.costs.contextChanged', {
          defaultValue: 'The account changed. Reopen Costs to continue.',
        })
      );
  };
  const invalidate = () => {
    if (isCurrent())
      void client.invalidateQueries({ queryKey: [...root, owner] });
  };
  return {
    create: useMutation({
      mutationFn: async (body: MedicationPurchaseCreateInput) => {
        check();
        const value = await createMedicationPurchase(
          body,
          requireContext(context)
        );
        check();
        return value;
      },
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: string;
        body: MedicationPurchaseUpdateInput;
      }) => {
        check();
        const value = await updateMedicationPurchase(
          id,
          body,
          requireContext(context)
        );
        check();
        return value;
      },
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: string;
        body: MedicationPurchaseDeleteInput;
      }) => {
        check();
        await deleteMedicationPurchase(id, body, requireContext(context));
        check();
      },
      onSuccess: invalidate,
      onError: invalidate,
    }),
  };
}

export function useMedicationCostAnalytics(
  owner: string | null,
  window: MedicationCostWindow
) {
  const context = useCostContext(owner);
  const query = useQuery({
    queryKey: [
      ...root,
      owner,
      context?.configId,
      context?.serverUrl,
      'analytics',
      window,
    ],
    queryFn: ({ signal }) =>
      getMedicationCostAnalytics(requireContext(context), window, signal),
    enabled: !!context,
    placeholderData: undefined,
    retry: false,
    staleTime: 0,
  });
  useRefetchOnFocus(query.refetch, !!context);
  return query;
}
