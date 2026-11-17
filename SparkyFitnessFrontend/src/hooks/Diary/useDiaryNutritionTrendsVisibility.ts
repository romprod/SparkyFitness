import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, type User } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { dashboardLayoutKeys } from '@/api/keys/dashboardLayouts';
import {
  getDashboardLayout,
  saveDashboardLayout,
  type DashboardLayoutPayload,
} from '@/api/Settings/dashboardLayouts';
import { NUTRITION_TRENDS_HIDDEN_KEY } from '@/utils/dashboardLayout';

/** A fresh, owner-writable view of the nested Diary display preference. */
export function useDiaryNutritionTrendsVisibility() {
  const { user, loading } = useAuth();
  const { activeUserId, isActingOnBehalf } = useActiveUser();
  const query = useQuery({
    queryKey: [
      ...dashboardLayoutKeys.byPage('diary'),
      'visibility',
      user?.id ?? '',
      activeUserId ?? '',
    ],
    queryFn: ({ signal }) => getDashboardLayout('diary', signal),
    enabled: !!user && !!activeUserId && !loading,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const saved = query.data;
  const isError = query.isError;
  const client = useQueryClient();
  const live = useRef<{ user: User | null; owner: string | null } | null>(null);
  useLayoutEffect(() => {
    live.current = { user, owner: activeUserId };
    return () => {
      live.current = null;
    };
  }, [user, activeUserId]);
  const mutation = useMutation({
    mutationFn: ({
      payload,
    }: {
      payload: DashboardLayoutPayload;
      user: User;
      owner: string;
    }) => saveDashboardLayout('diary', payload),
    onSuccess: async (data, attempt) => {
      if (
        live.current?.user !== attempt.user ||
        live.current.owner !== attempt.owner
      )
        return;
      // A previous Diary read must not replace this confirmed save afterwards.
      await client.cancelQueries({
        queryKey: dashboardLayoutKeys.byPage('diary'),
        exact: true,
      });
      if (
        live.current?.user === attempt.user &&
        live.current.owner === attempt.owner
      ) {
        client.setQueryData(dashboardLayoutKeys.byPage('diary'), data);
        client.setQueryData(
          [
            ...dashboardLayoutKeys.byPage('diary'),
            'visibility',
            attempt.user.id,
            attempt.owner,
          ],
          data
        );
      }
    },
  });
  const canWrite =
    !!user &&
    !loading &&
    activeUserId === user.id &&
    !isActingOnBehalf &&
    query.isSuccess &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !isError;
  const checked = !saved?.hidden.includes(NUTRITION_TRENDS_HIDDEN_KEY);
  const save = (enabled: boolean) => {
    if (
      !canWrite ||
      !user ||
      !activeUserId ||
      mutation.isPending ||
      live.current?.user !== user ||
      live.current.owner !== activeUserId
    )
      return;
    const current = saved;
    const hidden = (current?.hidden ?? []).filter(
      (key) => key !== NUTRITION_TRENDS_HIDDEN_KEY
    );
    if (!enabled) hidden.push(NUTRITION_TRENDS_HIDDEN_KEY);
    mutation.mutate({
      user,
      owner: activeUserId,
      payload: {
        layout: current?.layout ?? { lg: [], md: [], sm: [], xs: [] },
        hidden,
      },
    });
  };
  return {
    checked,
    disabled: !canWrite || mutation.isPending,
    save,
    failed:
      isError ||
      (mutation.isError &&
        mutation.variables?.user === user &&
        mutation.variables.owner === activeUserId),
  };
}
