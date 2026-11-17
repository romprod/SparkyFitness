import { Decimal } from 'decimal.js';
import type {
  MedicationPrescriptionVialCost,
  MedicationPrescriptionVialCosts,
} from '../schemas/api/MedicationPrescriptionCosts.api.zod.ts';
import { medicationCourseDaySchema } from '../schemas/api/MedicationCourses.api.zod.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export interface MedicationCostPrescription {
  id: string;
  medication_id: string;
  cost: string | null;
  currency: string | null;
  date_written: string | null;
  cost_basis: 'per_vial' | null;
}
export interface MedicationVialInvoicePrice {
  purchase_id: string;
  purchase_item_id: string;
  medication_id: string;
  unit_cost: string | null;
  currency: string | null;
}
export interface MedicationPricedVial {
  id: string;
  medication_id: string;
  kind?: string | null;
  purchase_item_id: string | null;
  prescription_id?: string | null;
}
const finite = (value: string | null) => {
  try {
    if (value === null || !value.trim()) return null;
    const d = new D(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};
const currency = (value: string | null) =>
  value !== null && value.trim() !== '' ? value : null;
/** Owner scope is guaranteed by the financial snapshot; explicit stock/medication identity is checked here. */
export function resolveMedicationVialPrice(input: {
  vial: MedicationPricedVial;
  invoice_prices: ReadonlyMap<string, MedicationVialInvoicePrice>;
  prescriptions: ReadonlyMap<string, MedicationCostPrescription>;
}): MedicationPrescriptionVialCost {
  const { vial } = input;
  const empty: MedicationPrescriptionVialCost = {
    pen_id: vial.id,
    is_costed: false,
    cost_source: null,
    unit_cost: null,
    currency: null,
    purchase_id: null,
    purchase_item_id: null,
    prescription_id: null,
    estimate_basis: null,
    prescription_date_written: null,
  };
  const invoice =
    vial.purchase_item_id === null
      ? undefined
      : input.invoice_prices.get(vial.purchase_item_id);
  const landed = invoice ? finite(invoice.unit_cost) : null;
  if (
    invoice &&
    invoice.medication_id === vial.medication_id &&
    landed !== null
  )
    return {
      ...empty,
      is_costed: true,
      cost_source: 'invoice',
      unit_cost: landed.toString(),
      currency: currency(invoice.currency),
      purchase_id: invoice.purchase_id,
      purchase_item_id: invoice.purchase_item_id,
    };
  const rx = vial.prescription_id
    ? input.prescriptions.get(vial.prescription_id)
    : undefined;
  const cost = rx ? finite(rx.cost) : null;
  if (
    vial.kind !== 'vial' ||
    !rx ||
    rx.medication_id !== vial.medication_id ||
    rx.cost_basis !== 'per_vial' ||
    cost === null ||
    cost.lt(0)
  )
    return empty;
  return {
    ...empty,
    is_costed: true,
    cost_source: 'prescription',
    unit_cost: cost.toString(),
    currency: currency(rx.currency),
    prescription_id: rx.id,
    estimate_basis: 'per_vial',
    prescription_date_written:
      rx.date_written !== null &&
      !rx.date_written.startsWith('0000-') &&
      medicationCourseDaySchema.safeParse(rx.date_written).success
        ? rx.date_written
        : null,
  };
}
export function buildMedicationVialCostEstimates(input: {
  vials: MedicationPricedVial[];
  invoice_prices: MedicationVialInvoicePrice[];
  prescriptions: MedicationCostPrescription[];
}): MedicationPrescriptionVialCosts {
  const invoice_prices = new Map(
      input.invoice_prices.map((row) => [row.purchase_item_id, row])
    ),
    prescriptions = new Map(input.prescriptions.map((row) => [row.id, row]));
  return {
    cost_basis: 'with_prescription_estimates',
    vials: input.vials.map((vial) =>
      resolveMedicationVialPrice({ vial, invoice_prices, prescriptions })
    ),
  };
}
