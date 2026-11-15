import { z } from 'zod';
import {
  PURCHASE_CONSUMABLE_CATEGORIES,
  normalizePurchaseDecimal,
  type PurchaseAllocation,
} from '../../medications/purchaseCosts.ts';
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || null);
const decimal = z
  .string()
  .default('')
  .transform((value, context) => {
    const normalized = normalizePurchaseDecimal(value);
    if (normalized === null) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid nonnegative amount',
      });
      return z.NEVER;
    }
    return normalized;
  });
const optionalDecimal = z
  .string()
  .nullish()
  .transform((value, context) => {
    if (!value?.trim()) return null;
    const normalized = normalizePurchaseDecimal(value);
    if (normalized === null) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid nonnegative amount',
      });
      return z.NEVER;
    }
    return normalized;
  });
const integer = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().int().positive().max(2147483647));
const optionalInteger = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) =>
    value == null || (typeof value === 'string' && !value.trim())
      ? null
      : Number(value)
  )
  .pipe(z.number().int().positive().max(2147483647).nullable());
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number),
      parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      year! >= 1 &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() + 1 === month &&
      parsed.getUTCDate() === day
    );
  });
export const medicationPurchaseItemInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(['medication', 'consumable']),
    medication_id: z.string().uuid().nullish(),
    category: z.enum(PURCHASE_CONSUMABLE_CATEGORIES).catch('other').optional(),
    description: optionalText,
    quantity: integer,
    unit_cost: decimal,
    units_per_pack: optionalInteger,
    units_per_dose: optionalDecimal,
    vial_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((item) => item.kind !== 'consumable' || Boolean(item.description), {
    path: ['description'],
  });
export const medicationPurchaseInputSchema = z
  .object({
    vendor: optionalText,
    reference: optionalText,
    ordered_date: date,
    received_date: z
      .union([date, z.literal('')])
      .nullish()
      .transform((value) => value || null),
    currency: z
      .string()
      .trim()
      .default('AUD')
      .transform((value) => value || 'AUD'),
    shipping_cost: decimal,
    tax_cost: decimal,
    other_fees: decimal,
    discount: decimal,
    allocation_method: z.enum(['value', 'quantity', 'none']).default('value'),
    notes: optionalText,
    items: z.array(medicationPurchaseItemInputSchema).min(1),
  })
  .refine(
    (value) =>
      !value.received_date || value.received_date >= value.ordered_date,
    { path: ['received_date'] }
  );
export const medicationPurchaseCreateSchema =
  medicationPurchaseInputSchema.safeExtend({
    expected_owner_id: z.string().uuid(),
    operation_id: z.string().uuid(),
  });
export const medicationPurchaseUpdateSchema =
  medicationPurchaseInputSchema.safeExtend({
    expected_owner_id: z.string().uuid(),
    expected_revision: z.number().int().positive(),
  });
export const medicationPurchaseDeleteSchema = z.object({
  expected_owner_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
});
export type MedicationPurchaseInput = z.input<
  typeof medicationPurchaseInputSchema
>;
export type MedicationPurchaseValues = z.output<
  typeof medicationPurchaseInputSchema
>;
export type MedicationPurchaseCreateInput = z.input<
  typeof medicationPurchaseCreateSchema
>;
export type MedicationPurchaseUpdateInput = z.input<
  typeof medicationPurchaseUpdateSchema
>;
export type MedicationPurchaseDeleteInput = z.input<
  typeof medicationPurchaseDeleteSchema
>;
export interface MedicationPurchaseItem extends Omit<
  MedicationPurchaseValues['items'][number],
  'id' | 'medication_id' | 'category' | 'description'
> {
  id: string;
  medication_id: string | null;
  category: (typeof PURCHASE_CONSUMABLE_CATEGORIES)[number] | null;
  description: string;
  medication_name: string | null;
  subtotal: string;
  allocated: string;
  landed: string;
  landed_unit: string | null;
}
export interface MedicationPurchaseView extends Omit<
  MedicationPurchaseValues,
  'items'
> {
  id: string;
  revision: number;
  created_at: string;
  items: MedicationPurchaseItem[];
  totals: PurchaseAllocation;
  vials_expected: number;
  vials_linked: number;
}
export interface MedicationPurchaseEditorData {
  medications: { id: string; name: string }[];
  vials: {
    id: string;
    medication_id: string;
    medication_name: string;
    label: string | null;
    /** Current saved preparation content; null when no preparation is recorded. */
    prepared_mass_mg?: string | null;
    status: string;
    lot_number: string | null;
    expiry_date: string | null;
    purchase_item_id: string | null;
  }[];
}
export interface MedicationVialCost {
  pen_id: string;
  is_costed: boolean;
  purchase_id?: string;
  purchase_item_id?: string;
  currency?: string;
  landed_unit?: string | null;
}
