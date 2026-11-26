import { Decimal } from 'decimal.js';
import type {
  MedicationPrescriptionVialCost,
  MedicationPrescriptionVialCosts,
} from '../schemas/api/MedicationPrescriptionCosts.api.zod.ts';
import { medicationCourseDaySchema } from '../schemas/api/MedicationCourses.api.zod.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
/** A share is rounded down, so the shares of one prescription never add up to more than its price. */
const Share = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_DOWN });
export interface MedicationCostPrescription {
  id: string;
  /** Every live medicine the prescription covers. */
  medication_ids: string[];
  cost: string | null;
  currency: string | null;
  date_written: string | null;
  /** per_vial: the price is one vial's. per_prescription: the price is the whole fill, split across its linked vials. */
  cost_basis: 'per_vial' | 'per_prescription' | null;
  /** Vials linked to the prescription (every status). The vials passed alongside may raise it, never lower it. */
  linked_vial_count?: number;
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
    !rx.medication_ids.includes(vial.medication_id) ||
    (rx.cost_basis !== 'per_vial' && rx.cost_basis !== 'per_prescription') ||
    cost === null ||
    cost.lt(0)
  )
    return empty;
  // A whole-fill price is split evenly across every vial linked to it; quantity and refills never divide.
  const linked = rx.linked_vial_count ?? 0;
  const unit =
    rx.cost_basis === 'per_vial'
      ? cost
      : linked >= 1
        ? new Share(cost.toString()).div(linked)
        : null;
  if (unit === null) return empty;
  return {
    ...empty,
    is_costed: true,
    cost_source: 'prescription',
    unit_cost: unit.toString(),
    currency: currency(rx.currency),
    prescription_id: rx.id,
    estimate_basis: rx.cost_basis,
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
  );
  const linkedVials = new Map<string, number>();
  for (const vial of input.vials)
    if (vial.prescription_id && vial.kind === 'vial')
      linkedVials.set(
        vial.prescription_id,
        (linkedVials.get(vial.prescription_id) ?? 0) + 1
      );
  const prescriptions = new Map(
    input.prescriptions.map((row) => [
      row.id,
      {
        ...row,
        linked_vial_count: Math.max(
          row.linked_vial_count ?? 0,
          linkedVials.get(row.id) ?? 0
        ),
      },
    ])
  );
  return {
    cost_basis: 'with_prescription_estimates',
    vials: input.vials.map((vial) =>
      resolveMedicationVialPrice({ vial, invoice_prices, prescriptions })
    ),
  };
}
