import { z } from 'zod';
export const medicationStockStatusAuditSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  pen_id: z.string().uuid(),
  old_status: z.string(),
  new_status: z.string(),
  created_at: z.union([z.date(), z.string()]),
});
