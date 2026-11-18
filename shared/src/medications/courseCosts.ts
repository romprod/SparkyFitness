import { Decimal } from 'decimal.js';
import {
  costDose,
  invoiceLinePrices,
  resolveVialCostContext,
  vialCostRates,
  type MedicationCostDose,
  type MedicationCostInvoice,
  type MedicationCostVial,
} from './costAnalytics.ts';
import type { MedicationCostPrescription } from './vialCostResolution.ts';
import type {
  MedicationCourseCosts,
  MedicationCourseCostRow,
} from '../schemas/api/MedicationCourseCosts.api.zod.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface MedicationCourseCostCourse {
  course_id: string;
  medication_id: string | null;
  medication_name: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}
/** Planned demand for one course, taken unchanged from the planned-cycle forecast. */
export interface MedicationCoursePlannedDemand {
  course_id: string;
  slots: { value: string | null; unit: string | null }[];
  basis: 'course_end' | 'horizon' | 'slot_cap';
  coverage_end: string | null;
}
export interface MedicationCourseCostInput {
  as_of: string;
  courses: MedicationCourseCostCourse[];
  invoices: MedicationCostInvoice[];
  vials: MedicationCostVial[];
  doses: MedicationCostDose[];
  /** When given, prescription-estimated vial costs are used exactly as the cost report does. */
  prescriptions?: MedicationCostPrescription[];
  planned: MedicationCoursePlannedDemand[];
}
interface Tally {
  cost: Decimal;
  mcg: Decimal;
  costed: number;
  uncosted: number;
  currencies: Set<string>;
}
const tally = (): Tally => ({
  cost: new D(0),
  mcg: new D(0),
  costed: 0,
  uncosted: 0,
  currencies: new Set(),
});
const money = (value: Decimal) => value.toFixed(2, D.ROUND_HALF_UP);
function actual(t: Tally): MedicationCourseCostRow['actual'] {
  const currency = t.currencies.size === 1 ? [...t.currencies][0]! : null;
  const priced = currency !== null && t.costed > 0;
  return {
    cost: priced ? money(t.cost) : null,
    currency,
    mixed_currency: t.currencies.size > 1,
    delivered_mg: t.mcg.div(1000).toString(),
    costed_doses: t.costed,
    uncosted_doses: t.uncosted,
    cost_per_dose: priced ? t.cost.div(t.costed).toString() : null,
    cost_per_mg:
      priced && t.mcg.gt(0) ? t.cost.div(t.mcg.div(1000)).toString() : null,
  };
}
function slotMg(value: string | null, unit: string | null): Decimal | null {
  if (value === null || unit === null) return null;
  let amount: Decimal;
  try {
    amount = new D(value);
  } catch {
    return null;
  }
  if (!amount.isFinite() || !amount.gt(0)) return null;
  switch (unit.trim().toLowerCase()) {
    case 'mg':
      return amount;
    case 'mcg':
    case 'ug':
    case 'µg':
    case 'μg':
      return amount.div(1000);
    case 'g':
      return amount.times(1000);
    default:
      return null;
  }
}
/**
 * Course spend: actual consumed cost per course from logged doses (the same
 * per-dose costing as the cost report), plus an estimate for the planned doses
 * still to come. The estimate never invents a price: it needs a costed rate
 * from this course, else from the same medication, and mass-based planned doses.
 */
