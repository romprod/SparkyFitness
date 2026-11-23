import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyCompScanInput } from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  createBodyCompScan,
  deleteBodyCompScan,
  listBodyCompScans,
} from '@/api/Labs/bodyCompService';

const bodyCompKeys = {
  all: ['body-comp-scans'] as const,
  list: (userId?: string) => ['body-comp-scans', { userId }] as const,
};

/** DEXA scans of the active profile, newest first. */
export const useBodyCompScans = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: bodyCompKeys.list(activeUserId ?? undefined),
    queryFn: ({ signal }) => listBodyCompScans(signal),
    select: (data) => data.body_comp_scans,
  });
};

const useInvalidate = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: bodyCompKeys.all });
};

export const useAddBodyCompScanMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: BodyCompScanInput) => createBodyCompScan(body),
    onSuccess: invalidate,
  });
};

export const useDeleteBodyCompScanMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteBodyCompScan(id),
    onSuccess: invalidate,
  });
};
