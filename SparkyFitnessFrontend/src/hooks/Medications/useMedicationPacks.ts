import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MedicationPackCreate,
  MedicationPackUpdate,
} from '@workspace/shared';
import {
  createMedicationPack,
  deleteMedicationPack,
  listMedicationPacks,
  updateMedicationPack,
} from '@/api/Medications/packService';
import { medicationInventoryKeys } from '@/api/keys/medicationInventory';
import { useMedicationCourseScope } from './useMedicationCourses';

/** Pack stock for the active profile; refreshed whenever stock or doses change. */
export const useMedicationPacks = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...medicationInventoryKeys.all, scope.key, 'packs'],
    queryFn: ({ signal }) => listMedicationPacks(signal),
    enabled: scope.ready,
    gcTime: Infinity,
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};

const useInvalidatePacks = () => {
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({ queryKey: medicationInventoryKeys.all });
};

export const useCreatePackMutation = () => {
  const invalidate = useInvalidatePacks();
  return useMutation({
    mutationFn: ({
      medicationId,
      body,
    }: {
      medicationId: string;
      body: MedicationPackCreate;
    }) => createMedicationPack(medicationId, body),
    onSuccess: invalidate,
  });
};

export const useUpdatePackMutation = () => {
  const invalidate = useInvalidatePacks();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MedicationPackUpdate }) =>
      updateMedicationPack(id, body),
    onSuccess: invalidate,
  });
};

export const useDeletePackMutation = () => {
  const invalidate = useInvalidatePacks();
  return useMutation({
    mutationFn: (id: string) => deleteMedicationPack(id),
    onSuccess: invalidate,
  });
};
