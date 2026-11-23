import { Decimal } from 'decimal.js';
import type {
  BlendSource,
  MedicationBlendComponent,
} from '../schemas/api/MedicationBlends.api.zod.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Vendor blends, as Pitstop models them: a blend is one medication whose doses are logged as the
 * whole blend. What each compound in it received is worked out here when it is read and is never
 * written to a dose, and every figure carries the source of the ratio it came from (label,
 * certificate of analysis, or assumed) so a derived mass cannot pass for a measured one.
 *
 * Pure: strings in, strings out, so nothing is rounded before it is shown.
 */

/** The slice of a blend the arithmetic reads. */
export type BlendComponentRatio = Pick<
  MedicationBlendComponent,
  'component_medication_id' | 'name' | 'mass_mg' | 'source' | 'sort_index'
>;

export interface DerivedComponentDose {
  component_medication_id: string;
  name: string;
  /** What this component's share of the dose comes to, in mg. */
  dose_mg: string;
  /** The share of the blend this component is, 0 to 1. */
  fraction: string;
  source: BlendSource;
}

export interface ComponentCost {
  component_medication_id: string;
  name: string;
  cost: string;
  fraction: string;
  source: BlendSource;
}

const bySortIndex = (a: BlendComponentRatio, b: BlendComponentRatio) =>
  a.sort_index - b.sort_index;

const positive = (
  value: string | number | null | undefined
): Decimal | null => {
  if (value === null || value === undefined || value === '') return null;
  try {
    const n = new D(value);
    return n.isFinite() && n.gt(0) ? n : null;
  } catch {
    return null;
  }
};

/** Components whose mass can be used, in their saved order. */
const usable = (components: readonly BlendComponentRatio[]) =>
  [...components].sort(bySortIndex).flatMap((component) => {
    const mass = positive(component.mass_mg);
    return mass ? [{ component, mass }] : [];
  });

/** The mass of one labelled vial of the blend, in mg: the sum of its components. */
export function blendTotalMg(
  components: readonly BlendComponentRatio[]
): string {
  return usable(components)
    .reduce((sum, { mass }) => sum.plus(mass), new D(0))
    .toString();
}

/**
 * Split a dose of the whole blend, in mg, into what each component delivered. Empty when there
 * are no components or the dose is not a usable amount, so a non-blend is left untouched.
 */
export function expandBlendDose(
  doseMg: string | number | null | undefined,
  components: readonly BlendComponentRatio[]
): DerivedComponentDose[] {
  if (doseMg === null || doseMg === undefined || doseMg === '') return [];
  let dose: Decimal;
  try {
    dose = new D(doseMg);
  } catch {
    return [];
  }
  if (!dose.isFinite() || dose.lt(0)) return [];
  const rows = usable(components);
  const total = rows.reduce((sum, { mass }) => sum.plus(mass), new D(0));
  if (total.lte(0)) return [];
  return rows.map(({ component, mass }) => {
    const fraction = mass.div(total);
    return {
      component_medication_id: component.component_medication_id,
      name: component.name,
      dose_mg: dose.mul(fraction).toString(),
      fraction: fraction.toString(),
      source: component.source,
    };
  });
}

const SOURCE_RANK: Record<BlendSource, number> = {
  assumed: 0,
  coa: 1,
  label: 2,
};

/**
 * The provenance a derived split may claim: the weakest source among the components. One assumed
 * ratio taints every share, since all shares divide by the same total.
 */
export function weakestBlendSource(
  components: readonly Pick<BlendComponentRatio, 'source'>[]
): BlendSource {
  let weakest: BlendSource = 'label';
  for (const component of components)
    if (SOURCE_RANK[component.source] < SOURCE_RANK[weakest])
      weakest = component.source;
  return weakest;
}

/**
 * Round split masses for display so the parts add up to the rounded whole (largest remainder at
 * `dp` decimals). Rounding each part on its own prints figures that add up to a little more or
 * less than the dose printed beside them.
 */
export function roundSplitForDisplay(
  values: readonly number[],
  dp: number = 1
): number[] {
  const factor = 10 ** dp;
  const total = Math.round(values.reduce((sum, v) => sum + v, 0) * factor);
  const floors = values.map((v) => Math.floor(v * factor + 1e-9));
  let remainder = total - floors.reduce((sum, v) => sum + v, 0);
  const order = values
    .map((v, index) => ({
      index,
      frac: v * factor - Math.floor(v * factor + 1e-9),
    }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--)
    out[order[k]!.index]! += 1;
  return out.map((v) => v / factor);
}

/**
 * Share out what a blend cost across its components by label mass. A blend is bought as one vial
 * at one price, so this creates no spend: the parts always add back to the amount given. Empty
 * for a non-blend or when no cost is known.
 */
export function splitCostByComponent(
  cost: string | number | null | undefined,
  components: readonly BlendComponentRatio[]
): ComponentCost[] {
  if (cost === null || cost === undefined || cost === '') return [];
  let total: Decimal;
  try {
    total = new D(cost);
  } catch {
    return [];
  }
  if (!total.isFinite()) return [];
  const rows = usable(components);
  const mass = rows.reduce((sum, { mass: m }) => sum.plus(m), new D(0));
  if (mass.lte(0)) return [];
  return rows.map(({ component, mass: m }) => {
    const fraction = m.div(mass);
    return {
      component_medication_id: component.component_medication_id,
      name: component.name,
      cost: total.mul(fraction).toString(),
      fraction: fraction.toString(),
      source: component.source,
    };
  });
}
