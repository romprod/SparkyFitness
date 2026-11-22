import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LifeEventInput } from '@workspace/shared';
import {
  createLifeEvent,
  deleteLifeEvent,
  listLifeEvents,
} from '@/api/Medications/lifeEventService';
import { useMedicationCourseScope } from './useMedicationCourses';

const lifeEventKeys = { all: ['life-events'] as const };

/** Illness, travel and other windows of the active profile, oldest first. */
export const useLifeEvents = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [...lifeEventKeys.all, scope.key],
    queryFn: ({ signal }) => listLifeEvents(signal),
    enabled: scope.ready,
  });
  return {
    query,
    data:
      scope.ready && scope.isCurrent() ? query.data?.life_events : undefined,
  };
};

const useInvalidate = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: lifeEventKeys.all });
};

export const useAddLifeEventMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: LifeEventInput) => createLifeEvent(body),
    onSuccess: invalidate,
  });
};

export const useDeleteLifeEventMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteLifeEvent(id),
    onSuccess: invalidate,
  });
};
