import type {
  InventoryForecastLimitationCode,
  InventoryForecastPlan,
  InventoryForecastPlanInput,
  InventoryForecastCycleAssumption,
} from './inventoryForecastPlan.ts';
/** Use-by days a sealed vial gets once the forecast opens it, when the medication sets none. */
export const FORECAST_SEALED_BUD_DEFAULT_DAYS = 28;
export interface InventoryPreparedContainer {
  id: string;
  status: 'sealed' | 'in_use';
  remaining_ml: string | null;
  concentration_mcg_ml: string | null;
  /** Already resolved explicit date or user-authored interval; null is unknown, not unlimited. */
  usable_until: string | null;
  opened_at: string | null;
  expiry_date: string | null;
  created_at: string;
  /**
   * An unopened vial with no preparation, counted by its label mass in mg: each dose costs its
   * nominal mass, and the vial's use-by clock starts at the first dose the walk draws from it.
   * Omitted for every other container.
   */
  label_mass_mg?: string | null;
  /** Days a sealed vial stays usable once opened; the default applies when omitted. */
  sealed_bud_days?: number | null;
}
export interface InventoryForecastProjection {
  provisional_slots: number;
  projection_starts_on: string | null;
  first_unserved_day: string | null;
  first_unserved_kind: 'committed' | 'projected_restart' | null;
  claim_basis:
    'committed' | 'projected_restart' | 'projected_coverage' | 'unknown';
}
export interface InventoryForecastMathCoverage {
  projection?: InventoryForecastProjection;
  status: 'unknown' | 'covered' | 'ok' | 'reorder_now';
  basis: 'unknown' | 'course_end' | 'horizon' | 'slot_cap' | 'depleted';
  coverage_through: string | null;
  depletion_date: string | null;
  reorder_by: string | null;
  days_left: number | null;
  served_slots: number;
  expected_slots: number;
  lead_days: number;
  buffer_days: number;
  limitations: InventoryForecastLimitationCode[];
}
export interface InventoryForecastMathContainer {
  container_id: string;
  coverage: InventoryForecastMathCoverage;
  remaining_doses: number | null;
  current_dose: { value: string; unit: string; device_id: string } | null;
}
export interface InventoryForecastMathResult extends InventoryForecastMathCoverage {
  cycle_assumptions?: InventoryForecastCycleAssumption[];
  prepared_only: InventoryForecastMathCoverage;
  containers: InventoryForecastMathContainer[];
}
export interface InventoryForecastInput {
  plan: InventoryForecastPlanInput;
  containers: InventoryPreparedContainer[];
  lead_days: number;
  buffer_days: number;
  /** Sealed/unmodelled stock is disclosed and can never produce total purchase urgency. */
  stock_limitations?: InventoryForecastLimitationCode[];
}
export interface InventoryPreparedCoverageInput {
  plan: InventoryForecastPlan;
  containers: InventoryPreparedContainer[];
  today: string;
  route: 'injection' | 'nasal' | null;
  lead_days: number;
  buffer_days: number;
}

import { Decimal } from 'decimal.js';
import {
  computeDraw,
  normalizeDeviceDose,
  type DeviceDose,
  type DrawResult,
} from './draw.ts';
import { isDeviceEligibleForRoute } from './administration.ts';
import { addDays } from '../utils/timezone.ts';
import {
  buildInventoryForecastPlan,
  type InventoryForecastSlot,
} from './inventoryForecastPlan.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const decimal = (value: string | null): Decimal | null => {
  try {
    const n = new D(value ?? '');
    return n.isFinite() ? n : null;
  } catch {
    return null;
  }
};
const dayValid = (day: string | null): day is string =>
  day !== null &&
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day + 'T00:00:00Z')) &&
  new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000
  );
const orderedContainers = (containers: InventoryPreparedContainer[]) =>
  [...containers].sort(
    (a, b) =>
      Number(b.status === 'in_use') - Number(a.status === 'in_use') ||
      (a.expiry_date ?? '9999-99-99').localeCompare(
        b.expiry_date ?? '9999-99-99'
      ) ||
      b.created_at.localeCompare(a.created_at) ||
      a.id.localeCompare(b.id)
  );
