import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const SYNONYMS: Record<string, string> = {
  tab: 'tablet',
  pill: 'tablet',
  caplet: 'tablet',
  cap: 'capsule',
  gelcap: 'softgel',
  gel: 'softgel',
  gummie: 'gummy',
  gummies: 'gummy',
};

/**
 * Normalises a unit word ("2 tablets", "Capsules", "scoop (10 ml)") to a family so a
 * dose and a pack can be compared. Unknown words match only themselves.
 */
export function packUnitFamily(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const word = unit
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, '');
  if (!word) return null;
  if (SYNONYMS[word]) return SYNONYMS[word]!;
  const singular = word.endsWith('ies')
    ? `${word.slice(0, -3)}y`
    : word.endsWith('s') && word.length > 3
      ? word.slice(0, -1)
      : word;
  return SYNONYMS[singular] ?? singular;
}

export type PackDeduction =
  | { deducted: true; units: string }
  | { deducted: false; reason: 'no_dose' | 'unit_mismatch' };

/** Units a dose takes from a pack, or why it takes none. Never guesses across unit families. */
export function packDeduction(input: {
  doseAmount: number | string | null | undefined;
  doseUnit: string | null | undefined;
  packUnitLabel: string;
}): PackDeduction {
  let amount: Decimal;
  try {
    amount = new D(input.doseAmount ?? NaN);
  } catch {
    return { deducted: false, reason: 'no_dose' };
  }
  if (!amount.isFinite() || !amount.gt(0))
    return { deducted: false, reason: 'no_dose' };
  const dose = packUnitFamily(input.doseUnit);
  const pack = packUnitFamily(input.packUnitLabel);
  if (!dose || !pack || dose !== pack)
    return { deducted: false, reason: 'unit_mismatch' };
  return { deducted: true, units: amount.toFixed(3) };
}

export function packUnitsRemaining(total: string, used: string): string {
  return new D(total).minus(used).toFixed(3);
}

/** Whole doses left at a given dose size; null when the dose is unknown. Never negative. */
export function packDosesLeft(
  remaining: string,
  doseUnits: string | null
): string | null {
  if (doseUnits === null) return null;
  const dose = new D(doseUnits);
  const left = new D(remaining);
  if (!dose.gt(0)) return null;
  return left.lte(0) ? '0' : left.div(dose).toDecimalPlaces(1).toString();
}

/** Observed pace: units per day over a window, needing a minimum number of doses. */
export function observedDaysLeft(input: {
  remaining: string;
  unitsTakenInWindow: string;
  dosesInWindow: number;
  windowDays: number;
  minDoses?: number;
}): number | null {
  if (input.dosesInWindow < (input.minDoses ?? 3)) return null;
  const perDay = new D(input.unitsTakenInWindow).div(input.windowDays);
  const left = new D(input.remaining);
  if (!perDay.gt(0)) return null;
  if (left.lte(0)) return 0;
  return left.div(perDay).floor().toNumber();
}
