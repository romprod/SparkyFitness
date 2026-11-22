import { Decimal } from 'decimal.js';
import { waterCostPerMl } from './waterCost.ts';
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
export interface MedicationCourseCostInput {
  as_of: string;
  courses: MedicationCourseCostCourse[];
  invoices: MedicationCostInvoice[];
  vials: MedicationCostVial[];
  doses: MedicationCostDose[];
  /** When given, prescription-estimated vial costs are used exactly as the cost report does. */
  prescriptions?: MedicationCostPrescription[];
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
/**
 * Course spend: actual consumed cost per course from logged doses, using the
 * same per-dose costing as the cost report. Doses not logged under a course are
 * reported separately so the totals reconcile. No projection is made.
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
    context,
    waterCostPerMl(input.invoices)
  );
  const known = new Set(input.courses.map((course) => course.course_id));
  const byCourse = new Map<string, Tally>();
  const unattributed = tally();
  for (const dose of input.doses) {
    const course =
      dose.course_id && known.has(dose.course_id) ? dose.course_id : null;
    const target = course
      ? (byCourse.get(course) ?? byCourse.set(course, tally()).get(course)!)
      : unattributed;
    const costed = costDose(dose, rates, context);
    if (!costed) {
      target.uncosted++;
      continue;
    }
    target.cost = target.cost.plus(costed.cost);
    target.mcg = target.mcg.plus(costed.mcg);
    target.costed++;
    target.currencies.add(costed.currency);
  }
  const rows: MedicationCourseCostRow[] = input.courses.map((course) => ({
    course_id: course.course_id,
    medication_id: course.medication_id,
    medication_name: course.medication_name,
    name: course.name,
    status: course.status,
    start_date: course.start_date,
    end_date: course.end_date,
    actual: actual(byCourse.get(course.course_id) ?? tally()),
  }));
  rows.sort(
    (a, b) =>
      (b.start_date ?? '').localeCompare(a.start_date ?? '') ||
      a.name.localeCompare(b.name) ||
      a.course_id.localeCompare(b.course_id)
  );
  return { as_of: input.as_of, rows, unattributed: actual(unattributed) };
}
