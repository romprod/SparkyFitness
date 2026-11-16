import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuth, type User } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { getMedicationPurchaseIdentity as getCurrentIdentity } from '@/api/Medications/purchaseService';
import * as api from '@/api/Medications/courseService';

const generations = new WeakMap<User, number>();
const cleared = new WeakSet<User>();
let nextGeneration = 0;
const SCOPE = 'medication-course-scope';
export const medicationCourseKeys = { all: ['medication-courses'] as const };

/** Existing medication read/write rights, with fresh actor/profile proof. */
export function useMedicationCourseScope() {
  const { user, loading } = useAuth();
  const { activeUserId, hasPermission, hasWritePermission } = useActiveUser();
  const client = useQueryClient();
  if (user && !generations.has(user)) generations.set(user, ++nextGeneration);
  const generation = user ? generations.get(user)! : 0;
  const key = [SCOPE, user?.id ?? '', activeUserId ?? '', generation] as const;
  const readGranted =
    hasPermission('can_manage_medications') || hasPermission('reports');
  const writeGranted = hasWritePermission('can_manage_medications');
  const signature = `${key.join(':')}:${readGranted}:${writeGranted}`;
  const live = useRef<{ user: User | null; signature: string } | null>({
    user,
    signature,
  });
  useLayoutEffect(() => {
    live.current = { user, signature };
    return () => {
      live.current = null;
    };
  }, [user, signature]);
  const eligible = () =>
    !!user && !!activeUserId && !loading && !cleared.has(user) && readGranted;
  useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getCurrentIdentity(signal),
    enabled: eligible(),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const current = () => {
    const proof =
      client.getQueryData<Awaited<ReturnType<typeof getCurrentIdentity>>>(key);
    return (
      eligible() &&
      client.getQueryState(key)?.status === 'success' &&
      proof?.authenticatedUserId === user?.id &&
      proof?.activeUserId === activeUserId
    );
  };
  const ready = useSyncExternalStore(
    (notify) =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === 'removed' &&
          key.every((part, index) => event.query.queryKey[index] === part)
        ) {
          if (user) cleared.add(user);
          notify();
        }
      }),
    current
  );
  return {
    ready,
    actorId: user?.id ?? '',
    ownerId: activeUserId ?? '',
    generation,
    key: key.join(':'),
    canWrite: ready && writeGranted,
    isCurrent: () =>
      current() &&
      live.current?.user === user &&
      live.current.signature === signature,
  };
}
export function useMedicationCourses(medicationId?: string) {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [
      ...medicationCourseKeys.all,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      'list',
      medicationId ?? 'all',
    ],
    queryFn: ({ signal }) => api.listMedicationCourses(medicationId, signal),
    enabled: scope.ready,
    gcTime: Infinity,
  });
  return {
    scope,
    query,
    data:
      scope.ready && scope.isCurrent() && query.data
        ? {
            ...query.data,
            courses: query.data.courses.filter(
              (course) => course.user_id === scope.ownerId
            ),
          }
        : undefined,
  };
}
export function useCourseHandoffRules(medicationId: string, enabled: boolean) {
  const scope = useMedicationCourseScope();
  return useQuery({
    queryKey: [
      ...medicationCourseKeys.all,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      'handoff',
      medicationId,
    ],
    queryFn: ({ signal }) => api.getCourseHandoffRules(medicationId, signal),
    enabled: scope.ready && scope.canWrite && enabled,
    gcTime: Infinity,
  });
}
export function invalidateMedicationCourses(client: QueryClient) {
  for (const key of [
    medicationCourseKeys.all,
    ['medications'],
    ['medication-entries'],
    ['medication-injections'],
    ['reports'],
  ])
    void client.invalidateQueries({ queryKey: key });
}

export { HttpApiError } from '@/api/api';
export function useMedicationCourseActions(
  scope: ReturnType<typeof useMedicationCourseScope>
) {
  const guard = <T>(run: () => Promise<T>): Promise<T> => {
    if (!scope.isCurrent() || !scope.canWrite)
      return Promise.reject(new Error('The active profile changed.'));
    return run();
  };
  return {
    review: (...args: Parameters<typeof api.reviewMedicationCourse>) =>
      guard(() => api.reviewMedicationCourse(...args)),
    create: (...args: Parameters<typeof api.createMedicationCourse>) =>
      guard(() => api.createMedicationCourse(...args)),
    edit: (...args: Parameters<typeof api.editMedicationCourse>) =>
      guard(() => api.editMedicationCourse(...args)),
    revise: (...args: Parameters<typeof api.reviseMedicationCourse>) =>
      guard(() => api.reviseMedicationCourse(...args)),
    status: (...args: Parameters<typeof api.setMedicationCourseStatus>) =>
      guard(() => api.setMedicationCourseStatus(...args)),
    remove: (...args: Parameters<typeof api.deleteMedicationCourse>) =>
      guard(() => api.deleteMedicationCourse(...args)),
  };
}
export function useMedicationCourseHistory(id: string, enabled: boolean) {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [
      ...medicationCourseKeys.all,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      'history',
      id,
    ],
    queryFn: ({ signal }) => api.getMedicationCourseHistory(id, signal),
    enabled: scope.ready && enabled,
    gcTime: Infinity,
    retry: false,
  });
  return {
    ...query,
    data:
      scope.ready &&
      scope.isCurrent() &&
      query.data?.course.user_id === scope.ownerId
        ? query.data
        : undefined,
  };
}
export function useMedicationCourseDue(date: string, enabled = true) {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [
      ...medicationCourseKeys.all,
      scope.actorId,
      scope.ownerId,
      scope.generation,
      'due',
      date,
    ],
    queryFn: ({ signal }) => api.getMedicationCourseDue(date, signal),
    enabled: scope.ready && enabled,
    gcTime: Infinity,
    retry: false,
  });
  const data = scope.ready && scope.isCurrent() ? query.data : undefined;
  const ownedCourses = data?.courses.filter(
    (course) => course.user_id === scope.ownerId
  );
  const ownedSlots =
    data?.slots.filter((slot) =>
      ownedCourses!.some((course) => course.id === slot.course_id)
    ) ?? [];
  return {
    scope,
    query,
    data: data
      ? {
          ...data,
          courses: ownedCourses!,
          slots: ownedSlots,
          fulfilled_slots: data.fulfilled_slots.filter((row) =>
            ownedSlots.some(
              (slot) =>
                slot.course_revision_id === row.course_revision_id &&
                slot.course_rule_id === row.course_rule_id &&
                slot.course_slot_key === row.course_slot_key &&
                slot.scheduled_day === row.scheduled_day
            )
          ),
        }
      : undefined,
  };
}