const withLimits = (
  base: InventoryForecastMathCoverage,
  limitations: Iterable<InventoryForecastLimitationCode>
): InventoryForecastMathCoverage => ({
  ...base,
  limitations: [...new Set([...base.limitations, ...limitations])],
});
function projection(
  plan: InventoryForecastPlan | undefined,
  claim: InventoryForecastProjection['claim_basis'],
  failed?: InventoryForecastSlot
): { projection?: InventoryForecastProjection } {
  if (plan?.forecast_mode !== 'planned_cycles') return {};
  const provisional = plan.slots.filter(
    (slot) => slot.demand_kind === 'projected_restart'
  );
  return {
    projection: {
      provisional_slots: provisional.length,
      projection_starts_on: provisional.some((slot) => slot.date_basis_unknown)
        ? null
        : (provisional[0]?.day ?? null),
      first_unserved_day: failed?.day ?? null,
      first_unserved_kind: failed?.demand_kind ?? null,
      claim_basis: claim,
    },
  };
}
function unknown(
  input: Pick<InventoryPreparedCoverageInput, 'lead_days' | 'buffer_days'> & {
    plan?: InventoryForecastPlan;
  },
  count: number,
  limitations: Iterable<InventoryForecastLimitationCode>,
  served = 0
): InventoryForecastMathCoverage {
  return {
    ...projection(input.plan, 'unknown'),
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
    served_slots: served,
    expected_slots: count,
    lead_days: input.lead_days,
    buffer_days: input.buffer_days,
    limitations: [...new Set(limitations)],
  };
}
function normalizedDose(slot: InventoryForecastSlot): DeviceDose | null {
  const value = decimal(slot.value);
  if (value === null || !value.gt(0) || slot.unit === null) return null;
  switch (slot.unit.trim().toLowerCase()) {
    case 'mcg':
    case 'ug':
    case 'µg':
    case 'μg':
      return { value: value.toString(), unit: 'mcg' };
    case 'mg':
      return { value: value.toString(), unit: 'mg' };
    case 'g':
      return { value: value.times(1000).toString(), unit: 'mg' };
    case 'ml':
      return { value: value.toString(), unit: 'ml' };
    case 'units':
      return { value: value.toString(), unit: 'units' };
    case 'pumps':
      return { value: value.toString(), unit: 'pumps' };
    default:
      return null;
  }
}
function sizedDraw(
  slot: InventoryForecastSlot,
  container: InventoryPreparedContainer,
  route: InventoryPreparedCoverageInput['route'],
  remaining?: string
): { draw: DrawResult | null; reason: InventoryForecastLimitationCode | null } {
  if (route === null) return { draw: null, reason: 'unsupported_route' };
  if (slot.device === null) return { draw: null, reason: 'missing_device' };
  if (!isDeviceEligibleForRoute(slot.device.device.device_type, route))
    return { draw: null, reason: 'incompatible_device' };
  const dose = normalizedDose(slot);
  if (dose === null)
    return {
      draw: null,
      reason: decimal(slot.value)?.gt(0) ? 'unsupported_unit' : 'unknown_dose',
    };
  const concentration = decimal(container.concentration_mcg_ml);
  if (concentration === null || !concentration.gt(0))
    return { draw: null, reason: 'unknown_stock' };
  try {
    const normalized = normalizeDeviceDose(dose, slot.device.device);
    const draw = computeDraw({
      dose: normalized,
      concentrationMcgPerMl: concentration.toString(),
      syringe: slot.device.device,
      ...(remaining === undefined ? {} : { remainingMl: remaining }),
    });
    if (!new D(draw.deliveredVolumeMl).gt(0))
      return { draw: null, reason: 'blocked_draw' };
    return { draw, reason: null };
  } catch {
    return { draw: null, reason: 'blocked_draw' };
  }
}
/** An unopened, unprepared vial's label mass in mcg, or null for any container with a concentration. */
function labelMassMcg(container: InventoryPreparedContainer): Decimal | null {
  if (container.concentration_mcg_ml !== null) return null;
  const mass = decimal(container.label_mass_mg ?? null);
  return mass?.gt(0) ? mass.times(1000) : null;
}
/** A dose as mass in mcg, or null when its unit needs a concentration a sealed vial lacks. */
function doseMassMcg(slot: InventoryForecastSlot): Decimal | null {
  const dose = normalizedDose(slot);
  if (dose === null) return null;
  if (dose.unit === 'mcg') return new D(dose.value);
  if (dose.unit === 'mg') return new D(dose.value).times(1000);
  return null;
}
/** Known prepared-stock model. Caller must keep its scope separate from whole inventory. */
export function forecastPreparedCoverage(
  input: InventoryPreparedCoverageInput
): InventoryForecastMathCoverage {
  if (
    !Number.isInteger(input.lead_days) ||
    input.lead_days < 0 ||
    input.lead_days > 2147483647 ||
    !Number.isInteger(input.buffer_days) ||
    input.buffer_days < 0 ||
    input.buffer_days > 2147483647
  )
    throw new RangeError('Invalid reorder preferences');
  const slots = input.plan.slots;
  const limitations = new Set(input.plan.limitations);
  if (
    limitations.has('unmodelled_legacy_demand') ||
    limitations.has('unknown_projection_date')
  )
    return unknown(input, slots.length, limitations);
  if (!slots.length)
    return unknown(input, 0, [...limitations, 'no_forecast_slots']);
  const live = orderedContainers(input.containers).map((container) => ({
    container,
    pool: decimal(container.remaining_ml),
    // An unopened, unprepared vial is walked by its label mass, as Pitstop does.
    mass: labelMassMcg(container),
    until: container.usable_until,
    opened: false,
  }));
  let served = 0,
    provisionalServed = false,
    last: string | null = null;
  for (const slot of slots) {
    let filled = false,
      evaluable = false;
    const rowLimits = new Set<InventoryForecastLimitationCode>();
    for (const item of live) {
      if (item.mass !== null) {
        // No concentration exists yet, so syringe rounding cannot be known: a sealed vial is
        // charged the nominal dose, which slightly overstates how far it stretches. An ml or
        // unit dose cannot be sized against it at all.
        const need = doseMassMcg(slot);
        if (need === null || !need.gt(0)) continue;
        evaluable = true;
        if (dayValid(item.until) && slot.day > item.until) continue;
        if (item.mass.lt(need)) continue;
        if (!item.opened) {
          // The use-by clock starts at the first dose actually drawn, not the first attempt.
          item.opened = true;
          const days =
            item.container.sealed_bud_days ?? FORECAST_SEALED_BUD_DEFAULT_DAYS;
          const bud = addDays(slot.day, days);
          if (!dayValid(item.until) || bud < item.until) item.until = bud;
        }
        item.mass = item.mass.minus(need);
        filled = true;
        break;
      }
      const sizing = sizedDraw(
        slot,
        item.container,
        input.route,
        item.pool?.gte(0) ? item.pool.toString() : undefined
      );
      if (sizing.draw === null) {
        if (sizing.reason) rowLimits.add(sizing.reason);
        continue;
      }
      const draw = sizing.draw;
      // A physically blocked capacity is not an available forecast draw.
      const blockers = draw.warnings.filter(
        (warning) => warning.severity === 'block'
      );
      if (
        blockers.some((warning) => warning.code !== 'EXCEEDS_REMAINING_VIAL')
      ) {
        rowLimits.add('blocked_draw');
        continue;
      }
      if (
        dayValid(item.container.usable_until) &&
        slot.day > item.container.usable_until
      ) {
        evaluable = true;
        continue;
      }
      if (item.pool === null || item.pool.lt(0)) {
        rowLimits.add('unknown_stock');
        continue;
      }
      if (!dayValid(item.container.usable_until) && item.pool.gt(0)) {
        rowLimits.add('unknown_bud');
        continue;
      }
      evaluable = true;
      const need = new D(draw.deliveredVolumeMl);
      if (blockers.length || item.pool.lt(need)) continue;
      item.pool = item.pool.minus(need);
      filled = true;
      break;
    }
    for (const reason of rowLimits) limitations.add(reason);
    if (filled) {
      served++;
      if (slot.demand_kind === 'projected_restart') provisionalServed = true;
      last = slot.day;
      continue;
    }
    if (!evaluable)
      return unknown(
        input,
        slots.length,
        [...limitations, ...(live.length ? [] : ['unknown_stock' as const])],
        served
      );
    const depletion = last !== null && last > input.today ? last : input.today;
    const coverage = Math.max(
      0,
      last === null ? 0 : daysBetween(input.today, last)
    );
    const projectedFailure = slot.demand_kind === 'projected_restart';
    const needDistance = projectedFailure
      ? Math.max(0, daysBetween(input.today, slot.day))
      : coverage;
    const shifted = new Date(
      Date.parse((projectedFailure ? slot.day : depletion) + 'T00:00:00Z') -
        input.lead_days * 86400000
    );
    let reorder: string | null = null;
    if (Number.isFinite(shifted.getTime())) {
      const iso = shifted.toISOString();
      const date = iso.slice(0, 10);
      if (dayValid(date)) reorder = date < input.today ? input.today : date;
    }
    if (reorder === null)
      return unknown(
        input,
        slots.length,
        [...limitations, 'date_out_of_range'],
        served
      );
    return {
      ...projection(
        input.plan,
        projectedFailure
          ? 'projected_restart'
          : provisionalServed
            ? 'projected_coverage'
            : 'committed',
        slot
      ),
      status:
        needDistance <= input.lead_days + input.buffer_days
          ? 'reorder_now'
          : 'ok',
      basis: 'depleted',
      coverage_through: last ?? input.today,
      depletion_date: depletion,
      reorder_by: reorder,
      days_left: coverage,
      served_slots: served,
      expected_slots: slots.length,
      lead_days: input.lead_days,
      buffer_days: input.buffer_days,
      limitations: [...limitations],
    };
  }
  const end = last;
  return {
    ...projection(
      input.plan,
      input.plan.slots.some((slot) => slot.demand_kind === 'projected_restart')
        ? 'projected_coverage'
        : 'committed'
    ),
    status: 'covered',
    basis: input.plan.basis,
    coverage_through: end,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
    served_slots: served,
    expected_slots: slots.length,
    lead_days: input.lead_days,
    buffer_days: input.buffer_days,
    limitations: [...limitations],
  };
}
function currentUniqueDose(plan: InventoryForecastPlan): {
  slot: InventoryForecastSlot;
  value: string;
  unit: string;
  device_id: string;
} | null {
  if (plan.limitations.includes('unmodelled_legacy_demand')) return null;
  const perPlan = new Map<string, InventoryForecastSlot>();
  for (const slot of plan.current_targets ?? plan.slots) {
    const key = `${slot.plan_kind}:${slot.plan_id}:${slot.rule_id}`;
    if (!perPlan.has(key)) perPlan.set(key, slot);
  }
  const values = [...perPlan.values()];
  if (!values.length) return null;
  const first = values[0]!,
    dose = normalizedDose(first);
  if (!dose || !first.device) return null;
  if (
    values.some((slot) => {
      const other = normalizedDose(slot);
      return (
        !other ||
        !slot.device ||
        other.unit !== dose.unit ||
        other.value !== dose.value ||
        slot.device.id !== first.device!.id
      );
    })
  )
    return null;
  return {
    slot: first,
    value: dose.value,
    unit: dose.unit,
    device_id: first.device.id,
  };
}
/** Aggregated committed demand; excluded stock never creates a total purchase alert. */
export function buildInventoryForecast(
  input: InventoryForecastInput
): InventoryForecastMathResult {
  const plan = buildInventoryForecastPlan(input.plan);
  const context = {
    plan,
    containers: input.containers,
    today: input.plan.today,
    route: input.plan.route,
    lead_days: input.lead_days,
    buffer_days: input.buffer_days,
  };
  const prepared = forecastPreparedCoverage(context);
  const allLimits = new Set([
    ...prepared.limitations,
    ...(input.stock_limitations ?? []),
  ]);
  const demandCodes = new Set<InventoryForecastLimitationCode>([
    'no_managed_plan',
    'no_forecast_slots',
    'unmodelled_legacy_demand',
    'unknown_dose',
    'unsupported_unit',
    'missing_device',
    'incompatible_device',
    'unsupported_route',
    'date_out_of_range',
    'unknown_projection_date',
  ]);
  const unmodelledDemand = [...allLimits].some((code) => demandCodes.has(code));
  const excludedStock = [...allLimits].some(
    (code) =>
      code === 'sealed_stock_excluded' ||
      code === 'unknown_stock' ||
      code === 'unknown_bud'
  );
  const complete = prepared.status === 'covered' && !unmodelledDemand;
  const overall =
    unmodelledDemand || (excludedStock && !complete)
      ? unknown(
          context,
          prepared.expected_slots,
          allLimits,
          prepared.served_slots
        )
      : withLimits(prepared, allLimits);
  const uniqueDose = currentUniqueDose(plan);
  const containers = input.containers.map((container) => {
    let remaining: number | null = null;
    const labelMass = labelMassMcg(container);
    if (uniqueDose && labelMass) {
      const need = doseMassMcg(uniqueDose.slot);
      if (need?.gt(0)) remaining = labelMass.div(need).floor().toNumber();
    } else if (uniqueDose) {
      const pool = decimal(container.remaining_ml),
        sized = sizedDraw(uniqueDose.slot, container, input.plan.route);
      if (
        pool?.gte(0) &&
        sized.draw &&
        !sized.draw.warnings.some((warning) => warning.severity === 'block')
      ) {
        const rounded = new D(sized.draw.deliveredVolumeMl);
        const required = D.max(rounded, sized.draw.targetVolumeMl);
        const count = pool.lt(required)
          ? new D(0)
          : pool.minus(required).div(rounded).floor().plus(1);
        if (count.lte(Number.MAX_SAFE_INTEGER)) remaining = count.toNumber();
      }
    }
    return {
      container_id: container.id,
      coverage: forecastPreparedCoverage({
        ...context,
        containers: [container],
      }),
      remaining_doses: remaining,
      current_dose: uniqueDose
        ? {
            value: uniqueDose.value,
            unit: uniqueDose.unit,
            device_id: uniqueDose.device_id,
          }
        : null,
    };
  });
  return {
    ...overall,
    ...(input.plan.forecast_mode === 'planned_cycles'
      ? { cycle_assumptions: plan.cycle_assumptions ?? [] }
      : {}),
    prepared_only: prepared,
    containers,
  };
}
