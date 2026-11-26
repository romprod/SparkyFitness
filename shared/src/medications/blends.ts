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

/** Tolerance for comparing two masses in mg: well under any printable label. */
const MASS_TOLERANCE_MG = new D('1e-9');

/** A stock vial, as far as the label check reads it. */
export interface BlendVialLabel {
  /** Printed mass in mg, as text; unknown when null or absent. */
  label_mass_mg?: string | null;
  status: string;
  /** What the stock list calls the vial, if anything. */
  label?: string | null;
  expiry_date?: string | null;
}

export type BlendMassCheck =
  | { ok: true; sum_mg: string; expected_mg: string | null }
  | { ok: false; sum_mg: string; expected_mg: string };

/**
 * Advisory check of the components' total against a labelled mass in mg, as Pitstop's
 * `blendMassCheck` does. It never blocks a save: a disagreement only means every derived figure
 * scales off the component total rather than the label.
 */
export function blendMassCheck(
  components: readonly BlendComponentRatio[],
  expectedMg: string | number | null | undefined
): BlendMassCheck {
  const sum = new D(blendTotalMg(components));
  const expected = positive(expectedMg);
  if (!expected) return { ok: true, sum_mg: sum.toString(), expected_mg: null };
  return sum.minus(expected).abs().lt(MASS_TOLERANCE_MG)
    ? { ok: true, sum_mg: sum.toString(), expected_mg: expected.toString() }
    : { ok: false, sum_mg: sum.toString(), expected_mg: expected.toString() };
}

export interface BlendVialMismatch {
  sum_mg: string;
  /** A labelled mass that differs from the components' total. */
  expected_mg: string;
  /** How the stock list names the vials with this label: their name, else their expiry date. */
  vials: string[];
}

/**
 * The labelled masses of the blend's live stock vials (not finished or discarded) that disagree
 * with the components' total. One entry per distinct label, in first-seen order. Empty when there
 * are no components or every labelled vial agrees.
 */
export function blendVialMismatches(
  components: readonly BlendComponentRatio[],
  vials: readonly BlendVialLabel[]
): BlendVialMismatch[] {
  if (new D(blendTotalMg(components)).lte(0)) return [];
  const found = new Map<string, BlendVialMismatch>();
  for (const vial of vials) {
    if (vial.status === 'finished' || vial.status === 'discarded') continue;
    const check = blendMassCheck(components, vial.label_mass_mg);
    if (check.ok) continue;
    const entry = found.get(check.expected_mg) ?? {
      sum_mg: check.sum_mg,
      expected_mg: check.expected_mg,
      vials: [],
    };
    const name = vial.label?.trim()
      ? vial.label.trim()
      : vial.expiry_date
        ? `exp ${vial.expiry_date}`
        : null;
    if (name && !entry.vials.includes(name)) entry.vials.push(name);
    found.set(check.expected_mg, entry);
  }
  return [...found.values()];
}

/** One phase of a ramp, already per administration. */
export interface BlendStepInput {
  /** Per-administration amount, as text. */
  dose: string;
  unit: string;
  /** null on the open-ended (maintenance) phase. */
  duration_days: number | null;
}

export interface BlendStepRow {
  /** 1-based phase number. */
  number: number;
  /** The blend dose as the plan states it, e.g. "300 mcg". */
  dose_label: string;
  duration_days: number | null;
  /** Derived mcg per component, in `component_names` order; null when it cannot be split. */
  component_mcg: (number | null)[];
}

export interface BlendStepBreakdown {
  component_names: string[];
  /** The weakest ratio source among the components. */
  source: BlendSource;
  rows: BlendStepRow[];
}

const round1 = (value: string): string => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : value;
};

/**
 * How each blend component's per-administration mass moves across the phases of a plan, as
 * Pitstop's `buildBlendStepBreakdown` has it. Unit honesty: mcg and mg are split directly, mL
 * only with the concentration (mg/mL) of the vial in use, and "units", an unknown unit or a
 * missing concentration leave every cell null rather than a guess. Each row is rounded with
 * `roundSplitForDisplay` so the cells add up to the rounded whole. Null when there are no
 * phases or no usable components.
 */
export function buildBlendStepBreakdown(args: {
  steps: readonly BlendStepInput[];
  components: readonly BlendComponentRatio[];
  concentrationMgPerMl?: string | number | null;
}): BlendStepBreakdown | null {
  const { steps, components, concentrationMgPerMl } = args;
  const sorted = [...components].sort(bySortIndex);
  if (steps.length === 0 || usable(sorted).length === 0) return null;
  const concentration = positive(concentrationMgPerMl);
  const rows = steps.map((step, index): BlendStepRow => {
    const unit = step.unit.trim().toLowerCase();
    const dose = positive(step.dose);
    let doseMg: Decimal | null = null;
    if (dose) {
      if (unit === 'mcg') doseMg = dose.div(1000);
      else if (unit === 'mg') doseMg = dose;
      else if (unit === 'ml' && concentration) doseMg = dose.mul(concentration);
    }
    const split = doseMg ? expandBlendDose(doseMg.toString(), sorted) : [];
    const mcgById = new Map(
      split.map((part) => [
        part.component_medication_id,
        new D(part.dose_mg).mul(1000).toNumber(),
      ])
    );
    const known = sorted.filter((c) => mcgById.has(c.component_medication_id));
    const rounded = roundSplitForDisplay(
      known.map((c) => mcgById.get(c.component_medication_id)!)
    );
    const roundedById = new Map(
      known.map((c, i) => [c.component_medication_id, rounded[i]!])
    );
    return {
      number: index + 1,
      dose_label: `${round1(step.dose.trim())} ${step.unit.trim()}`,
      duration_days: step.duration_days,
      component_mcg: sorted.map(
        (c) => roundedById.get(c.component_medication_id) ?? null
      ),
    };
  });
  return {
    component_names: sorted.map((c) => c.name),
    source: weakestBlendSource(sorted),
    rows,
  };
}
