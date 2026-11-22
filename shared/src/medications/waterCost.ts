import { Decimal } from 'decimal.js';
import {
  allocateMedicationPurchase,
  type PurchaseAllocationInput,
} from './purchaseCosts.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** An invoice reduced to what the water cost needs; the cost report's invoice satisfies it. */
export interface WaterCostInvoice extends Omit<
  PurchaseAllocationInput,
  'lines'
> {
  currency: string;
  lines: (PurchaseAllocationInput['lines'][number] & {
    kind: 'medication' | 'consumable';
    category?: string | null;
    units_per_pack?: number | null;
    ml_per_piece?: string | null;
  })[];
}

/** What a millilitre of bacteriostatic water cost, landed, averaged over every bottle with a known size. */
export interface WaterCostPerMl {
  /** Landed cost per mL, unrounded. */
  rate: string;
  currency: string;
  /** Millilitres bought across the lines that set a bottle size. */
  ml: string;
  /** Landed spend on those lines. */
  spend: string;
}

const positive = (value: string | null | undefined): Decimal | null => {
  if (value === null || value === undefined || !value.trim()) return null;
  try {
    const number = new D(value);
    return number.isFinite() && number.gt(0) ? number : null;
  } catch {
    return null;
  }
};

/**
 * A bacteriostatic-water line with a bottle size is costed through the vials it is mixed into,
 * not as a flat per-dose sundry, so it is never counted both ways.
 */
export function isWaterCostedThroughVials(line: {
  kind: string;
  category?: string | null;
  ml_per_piece?: string | null;
}): boolean {
  return (
    line.kind === 'consumable' &&
    line.category === 'bac_water' &&
    positive(line.ml_per_piece) !== null
  );
}

/**
 * The landed cost of one millilitre of bacteriostatic water: every water line that states its bottle
 * size, including its share of shipping and fees, over the millilitres those lines bought. Null when
 * no line states a size, or the lines are in different currencies.
 */
export function waterCostPerMl(
  invoices: WaterCostInvoice[]
): WaterCostPerMl | null {
  let spend = new D(0),
    ml = new D(0);
  const currencies = new Set<string>();
  for (const invoice of invoices) {
    const landed = new Map(
      allocateMedicationPurchase(invoice).lines.map((line) => [line.id, line])
    );
    for (const line of invoice.lines) {
      if (!isWaterCostedThroughVials(line)) continue;
      const size = positive(line.ml_per_piece),
        cost = landed.get(line.id);
      if (size === null || !cost || !(line.quantity > 0)) continue;
      const bottles = new D(line.units_per_pack ?? 1).times(line.quantity);
      if (!bottles.gt(0)) continue;
      spend = spend.plus(cost.landed);
      ml = ml.plus(bottles.times(size));
      currencies.add(invoice.currency);
    }
  }
  if (!ml.gt(0) || currencies.size !== 1) return null;
  return {
    rate: spend.div(ml).toString(),
    currency: [...currencies][0]!,
    ml: ml.toString(),
    spend: spend.toString(),
  };
}

/** The water a vial was mixed with, costed; null when the vial has no recorded diluent or no price is known. */
export function vialWaterCost(
  diluent_ml: string | null | undefined,
  water: WaterCostPerMl | null
): Decimal | null {
  const volume = positive(diluent_ml);
  if (volume === null || water === null) return null;
  return volume.times(water.rate);
}
