import { Decimal } from 'decimal.js';

/**
 * A weekly dose target, spread over how many administrations a week the plan's
 * rules give: the per-administration amount behind a per-week figure.
 * Pure, advisory text only; the plan itself is unchanged.
 */

export interface DoseBasisRule {
  schedule_type_id: string;
  days_of_week?: number[] | null;
  interval_days?: number | null;
  cycle_on_days?: number | null;
  cycle_off_days?: number | null;
}

/** Administrations per week one rule gives, or null when it has no steady weekly rhythm. */
function ruleAdministrationsPerWeek(rule: DoseBasisRule): Decimal | null {
  switch (rule.schedule_type_id) {
    case 'daily':
      return new Decimal(7);
    case 'weekly':
    case 'specific_days': {
      const days = new Set(rule.days_of_week ?? []);
      return days.size > 0 ? new Decimal(days.size) : null;
    }
    case 'every_n_days':
      return rule.interval_days && rule.interval_days > 0
        ? new Decimal(7).div(rule.interval_days)
        : null;
    case 'cyclic': {
      const on = rule.cycle_on_days ?? 0;
      const off = rule.cycle_off_days ?? 0;
      return on > 0 ? new Decimal(7).times(on).div(on + off) : null;
    }
    default:
      return null; // monthly, taper and as-needed have no steady weekly rhythm
  }
}

/** Total administrations per week across all rules, or null if any rule is irregular. */
export function administrationsPerWeek(
  rules: readonly DoseBasisRule[]
): Decimal | null {
  if (rules.length === 0) return null;
  let total = new Decimal(0);
  for (const rule of rules) {
    const count = ruleAdministrationsPerWeek(rule);
    if (!count) return null;
    total = total.plus(count);
  }
  return total.gt(0) ? total : null;
}

const plain = (value: Decimal, places: number) =>
  value.toDecimalPlaces(places).toString();

export interface PerAdministrationEstimate {
  /** Amount per administration, trimmed, e.g. "0.5". */
  per_administration: string;
  /** Administrations per week, trimmed, e.g. "2" or "1.17". */
  per_week: string;
}

/** "1 mg a week at 2×/week" gives 0.5 per administration; null when it cannot be worked out. */
export function perAdministrationEstimate(
  weeklyTarget: string | null | undefined,
  rules: readonly DoseBasisRule[]
): PerAdministrationEstimate | null {
  const count = administrationsPerWeek(rules);
  if (!count || !weeklyTarget) return null;
  let target: Decimal;
  try {
    target = new Decimal(weeklyTarget.trim());
  } catch {
    return null;
  }
  if (!target.isFinite() || target.lte(0)) return null;
  return {
    per_administration: plain(target.div(count), 4),
    per_week: plain(count, 2),
  };
}
