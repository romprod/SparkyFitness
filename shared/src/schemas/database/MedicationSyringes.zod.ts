import { z } from 'zod';
export const medicationSyringesSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  device_type: z.enum(['syringe', 'pen', 'pump']).default('syringe'),
  name: z.string(),
  graduation_type: z.enum(['units', 'ml']),
  units_per_ml: z.number().int(),
  capacity_ml: z.string(),
  capacity_units: z.number().int(),
  increment: z.string(),
  is_default: z.boolean(),
  created_at: z.union([z.date(), z.string()]),
  updated_at: z.union([z.date(), z.string()]),
});
