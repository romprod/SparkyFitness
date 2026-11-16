import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSyringes } from '@/api/Medications/syringeService';
import type { MedicationReorderDefaultsInput } from '@workspace/shared';
import { useMedicationCourseScope } from './useMedicationCourses';
import * as api from '@/api/Medications/inventoryForecastService';
import { medicationInventoryKeys } from '@/api/keys/medicationInventory';

export const useMedicationInventoryForecast = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...medicationInventoryKeys.all, scope.key, 'forecast'],
    queryFn: ({ signal }) =>
      api.getMedicationInventoryForecast(scope.ownerId, signal),
    enabled: scope.ready,
    gcTime: Infinity,
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};

export const useMedicationReorderDefaults = () => {
  const proof = useMedicationCourseScope();
  const client = useQueryClient();
  const self = proof.actorId === proof.ownerId;
  const scope = {
    ...proof,
    ready: proof.ready && self,
    isCurrent: () => self && proof.isCurrent(),
  };
  const key = [...medicationInventoryKeys.all, scope.key, 'defaults'];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api.getMedicationReorderDefaults(scope.ownerId, signal),
    enabled: scope.ready,
    gcTime: Infinity,
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
    save: async (body: MedicationReorderDefaultsInput) => {
      if (!scope.ready || !scope.isCurrent())
        throw new Error('The active profile changed.');
      const result = await api.saveMedicationReorderDefaults(
        body,
        scope.ownerId
      );
      if (!scope.isCurrent()) throw new Error('The active profile changed.');
      client.setQueryData(key, result);
      void client.invalidateQueries({ queryKey: medicationInventoryKeys.all });
      return result;
    },
  };
};

/** Available real devices only; forecast selection never invents a default. */
export const useMedicationForecastDevices = (enabled: boolean) => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: ['medication-syringes', scope.key, 'forecast-choice'],
    queryFn: ({ signal }) => listSyringes(signal),
    enabled: scope.ready && scope.canWrite && enabled,
    gcTime: Infinity,
  });
  return {
    ...query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};
