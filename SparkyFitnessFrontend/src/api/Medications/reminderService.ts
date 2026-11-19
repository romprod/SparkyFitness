import {
  doseReminderSettingsSchema,
  doseReminderStatusSchema,
  doseReminderTestResultSchema,
  webPushSubscriptionViewSchema,
  type DoseReminderSettings,
  type WebPushSubscriptionInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

const base = '/v2/medication-reminders';

export const getDoseReminders = async (signal?: AbortSignal) =>
  doseReminderStatusSchema.parse(
    await apiCall(base, { signal, suppressErrorToast: true })
  );

export const saveDoseReminderSettings = async (body: DoseReminderSettings) =>
  doseReminderSettingsSchema.parse(
    await apiCall(`${base}/settings`, {
      method: 'PUT',
      body,
      suppressErrorToast: true,
    })
  );

export const registerPushDevice = async (body: WebPushSubscriptionInput) =>
  webPushSubscriptionViewSchema.parse(
    await apiCall(`${base}/subscriptions`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );

export const unregisterPushDevice = async (endpoint: string) => {
  await apiCall(`${base}/subscriptions`, {
    method: 'DELETE',
    body: { endpoint },
    suppressErrorToast: true,
  });
};

export const sendDoseReminderTest = async () =>
  doseReminderTestResultSchema.parse(
    await apiCall(`${base}/test`, { method: 'POST', suppressErrorToast: true })
  );
