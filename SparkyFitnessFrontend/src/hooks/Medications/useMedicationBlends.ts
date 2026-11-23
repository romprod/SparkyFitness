import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MedicationBlendInput } from '@workspace/shared';
import {
  listMedicationBlends,
  saveMedicationBlend,
} from '@/api/Medications/blendService';
import { useMedicationCourseScope } from './useMedicationCourses';

const blendKeys = { all: ['medication-blends'] as const };

/** The active profile's blends that have components: what each is made of. */
export const useMedicationBlends = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...blendKeys.all, scope.key],
    queryFn: ({ signal }) => listMedicationBlends(signal),
    enabled: scope.ready,
  });
  return {
    query,
    data: scope.ready && scope.isCurrent() ? query.data?.blends : undefined,
  };
};

export const useSaveMedicationBlendMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MedicationBlendInput }) =>
      saveMedicationBlend(id, body),
    onSuccess: () => client.invalidateQueries({ queryKey: blendKeys.all }),
    meta: { silentError: true },
  });
};
