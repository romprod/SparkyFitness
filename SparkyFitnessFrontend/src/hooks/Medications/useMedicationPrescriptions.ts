import { useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/Medications/prescriptionService';
import { invalidateMedicationPurchaseData } from '@/hooks/useMedicationPurchases';
import {
  medicationCourseKeys,
  useMedicationCourseScope,
} from './useMedicationCourses';

const prescriptionKeys = ['medication-prescriptions'] as const;
/** Reuse the existing authoritative actor/profile proof, restricted to self only. */
export function useMedicationPrescriptionScope() {
  const proof = useMedicationCourseScope();
  const self = !!proof.actorId && proof.actorId === proof.ownerId;
  return {
    ...proof,
    ready: proof.ready && self,
    canWrite: proof.canWrite && self,
    isCurrent: () => self && proof.isCurrent(),
  };
}
function usePrescriptionRead<T>(
  kind: 'list' | 'detail',
  id: string | null | undefined,
  enabled: boolean,
  read: (ownerId: string, signal: AbortSignal) => Promise<T>
) {
  const scope = useMedicationPrescriptionScope();
  const client = useQueryClient();
  const queryKey = useMemo(
    () => [
      ...prescriptionKeys,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      kind,
      id ?? 'all',
    ],
    [scope.actorId, scope.ownerId, scope.generation, kind, id]
  );
  useLayoutEffect(() => {
    if (!enabled || !scope.ready)
      void client.cancelQueries({ queryKey, exact: true });
  }, [enabled, scope.ready, client, queryKey]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!enabled || !scope.ready || !scope.isCurrent())
        throw new Error('The active profile changed.');
      return read(scope.ownerId, signal);
    },
    enabled: enabled && scope.ready,
    ...(kind === 'detail'
      ? { staleTime: 0, refetchOnMount: 'always' as const }
      : {}),
    gcTime: Infinity,
    retry: false,
  });
  return {
    scope,
    query,
    data:
      enabled &&
      scope.ready &&
      scope.isCurrent() &&
      !query.isPlaceholderData &&
      (kind !== 'detail' ||
        (query.isFetchedAfterMount && !query.isFetching && !query.isError))
        ? query.data
        : undefined,
  };
}
export function useMedicationPrescriptions(enabled = true) {
  const state = usePrescriptionRead(
    'list',
    undefined,
    enabled,
    api.listMedicationPrescriptions
  );
  return {
    ...state,
    data: state.data?.prescriptions.every(
      (row) => row.user_id === state.scope.ownerId
    )
      ? state.data
      : undefined,
  };
}
export function useMedicationPrescription(
  id: string | null | undefined,
  enabled = true
) {
  const state = usePrescriptionRead(
    'detail',
    id,
    enabled && !!id,
    (ownerId, signal) =>
      api.getMedicationPrescription(ownerId, id ?? '', signal)
  );
  return {
    ...state,
    data:
      state.data &&
      state.data.prescription.id === id &&
      state.data.prescription.user_id === state.scope.ownerId
        ? state.data
        : undefined,
  };
}
export function useMedicationPrescriptionActions(
  scope: ReturnType<typeof useMedicationPrescriptionScope>
) {
  const client = useQueryClient();
  const guard = () => {
    if (!scope.ready || !scope.canWrite || !scope.isCurrent())
      throw new Error('The active profile changed.');
  };
  const run = async <T>(operation: () => Promise<T>, detach = false) => {
    guard();
    const result = await operation();
    guard();
    void invalidateMedicationPurchaseData(client);
    void client.invalidateQueries({ queryKey: prescriptionKeys });
    if (detach) {
      void client.invalidateQueries({ queryKey: ['medication-pens'] });
      void client.invalidateQueries({ queryKey: medicationCourseKeys.all });
    }
    return result;
  };
  return {
    create: (body: Parameters<typeof api.createMedicationPrescription>[1]) =>
      run(() => api.createMedicationPrescription(scope.ownerId, body)),
    update: (
      id: string,
      body: Parameters<typeof api.updateMedicationPrescription>[2]
    ) => run(() => api.updateMedicationPrescription(scope.ownerId, id, body)),
    remove: (
      id: string,
      body: Parameters<typeof api.deleteMedicationPrescription>[2]
    ) =>
      run(
        () => api.deleteMedicationPrescription(scope.ownerId, id, body),
        true
      ),
  };
}
