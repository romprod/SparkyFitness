import { useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMedicationLogWeek,
  getMedicationCalendarInjection,
} from '@/api/Medications/calendarService';
import {
  medicationCourseKeys,
  useMedicationCourseScope,
} from './useMedicationCourses';

function useCalendarRead<T>(
  kind: 'week' | 'injection',
  identity: string | undefined,
  enabled: boolean,
  read: (ownerId: string, signal: AbortSignal) => Promise<T>
) {
  const scope = useMedicationCourseScope();
  const client = useQueryClient();
  const queryKey = useMemo(
    () => [
      ...medicationCourseKeys.all,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      'calendar',
      kind,
      identity ?? 'current',
    ],
    [scope.actorId, scope.ownerId, scope.generation, kind, identity]
  );
  useLayoutEffect(() => {
    if (!enabled) void client.cancelQueries({ queryKey, exact: true });
  }, [enabled, client, queryKey]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!enabled || !scope.ready || !scope.isCurrent())
        throw new Error('The active profile changed.');
      return read(scope.ownerId, signal);
    },
    enabled: enabled && scope.ready,
    ...(kind === 'injection'
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
      (kind !== 'injection' ||
        (query.isFetchedAfterMount && !query.isFetching && !query.isError))
        ? query.data
        : undefined,
  };
}

export function useMedicationLogWeek(
  weekStart: string | undefined,
  enabled = true
) {
  const state = useCalendarRead('week', weekStart, enabled, (ownerId, signal) =>
    getMedicationLogWeek(ownerId, weekStart, signal)
  );
  return {
    ...state,
    data:
      state.data &&
      (weekStart === undefined || state.data.week_start === weekStart)
        ? state.data
        : undefined,
  };
}

export function useMedicationCalendarInjection(
  id: string | null | undefined,
  open: boolean
) {
  const state = useCalendarRead(
    'injection',
    id ?? undefined,
    open && !!id,
    (ownerId, signal) =>
      getMedicationCalendarInjection(ownerId, id ?? '', signal)
  );
  return {
    ...state,
    data:
      state.data &&
      state.data.id === id &&
      state.data.user_id === state.scope.ownerId
        ? state.data
        : undefined,
  };
}
