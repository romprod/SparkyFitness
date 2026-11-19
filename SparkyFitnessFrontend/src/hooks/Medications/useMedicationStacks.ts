import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MedicationStackInput } from '@workspace/shared';
import {
  createMedicationStack,
  deleteMedicationStack,
  listMedicationStacks,
  updateMedicationStack,
} from '@/api/Medications/stackService';
import { useMedicationCourseScope } from './useMedicationCourses';

const stackKeys = { all: ['medication-stacks'] as const };

/** Stacks of the active profile's medications and supplements. */
export const useMedicationStacks = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...stackKeys.all, scope.key],
    queryFn: ({ signal }) => listMedicationStacks(signal),
    enabled: scope.ready,
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};

const useInvalidateStacks = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: stackKeys.all });
};

export const useSaveStackMutation = () => {
  const invalidate = useInvalidateStacks();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: MedicationStackInput }) =>
      id
        ? updateMedicationStack(id, body)
        : createMedicationStack(body).then(() => undefined),
    onSuccess: invalidate,
  });
};

export const useDeleteStackMutation = () => {
  const invalidate = useInvalidateStacks();
  return useMutation({
    mutationFn: (id: string) => deleteMedicationStack(id),
    onSuccess: invalidate,
  });
};
