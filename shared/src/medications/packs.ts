import { Decimal } from 'decimal.js';
import { addDays } from '../utils/timezone.ts';
import { isScheduleDueOnDate, type SharedScheduleRule } from './schedules.ts';

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

/**
 * Cost of one pack unit and of the units already used, from one pack's landed cost.
 * Exact decimals; null when the pack size or cost is not a positive amount.
 */
export function packUnitCost(input: {
  landedPack: string | null;
  unitsTotal: string;
  unitsUsed: string;
}): { perUnit: string; consumed: string } | null {
  if (input.landedPack === null) return null;
  try {
    const total = new D(input.unitsTotal);
    const landed = new D(input.landedPack);
    if (!total.gt(0) || !landed.isFinite() || landed.lt(0)) return null;
    const perUnit = landed.div(total);
    return {
      perUnit: perUnit.toDecimalPlaces(6).toString(),
      consumed: perUnit
        .mul(new D(input.unitsUsed))
        .toDecimalPlaces(6)
        .toString(),
    };
  } catch {
    return null;
  }
}

export const PACK_PLAN_HORIZON_DAYS = 365;

export interface PackPlanStock {
  id: string;
  /** Units still in the pack; zero or less counts as empty. */
  remaining: string;
}

export interface PackPlanResult {
  /** Calendar day each pack's units run out under the schedule; null beyond the horizon. */
  byPack: Map<string, { emptyDate: string | null; daysLeft: number | null }>;
  /** True when no scheduled dose draws units, so nothing can be forecast. */
  noDemand: boolean;
}

/**
 * Walks the medication's own schedule day by day and draws units from the packs in the order
 * given (the order logging would pick them). Today's slots already taken are not counted twice.
 * A schedule rule needs a dose amount, from the rule or the medication default; without one
 * the schedule draws nothing and is not guessed at.
 */
export function planPackStock(input: {
  today: string;
  schedules: SharedScheduleRule[];
  defaultDoseAmount: string | null;
  /** Doses already logged as taken today for this medication. */
  takenToday: number;
  packs: PackPlanStock[];
}): PackPlanResult {
  const byPack: PackPlanResult['byPack'] = new Map(
    input.packs.map((pack) => [pack.id, { emptyDate: null, daysLeft: null }])
  );
  const rules = input.schedules.filter(
    (rule) =>
      rule.schedule_type_id !== 'prn' &&
      rule.active !== false &&
      Number(rule.dose_amount ?? input.defaultDoseAmount ?? 0) > 0
  );
  if (rules.length === 0) return { byPack, noDemand: true };
  const unitsOn = (day: string, skip: number) => {
    let left = skip;
    let total = new D(0);
    for (const rule of rules) {
      if (!isScheduleDueOnDate(rule, day)) continue;
      if (left > 0) {
        left--;
        continue;
      }
      total = total.plus(
        new D(String(rule.dose_amount ?? input.defaultDoseAmount))
      );
    }
    return total;
  };
  const queue = input.packs.map((pack) => ({
    id: pack.id,
    left: new D(pack.remaining).lt(0) ? new D(0) : new D(pack.remaining),
  }));
  let index = 0;
  while (index < queue.length && queue[index]!.left.lte(0)) {
    byPack.set(queue[index]!.id, { emptyDate: input.today, daysLeft: 0 });
    index++;
  }
  let sawDemand = false;
  for (
    let offset = 0;
    offset <= PACK_PLAN_HORIZON_DAYS && index < queue.length;
    offset++
  ) {
    const day = addDays(input.today, offset);
    let need = unitsOn(day, offset === 0 ? input.takenToday : 0);
    if (need.gt(0)) sawDemand = true;
    while (need.gt(0) && index < queue.length) {
      const pack = queue[index]!;
      const take = D.min(pack.left, need);
      pack.left = pack.left.minus(take);
      need = need.minus(take);
      if (pack.left.lte(0)) {
        byPack.set(pack.id, { emptyDate: day, daysLeft: offset });
        index++;
        while (index < queue.length && queue[index]!.left.lte(0)) {
          byPack.set(queue[index]!.id, { emptyDate: day, daysLeft: offset });
          index++;
        }
      }
    }
  }
  return { byPack, noDemand: !sawDemand };
}
