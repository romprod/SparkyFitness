import { z } from 'zod';
const owner = z.string().uuid();
export const medicationPurchasesSchema = z.object({
  id: owner,
  user_id: owner,
  vendor: z.string().nullable(),
  reference_encrypted: z.record(z.string(), z.unknown()).nullable(),
  ordered_date: z.string(),
  received_date: z.string().nullable(),
  currency: z.string(),
  shipping_cost: z.string(),
  tax_cost: z.string(),
  other_fees: z.string(),
  discount: z.string(),
  allocation_method: z.enum(['value', 'quantity', 'none']),
  notes_encrypted: z.record(z.string(), z.unknown()).nullable(),
  revision: z.number().int(),
  created_at: z.union([z.date(), z.string()]),
});
export const medicationPurchaseItemsSchema = z.object({
  id: owner,
  user_id: owner,
  purchase_id: owner,
  kind: z.enum(['medication', 'consumable']),
  medication_id: owner.nullable(),
  category: z.string().nullable(),
  description: z.string(),
  quantity: z.number().int(),
  unit_cost: z.string(),
  units_per_pack: z.number().int().nullable(),
  units_per_dose: z.string().nullable(),
  ml_per_piece: z.string().nullable(),
  sort_index: z.number().int(),
});
export const medicationPurchaseVialsSchema = z.object({
  pen_id: owner,
  user_id: owner,
  purchase_item_id: owner,
});
export const medicationPurchasePacksSchema = z.object({
  pack_id: owner,
  user_id: owner,
  purchase_item_id: owner,
});
export const medicationPurchaseOperationsSchema = z.object({
  user_id: owner,
  operation_id: owner,
  request_hash: z.string(),
  purchase_id: owner,
  created_at: z.union([z.date(), z.string()]),
});
