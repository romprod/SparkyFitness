import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DoseReminderSettings } from '@workspace/shared';
import * as api from '@/api/Medications/reminderService';
import { useMedicationCourseScope } from './useMedicationCourses';

/** Dose reminders belong to the signed-in owner; switched profiles get none. */
export const useDoseReminders = () => {
  const proof = useMedicationCourseScope();
  const client = useQueryClient();
  const self = proof.actorId === proof.ownerId;
  const scope = {
    ...proof,
    ready: proof.ready && self,
    isCurrent: () => self && proof.isCurrent(),
  };
  const key = ['dose-reminders', scope.key];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.getDoseReminders(signal),
    enabled: scope.ready,
  });
  const guard = () => {
    if (!scope.ready || !scope.isCurrent())
      throw new Error('The active profile changed.');
  };
  const refresh = () => client.invalidateQueries({ queryKey: key });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
    saveSettings: async (body: DoseReminderSettings) => {
      guard();
      const saved = await api.saveDoseReminderSettings(body);
      await refresh();
      return saved;
    },
    register: async (body: Parameters<typeof api.registerPushDevice>[0]) => {
      guard();
      await api.registerPushDevice(body);
      await refresh();
    },
    unregister: async (endpoint: string) => {
      guard();
      await api.unregisterPushDevice(endpoint);
      await refresh();
    },
    sendTest: async () => {
      guard();
      return api.sendDoseReminderTest();
    },
  };
};
