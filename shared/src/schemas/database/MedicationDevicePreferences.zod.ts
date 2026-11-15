import { z } from 'zod';

export const medicationDevicePreferencesSchema = z.object({
  user_id: z.string().uuid(),
  default_syringe_id: z.string().uuid().nullable(),
});
