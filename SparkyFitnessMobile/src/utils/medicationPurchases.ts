import {
  medicationPurchaseInputSchema,
  allocateMedicationPurchase,
  type MedicationPurchaseInput,
  type MedicationPurchaseView,
  type PurchaseConsumableCategory,
} from '@workspace/shared';
import { getTodayDate } from './dateUtils';
import { newUuid } from './ids';
export interface PurchaseLineDraft {
  key: string;
  id?: string;
  kind: 'medication' | 'consumable';
  medication_id: string | null;
  category: PurchaseConsumableCategory;
  description: string;
  quantity: string;
  unit_cost: string;
  units_per_pack: string;
  units_per_dose: string;
  vial_ids: string[];
}
export interface PurchaseDraft {
  vendor: string;
  reference: string;
  ordered_date: string;
  received_date: string;
  currency: string;
  shipping_cost: string;
  tax_cost: string;
  other_fees: string;
  discount: string;
  allocation_method: 'value' | 'quantity' | 'none';
  notes: string;
  items: PurchaseLineDraft[];
}
export const blankPurchaseLine = (
  kind: PurchaseLineDraft['kind'],
  medicationId?: string
): PurchaseLineDraft => ({
  key: newUuid(),
  kind,
  medication_id: kind === 'medication' ? (medicationId ?? null) : null,
  category: 'needle',
  description: '',
  quantity: '1',
  unit_cost: '',
  units_per_pack: '',
  units_per_dose: '',
  vial_ids: [],
});
export function purchaseDraft(
  initial?: MedicationPurchaseView,
  firstMedicationId?: string
): PurchaseDraft {
  return {
    vendor: initial?.vendor ?? '',
    reference: initial?.reference ?? '',
    ordered_date: initial?.ordered_date ?? getTodayDate(),
    received_date: initial?.received_date ?? '',
    currency: initial?.currency ?? 'AUD',
    shipping_cost: initial?.shipping_cost ?? '',
    tax_cost: initial?.tax_cost ?? '',
    other_fees: initial?.other_fees ?? '',
    discount: initial?.discount ?? '',
    allocation_method: initial?.allocation_method ?? 'value',
    notes: initial?.notes ?? '',
    items: initial
      ? initial.items.map((line) => ({
          ...line,
          key: newUuid(),
          category: line.category ?? 'other',
          description: line.description ?? '',
          quantity: String(line.quantity),
          units_per_pack:
            line.units_per_pack == null ? '' : String(line.units_per_pack),
          units_per_dose: line.units_per_dose ?? '',
          medication_id: line.medication_id ?? null,
        }))
      : [blankPurchaseLine('medication', firstMedicationId)],
  };
}
export const purchaseInput = (
  draft: PurchaseDraft
): MedicationPurchaseInput => ({
  ...draft,
  items: draft.items.map(({ key: _key, ...line }) => ({
    ...line,
    units_per_pack: line.units_per_pack || null,
    units_per_dose: line.units_per_dose || null,
  })),
});
export function purchasePreview(draft: PurchaseDraft) {
  const parsed = medicationPurchaseInputSchema.safeParse(purchaseInput(draft));
  if (!parsed.success) return null;
  return allocateMedicationPurchase({
    ...parsed.data,
    lines: parsed.data.items.map((line, index) => ({
      id: draft.items[index]!.key,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
    })),
  });
}
