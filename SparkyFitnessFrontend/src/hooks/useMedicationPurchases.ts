import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuth, type User } from '@/hooks/useAuth';
export { HttpApiError } from '@/api/api';
const clearedIdentities = new WeakSet<User>();
const identityGenerations = new WeakMap<User, number>();
let nextIdentityGeneration = 0;
function identityGeneration(user: User | null) {
  if (!user) return 0;
  let generation = identityGenerations.get(user);
  if (generation === undefined) {
    generation = ++nextIdentityGeneration;
    identityGenerations.set(user, generation);
  }
  return generation;
}
import * as api from '@/api/Medications/purchaseService';
import type {
  MedicationCostWindow,
  MedicationPurchaseCreateInput,
  MedicationPurchaseDeleteInput,
  MedicationPurchaseUpdateInput,
} from '@workspace/shared';

export const medicationPurchaseKeys = {
  all: ['medication-purchases'] as const,
  identity: (owner: string, generation: number) =>
    ['medication-purchases', owner, 'identity', generation] as const,
  analytics: (owner: string, window: MedicationCostWindow) =>
    ['medication-purchases', owner, 'analytics', window] as const,
  list: (owner: string) => ['medication-purchases', owner, 'list'] as const,
  detail: (owner: string, id: string) =>
    ['medication-purchases', owner, 'detail', id] as const,
  analyticsWithPrescriptionEstimates: (
    owner: string,
    window: MedicationCostWindow,
    generation: number
  ) =>
    [
      'medication-purchases',
      owner,
      'analytics',
      window,
      'with_prescription_estimates',
      generation,
    ] as const,
  vialsWithPrescriptionEstimates: (owner: string, generation: number) =>
    [
      'medication-purchases',
      owner,
      'vials',
      'with_prescription_estimates',
      generation,
    ] as const,
  editor: (owner: string, id?: string) =>
    ['medication-purchases', owner, 'editor', id ?? 'new'] as const,
  vials: (owner: string) => ['medication-purchases', owner, 'vials'] as const,
};

/** Financial data stays self-only, including the clear-before-identity-refresh gap. */
export const useMedicationPurchaseScope = () => {
  const { user, loading } = useAuth();
  const client = useQueryClient();
  const liveIdentity = useRef(user);
  useLayoutEffect(() => {
    liveIdentity.current = user;
    return () => {
      liveIdentity.current = null;
    };
  }, [user]);
  const identityKey = medicationPurchaseKeys.identity(
    user?.id ?? '',
    identityGeneration(user)
  );
  const eligible = () =>
    !!user &&
    !loading &&
    (user.activeUserId || user.id) === user.id &&
    !clearedIdentities.has(user);
  useQuery({
    queryKey: identityKey,
    queryFn: ({ signal }) => api.getMedicationPurchaseIdentity(signal),
    enabled: eligible(),
    retry: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });
  const current = () => {
    const proof =
      client.getQueryData<
        Awaited<ReturnType<typeof api.getMedicationPurchaseIdentity>>
      >(identityKey);
    return (
      eligible() &&
      client.getQueryState(identityKey)?.status === 'success' &&
      proof?.authenticatedUserId === user!.id &&
      proof.activeUserId === user!.id
    );
  };
  const ready = useSyncExternalStore(
    (notify) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === 'removed' &&
          event.query.queryKey[0] === 'medication-purchases'
        ) {
          if (user) clearedIdentities.add(user);
          notify();
        }
      }),
    current
  );
  return {
    ownerId: user?.id ?? '',
    generation: identityGeneration(user),
    key: identityKey.join(':'),
    ready,
    isCurrent: () => current() && liveIdentity.current === user,
  };
};

export const useMedicationPurchases = (owner: string, enabled: boolean) =>
  useQuery({
    gcTime: Infinity,
    queryKey: medicationPurchaseKeys.list(owner),
    queryFn: () => api.listMedicationPurchases(owner),
    enabled,
  });
export const useMedicationPurchase = (
  owner: string,
  id: string | null,
  enabled: boolean
) =>
  useQuery({
    gcTime: Infinity,
    queryKey: medicationPurchaseKeys.detail(owner, id ?? ''),
    queryFn: () => api.getMedicationPurchase(owner, id!),
    enabled: enabled && !!id,
  });
export const useMedicationPurchaseEditor = (
  owner: string,
  id: string | undefined,
  enabled: boolean
) =>
  useQuery({
    gcTime: Infinity,
    queryKey: medicationPurchaseKeys.editor(owner, id),
    queryFn: () => api.getMedicationPurchaseEditorData(owner, id),
    enabled,
  });
export const useMedicationVialCosts = (owner: string, enabled: boolean) => {
  const scope = useMedicationPurchaseScope();
  const allowed = enabled && scope.ready && scope.ownerId === owner;
  const client = useQueryClient();
  const queryKey = useMemo(
    () =>
      medicationPurchaseKeys.vialsWithPrescriptionEstimates(
        owner,
        scope.generation
      ),
    [owner, scope.generation]
  );
  useLayoutEffect(() => {
    if (!allowed) void client.cancelQueries({ queryKey, exact: true });
  }, [allowed, client, queryKey]);
  const query = useQuery({
    gcTime: Infinity,
    queryKey,
    queryFn: ({ signal }) => {
      if (!allowed || !scope.isCurrent())
        throw new Error('The active profile changed.');
      return api.getMedicationVialCostsWithPrescriptionEstimates(owner, signal);
    },
    enabled: allowed,
  });
  return {
    ...query,
    data:
      allowed && scope.isCurrent() && !query.isPlaceholderData
        ? query.data
        : undefined,
  };
};

export const useSaveMedicationPurchase = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: MedicationPurchaseCreateInput | MedicationPurchaseUpdateInput;
    }) =>
      id
        ? api.updateMedicationPurchase(
            id,
            body as MedicationPurchaseUpdateInput
          )
        : api.createMedicationPurchase(body as MedicationPurchaseCreateInput),
    onSuccess: () => invalidateMedicationPurchaseData(client),
  });
};
export const useDeleteMedicationPurchase = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: MedicationPurchaseDeleteInput;
    }) => api.deleteMedicationPurchase(id, body),
    onSuccess: () => invalidateMedicationPurchaseData(client),
  });
};

export const useMedicationCostAnalytics = (
  owner: string,
  window: MedicationCostWindow,
  enabled: boolean
) => {
  const scope = useMedicationPurchaseScope();
  const allowed = enabled && scope.ready && scope.ownerId === owner;
  const client = useQueryClient();
  const queryKey = useMemo(
    () =>
      medicationPurchaseKeys.analyticsWithPrescriptionEstimates(
        owner,
        window,
        scope.generation
      ),
    [owner, window, scope.generation]
  );
  useLayoutEffect(() => {
    if (!allowed) void client.cancelQueries({ queryKey, exact: true });
  }, [allowed, client, queryKey]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!allowed || !scope.isCurrent())
        throw new Error('The active profile changed.');
      return api.getMedicationCostAnalyticsWithPrescriptionEstimates(
        owner,
        window,
        signal
      );
    },
    enabled: allowed,
    gcTime: Infinity,
  });
  return {
    ...query,
    data:
      allowed && scope.isCurrent() && !query.isPlaceholderData
        ? query.data
        : undefined,
  };
};

/** Refresh derived financial data without invalidating authoritative identity proof. */
export const invalidateMedicationPurchaseData = (
  client: QueryClient,
  kinds?: readonly string[]
) =>
  client.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'medication-purchases' &&
      query.queryKey[2] !== 'identity' &&
      (!kinds || kinds.includes(String(query.queryKey[2]))),
  });
