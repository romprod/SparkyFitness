import { z } from 'zod';

const timestamp = z.union([z.date(), z.string()]);

export const medicationReminderSettingsSchema = z.object({
  user_id: z.string().uuid(),
  untimed_time: z.string(),
  nag_enabled: z.boolean(),
  nag_time: z.string(),
  include_supplements: z.boolean(),
  updated_at: timestamp,
});
export type MedicationReminderSettingsRow = z.infer<
  typeof medicationReminderSettingsSchema
>;

export const medicationReminderSendsSchema = z.object({
  user_id: z.string().uuid(),
  reminder_day: z.union([z.date(), z.string()]),
  reminder_key: z.string(),
  channel: z.enum(['pending', 'webpush']),
  delivered: z.number().int().nonnegative(),
  sent_at: timestamp,
});
export type MedicationReminderSendsRow = z.infer<
  typeof medicationReminderSendsSchema
>;

export const webPushSubscriptionsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  user_agent: z.string().nullable(),
  created_at: timestamp,
  last_success_at: timestamp.nullable(),
});
export type WebPushSubscriptionsRow = z.infer<
  typeof webPushSubscriptionsSchema
>;
