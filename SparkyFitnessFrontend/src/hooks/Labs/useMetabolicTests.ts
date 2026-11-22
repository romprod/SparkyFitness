import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetabolicTestInput } from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  createMetabolicTest,
  deleteMetabolicTest,
  listMetabolicTests,
} from '@/api/Labs/metabolicTestService';

const metabolicTestKeys = {
  all: ['metabolic-tests'] as const,
  list: (userId?: string) => ['metabolic-tests', { userId }] as const,
};

/** Measured RMR tests of the active profile, newest first. */
export const useMetabolicTests = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: metabolicTestKeys.list(activeUserId ?? undefined),
    queryFn: ({ signal }) => listMetabolicTests(signal),
    select: (data) => data.metabolic_tests,
  });
};

const useInvalidate = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: metabolicTestKeys.all });
};

export const useAddMetabolicTestMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: MetabolicTestInput) => createMetabolicTest(body),
    onSuccess: invalidate,
  });
};

export const useDeleteMetabolicTestMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteMetabolicTest(id),
    onSuccess: invalidate,
  });
};
