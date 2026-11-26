import { useContext, useMemo, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { MedicationStackList } from '@workspace/shared';
import { stackKeys } from './useMedicationStacks';

const EMPTY = '';

/**
 * Medicines in a stack that has a schedule, read from the stacks list the
 * Medications page already loads (the Stacks card owns that request). It only
 * watches the query cache, so it needs no auth scope and is empty until the
 * list is there.
 */
export function useScheduledStackMedicationIds(): ReadonlySet<string> {
  const client = useContext(QueryClientContext);
  const snapshot = useSyncExternalStore(
    (notify) => (client ? client.getQueryCache().subscribe(notify) : () => {}),
    () => {
      if (!client) return EMPTY;
      const ids = new Set<string>();
      for (const [, data] of client.getQueriesData<MedicationStackList>({
        queryKey: stackKeys.all,
      }))
        for (const stack of data?.stacks ?? [])
          if (stack.schedule)
            for (const member of stack.members) ids.add(member.medication_id);
      return [...ids].sort().join(',');
    }
  );
  return useMemo(
    () => new Set(snapshot === EMPTY ? [] : snapshot.split(',')),
    [snapshot]
  );
}