export function buildMedicationCourseCosts(
  input: MedicationCourseCostInput
): MedicationCourseCosts {
  const context = input.prescriptions
    ? resolveVialCostContext({ ...input, prescriptions: input.prescriptions })
    : undefined;
  const rates = vialCostRates(
    input.vials,
    invoiceLinePrices(input.invoices),
    context
  );
  const known = new Set(input.courses.map((course) => course.course_id));
  const byCourse = new Map<string, Tally>();
  const byMedication = new Map<string, Tally>();
  const unattributed = tally();
  for (const dose of input.doses) {
    const course =
      dose.course_id && known.has(dose.course_id) ? dose.course_id : null;
    const targets = [
      course
        ? (byCourse.get(course) ?? byCourse.set(course, tally()).get(course)!)
        : unattributed,
      dose.medication_id
        ? (byMedication.get(dose.medication_id) ??
          byMedication
            .set(dose.medication_id, tally())
            .get(dose.medication_id)!)
        : null,
    ];
    const costed = costDose(dose, rates, context);
    for (const target of targets) {
      if (!target) continue;
      if (!costed) {
        target.uncosted++;
        continue;
      }
      target.cost = target.cost.plus(costed.cost);
      target.mcg = target.mcg.plus(costed.mcg);
      target.costed++;
      target.currencies.add(costed.currency);
    }
  }
  const plans = new Map(input.planned.map((plan) => [plan.course_id, plan]));
  const rows: MedicationCourseCostRow[] = input.courses.map((course) => {
    const t = byCourse.get(course.course_id) ?? tally();
    const a = actual(t);
    const plan = plans.get(course.course_id);
    const remaining: MedicationCourseCostRow['remaining'] = {
      planned_mg: null,
      planned_doses: plan?.slots.length ?? 0,
      basis: 'unavailable',
      through: null,
      rate_per_mg: null,
      rate_source: null,
      currency: null,
      estimate: null,
      unavailable_reason: null,
    };
    if (!plan || plan.slots.length === 0) {
      remaining.unavailable_reason = 'no_plan';
    } else {
      remaining.basis = plan.basis;
      remaining.through = plan.coverage_end;
      const masses = plan.slots.map((slot) => slotMg(slot.value, slot.unit));
      const mass = masses.filter((m): m is Decimal => m !== null);
      if (mass.length !== masses.length) {
        remaining.unavailable_reason = 'non_mass_dose';
      } else {
        const plannedMg = mass.reduce((sum, m) => sum.plus(m), new D(0));
        remaining.planned_mg = plannedMg.toString();
        const own = actual(t);
        const med = course.medication_id
          ? byMedication.get(course.medication_id)
          : undefined;
        const fallback = med ? actual(med) : null;
        const pick =
          own.cost_per_mg !== null
            ? ([own, 'course_actual'] as const)
            : fallback?.cost_per_mg
              ? ([fallback, 'medication_actual'] as const)
              : null;
        if (!pick) {
          const mixed = own.mixed_currency || fallback?.mixed_currency === true;
          remaining.unavailable_reason = mixed ? 'mixed_currency' : 'no_rate';
        } else {
          const [source, label] = pick;
          remaining.rate_per_mg = source.cost_per_mg;
          remaining.rate_source = label;
          remaining.currency = source.currency;
          remaining.estimate = money(plannedMg.times(source.cost_per_mg!));
        }
      }
    }
    let projected_total: string | null = null;
    let projected_currency: string | null = null;
    if (remaining.estimate !== null) {
      if (a.cost !== null && a.currency === remaining.currency) {
        projected_total = money(new D(a.cost).plus(remaining.estimate));
        projected_currency = remaining.currency;
      } else if (t.costed === 0 && t.uncosted === 0) {
        projected_total = remaining.estimate;
        projected_currency = remaining.currency;
      }
    }
    return {
      course_id: course.course_id,
      medication_id: course.medication_id,
      medication_name: course.medication_name,
      name: course.name,
      status: course.status,
      start_date: course.start_date,
      end_date: course.end_date,
      actual: a,
      remaining,
      projected_total,
      projected_currency,
    };
  });
  rows.sort(
    (a, b) =>
      (b.start_date ?? '').localeCompare(a.start_date ?? '') ||
      a.name.localeCompare(b.name) ||
      a.course_id.localeCompare(b.course_id)
  );
  return { as_of: input.as_of, rows, unattributed: actual(unattributed) };
}
