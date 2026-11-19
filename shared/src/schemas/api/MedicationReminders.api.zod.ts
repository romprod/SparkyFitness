import { z } from 'zod';

/** A 24-hour local clock time, "HH:MM". */
export const reminderClockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 08:00');

export const DEFAULT_DOSE_REMINDER_SETTINGS = {
  untimed_time: '08:00',
  nag_enabled: true,
  nag_time: '18:00',
  include_supplements: true,
} as const;

/** Per-owner dose reminder preferences; one row per user, defaults when absent. */
export const doseReminderSettingsSchema = z.object({
  /** When doses with no set time remind, in the owner's timezone. */
  untimed_time: reminderClockSchema,
  /** One evening summary of doses still not logged. */
  nag_enabled: z.boolean(),
  nag_time: reminderClockSchema,
  /** Supplements remind alongside medicines when true. */
  include_supplements: z.boolean(),
});
export type DoseReminderSettings = z.infer<typeof doseReminderSettingsSchema>;

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'Expected a base64url value');

/** The browser's PushSubscription.toJSON(), trimmed to what delivery needs. */
export const webPushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: base64Url(200),
    auth: base64Url(64),
  }),
  user_agent: z.string().max(400).optional(),
});
export type WebPushSubscriptionInput = z.infer<
  typeof webPushSubscriptionInputSchema
>;

export const webPushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export const webPushSubscriptionViewSchema = z.object({
  id: z.string().uuid(),
  endpoint: z.string(),
  user_agent: z.string().nullable(),
  created_at: z.string(),
  last_success_at: z.string().nullable(),
});
export type WebPushSubscriptionView = z.infer<
  typeof webPushSubscriptionViewSchema
>;

export const doseReminderStatusSchema = z.object({
  /** VAPID application server key for pushManager.subscribe(), or null when push is unavailable. */
  public_key: z.string().nullable(),
  settings: doseReminderSettingsSchema,
  subscriptions: z.array(webPushSubscriptionViewSchema),
});
export type DoseReminderStatus = z.infer<typeof doseReminderStatusSchema>;

export const doseReminderTestResultSchema = z.object({
  delivered: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
});
export type DoseReminderTestResult = z.infer<
  typeof doseReminderTestResultSchema
>;
