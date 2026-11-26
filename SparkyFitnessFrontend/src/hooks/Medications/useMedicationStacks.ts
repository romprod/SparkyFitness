import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MedicationStackInput,
  MedicationStackSetupInput,
} from '@workspace/shared';
import {
  createMedicationStack,
  deleteMedicationStack,
  listMedicationStacks,
  setupPremixedStack,
  updateMedicationStack,
} from '@/api/Medications/stackService';
import {
  invalidateMedicationCourses,
  useMedicationCourseScope,
} from './useMedicationCourses';

export const stackKeys = { all: ['medication-stacks'] as const };

type StackScope = ReturnType<typeof useMedicationCourseScope>;

/** Stacks for a scope the caller already holds (the plan editor is handed one). */
export const useStacksForScope = (scope: StackScope) => {
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

/** Stacks of the active profile's medications and supplements. */
export const useMedicationStacks = () =>
  useStacksForScope(useMedicationCourseScope());

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

/**
 * Sets up a premixed stack. It creates medicines, vials and plans as well as
 * the stack, so everything that lists them is refreshed.
 */
export const useSetupStackMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: MedicationStackSetupInput) => setupPremixedStack(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: stackKeys.all });
      void client.invalidateQueries({ queryKey: ['medication-pens'] });
      invalidateMedicationCourses(client);
    },
  });
};
