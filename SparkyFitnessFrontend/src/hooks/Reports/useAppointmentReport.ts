import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, type User } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { getMedicationPurchaseIdentity as getCurrentIdentity } from '@/api/Medications/purchaseService';
import { getAppointmentReportPdf } from '@/api/Reports/appointmentReport';

const generations = new WeakMap<User, number>();
const cleared = new WeakSet<User>();
let nextGeneration = 0;
const PREFIX = 'appointment-report';

/** Reports sharing does not grant access to the owner-only consolidated PDF. */
function useAppointmentReportScope() {
  const { user, loading } = useAuth();
  const { activeUserId } = useActiveUser();
  const client = useQueryClient();
  const liveUser = useRef(user);
  useLayoutEffect(() => {
    liveUser.current = user;
    return () => {
      liveUser.current = null;
    };
  }, [user]);
  if (user && !generations.has(user)) generations.set(user, ++nextGeneration);
  const generation = user ? generations.get(user)! : 0;
  const key = [PREFIX, user?.id ?? '', generation] as const;
  const eligible = () =>
    !!user &&
    !loading &&
    activeUserId === user.id &&
    (user.activeUserId || user.id) === user.id &&
    !cleared.has(user);
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
      proof?.activeUserId === user?.id
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
    ownerId: user?.id ?? '',
    generation,
    ready,
    isCurrent: () => current() && liveUser.current === user,
  };
}

export function useAppointmentReport() {
  const scope = useAppointmentReportScope();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const flight = useRef<AbortController | null>(null);
  const urls = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    setPending(false);
    setFailed(false);
    const activeUrls = urls.current;
    return () => {
      flight.current?.abort();
      flight.current = null;
      for (const [url, timer] of activeUrls) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      activeUrls.clear();
    };
  }, [scope.generation, scope.ready]);

  const download = async (range: {
    from: string;
    to: string;
    timezone: string;
  }) => {
    if (!scope.isCurrent() || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setPending(true);
    setFailed(false);
    try {
      const blob = await getAppointmentReportPdf(
        { ...range, expected_owner_id: scope.ownerId },
        controller.signal
      );
      if (
        controller.signal.aborted ||
        flight.current !== controller ||
        !scope.isCurrent()
      )
        return;
      const url = URL.createObjectURL(blob);
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 1000);
      urls.current.set(url, timer);
      const link = document.createElement('a');
      link.href = url;
      link.download = `appointment-report-${range.from}-to-${range.to}.pdf`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } catch {
      if (
        !controller.signal.aborted &&
        flight.current === controller &&
        scope.isCurrent()
      )
        setFailed(true);
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setPending(false);
      }
    }
  };
  return {
    ready: scope.ready,
    generation: scope.generation,
    pending,
    failed,
    download,
  };
}
