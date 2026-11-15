import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, type User } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { getMedicationPurchaseIdentity as getCurrentIdentity } from '@/api/Medications/purchaseService';
import { listMedications } from '@/api/Medications/medicationService';
import type { Medication } from '@/types/medications';

const generations = new WeakMap<User, number>();
const cleared = new WeakSet<User>();
let nextGeneration = 0;
const PREFIX = 'diary-medication-charts';

export function isDiaryModelEligible(med: Medication): boolean {
  // Include diagnostic candidates: an unresolved flagged model must remain
  // visible as an omission notice rather than disappearing from the Diary.
  return med.is_active && med.is_glp1;
}

/** Diary access alone never authorizes medication reads. Proof is profile/generation bound. */
export function useDiaryMedicationCharts() {
  const { user, loading } = useAuth();
  const { activeUserId, hasPermission } = useActiveUser();
  const client = useQueryClient();
  const live = useRef(user);
  useLayoutEffect(() => {
    live.current = user;
    return () => {
      live.current = null;
    };
  }, [user]);
  if (user && !generations.has(user)) generations.set(user, ++nextGeneration);
  const generation = user ? generations.get(user)! : 0;
  const base = [
    PREFIX,
    user?.id ?? '',
    activeUserId ?? '',
    generation,
  ] as const;
  const identityKey = [...base, 'identity'] as const;
  const allowed = Boolean(
    user &&
    activeUserId &&
    !loading &&
    !cleared.has(user) &&
    (hasPermission('can_manage_medications') || hasPermission('reports'))
  );
  useQuery({
    queryKey: identityKey,
    queryFn: ({ signal }) => getCurrentIdentity(signal),
    enabled: allowed,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const current = () => {
    const proof =
      client.getQueryData<Awaited<ReturnType<typeof getCurrentIdentity>>>(
        identityKey
      );
    return (
      allowed &&
      !!user &&
      !cleared.has(user) &&
      client.getQueryState(identityKey)?.status === 'success' &&
      proof?.authenticatedUserId === user.id &&
      proof.activeUserId === activeUserId
    );
  };
  const ready = useSyncExternalStore(
    (notify) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === 'removed' &&
          base.every((part, index) => event.query.queryKey[index] === part)
        ) {
          if (user) cleared.add(user);
          notify();
        }
      }),
    current
  );
  const medications = useQuery({
    queryKey: [...base, 'medications'],
    gcTime: Infinity,
    queryFn: ({ signal }) =>
      listMedications({ activeOnly: true, glp1Only: true }, signal),
    enabled: ready,
  });
  return ready && current() && live.current === user && medications.isSuccess
    ? medications.data.filter(
        (med) => med.user_id === activeUserId && isDiaryModelEligible(med)
      )
    : [];
}
