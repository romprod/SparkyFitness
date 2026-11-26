import { z } from 'zod';

const timestamp = z.union([z.date(), z.string()]);

export const medicationStacksSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  notes: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type MedicationStacksRow = z.infer<typeof medicationStacksSchema>;

export const medicationStackMembersSchema = z.object({
  stack_id: z.string().uuid(),
  user_id: z.string().uuid(),
  medication_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
});
export type MedicationStackMembersRow = z.infer<
  typeof medicationStackMembersSchema
>;

export const medicationStackSchedulesSchema = z.object({
  stack_id: z.string().uuid(),
  user_id: z.string().uuid(),
  schedule_type_id: z.enum([
    'daily',
    'specific_days',
    'every_n_days',
    'cyclic',
  ]),
  time_of_day: z.string().nullable(),
  days_of_week: z.array(z.number().int().min(0).max(6)).nullable(),
  interval_days: z.number().int().nullable(),
  cycle_on_days: z.number().int().nullable(),
  cycle_off_days: z.number().int().nullable(),
  start_date: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type MedicationStackSchedulesRow = z.infer<
  typeof medicationStackSchedulesSchema
>;

export const medicationStackScheduleBindingsSchema = z.object({
  medication_id: z.string().uuid(),
  stack_id: z.string().uuid(),
  user_id: z.string().uuid(),
  applied_version: z.number().int().nonnegative(),
  bound_at: timestamp,
});
export type MedicationStackScheduleBindingsRow = z.infer<
  typeof medicationStackScheduleBindingsSchema
>;
