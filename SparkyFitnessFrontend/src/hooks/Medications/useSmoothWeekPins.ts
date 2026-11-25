import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall } from '@/api/api';
import i18n from 'i18next';
import {
  medicationCourseKeys,
  useMedicationCourseScope,
} from './useMedicationCourses';

const PINS_PATH = '/v2/medications/smooth-week/pins';
export const smoothWeekPinKeys = {
  all: ['medication-smooth-week-pins'] as const,
};

/** Medications the user keeps as they are: "Smooth your week" never moves these. */
export function useSmoothWeekPins() {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...smoothWeekPinKeys.all, scope.key],
    queryFn: ({ signal }) =>
      apiCall<{ medication_ids: string[] }>(PINS_PATH, {
        method: 'GET',
        signal,
        suppressErrorToast: true,
      }),
    enabled: scope.ready,
    retry: false,
  });
  return {
    query,
    pinnedIds: new Set<string>(
      scope.ready && !query.isError ? (query.data?.medication_ids ?? []) : []
    ),
  };
}

function usePinMutation(method: 'PUT' | 'DELETE') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (medicationId: string) =>
      apiCall<void>(`${PINS_PATH}/${encodeURIComponent(medicationId)}`, {
        method,
        suppressErrorToast: true,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: smoothWeekPinKeys.all }),
    meta: {
      errorMessage:
        method === 'PUT'
          ? i18n.t(
              'hooks.useSmoothWeekPins.couldNotKeep',
              'Could not keep this medication as it is.'
            )
          : i18n.t(
              'hooks.useSmoothWeekPins.couldNotInclude',
              'Could not include this medication again.'
            ),
    },
  });
}

export const usePinSmoothWeekMedication = () => usePinMutation('PUT');
export const useUnpinSmoothWeekMedication = () => usePinMutation('DELETE');

/** Refreshes medications and the planned-week read once, after a batch of moves. */
export function useRefreshSmoothWeek() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['medications'] }),
      queryClient.invalidateQueries({ queryKey: medicationCourseKeys.all }),
    ]);
  }, [queryClient]);
}
