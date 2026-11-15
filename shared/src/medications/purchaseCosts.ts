import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type PurchaseAllocationMethod = 'value' | 'quantity' | 'none';
export const PURCHASE_CONSUMABLE_CATEGORIES = [
  'needle',
  'syringe',
  'swab',
  'sharps_container',
  'pen_tip',
  'bac_water',
  'other',
] as const;
export type PurchaseConsumableCategory =
  (typeof PURCHASE_CONSUMABLE_CATEGORIES)[number];
export interface PurchaseAllocationInput {
  lines: { id: string; quantity: number; unit_cost: string }[];
  shipping_cost?: string | null;
  tax_cost?: string | null;
  other_fees?: string | null;
  discount?: string | null;
  allocation_method: PurchaseAllocationMethod;
}
export interface PurchaseAllocation {
  lines: {
    id: string;
    subtotal: string;
    allocated: string;
    landed: string;
    landed_unit: string | null;
  }[];
  subtotal: string;
  overhead: string;
  total: string;
  unallocated: string;
  effective_method: PurchaseAllocationMethod | 'quantity-fallback';
}
const amount = (value: string | null | undefined) => {
  try {
    const number = new D(value || '0');
    return number.isFinite() ? number : new D(0);
  } catch {
    return new D(0);
  }
};
const money = (value: Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
/** Invoice amounts remain unrounded until the reference's allocation/payment boundaries. */
export function allocateMedicationPurchase(
  input: PurchaseAllocationInput
): PurchaseAllocation {
  const { lines, allocation_method: method } = input;
  const overhead = amount(input.shipping_cost)
    .plus(amount(input.tax_cost))
    .plus(amount(input.other_fees))
    .minus(amount(input.discount));
  const subtotals = lines.map((line) =>
    amount(line.unit_cost).times(line.quantity)
  );
  const subtotal = subtotals.reduce((sum, value) => sum.plus(value), new D(0));
  const zeroed = (
    effective_method: PurchaseAllocation['effective_method']
  ): PurchaseAllocation => ({
    lines: lines.map((line, i) => ({
      id: line.id,
      subtotal: money(subtotals[i]!).toFixed(2),
      allocated: '0.00',
      landed: money(subtotals[i]!).toFixed(2),
      landed_unit:
        line.quantity > 0 ? subtotals[i]!.div(line.quantity).toString() : null,
    })),
    subtotal: money(subtotal).toFixed(2),
    overhead: money(overhead).toFixed(2),
    total: money(subtotal.plus(overhead)).toFixed(2),
    unallocated: money(overhead).toFixed(2),
    effective_method,
  });
  if (method === 'none' || lines.length === 0 || overhead.isZero()) {
    const result = zeroed(method);
    return overhead.isZero() && method !== 'none'
      ? { ...result, unallocated: '0.00' }
      : result;
  }
  let effective_method: PurchaseAllocation['effective_method'] = method;
  const bases =
    method === 'value' && subtotal.gt(0)
      ? subtotals
      : lines.map((line) => new D(Math.max(0, line.quantity)));
  if (method === 'value' && !subtotal.gt(0))
    effective_method = 'quantity-fallback';
  const basisTotal = bases.reduce((sum, value) => sum.plus(value), new D(0));
  if (basisTotal.lte(0)) return zeroed(effective_method);
  const allocated = bases.map((basis) =>
    money(overhead.times(basis).div(basisTotal))
  );
  const residual = money(overhead).minus(
    allocated.reduce((sum, value) => sum.plus(value), new D(0))
  );
  if (!residual.isZero()) {
    let biggest = 0;
    for (let i = 1; i < bases.length; i++)
      if (bases[i]!.gt(bases[biggest]!)) biggest = i;
    allocated[biggest] = allocated[biggest]!.plus(residual);
  }
  return {
    lines: lines.map((line, i) => {
      const landed = subtotals[i]!.plus(allocated[i]!);
      return {
        id: line.id,
        subtotal: money(subtotals[i]!).toFixed(2),
        allocated: allocated[i]!.toFixed(2),
        landed: money(landed).toFixed(2),
        landed_unit:
          line.quantity > 0 ? landed.div(line.quantity).toString() : null,
      };
    }),
    subtotal: money(subtotal).toFixed(2),
    overhead: money(overhead).toFixed(2),
    total: money(subtotal.plus(overhead)).toFixed(2),
    unallocated: '0.00',
    effective_method,
  };
}
/** Source currency-text prefix, with exact decimal display instead of Number clipping. */
export function formatPurchaseMoney(
  value: string,
  currency: string,
  _locale?: string
): string {
  try {
    return `${currency} ${new D(value).toFixed(2)}`;
  } catch {
    return '—';
  }
}
export function normalizePurchaseDecimal(value: string): string | null {
  try {
    const number = new D(value.trim() || '0');
    // PostgreSQL NUMERIC's representable scale/exponent, not a product money cap.
    return number.isFinite() &&
      number.gte(0) &&
      number.e <= 131071 &&
      number.e >= -16383 &&
      number.decimalPlaces() <= 16383
      ? number.toString()
      : null;
  } catch {
    return null;
  }
}
