import { Decimal } from 'decimal.js';
import {
  allocateMedicationPurchase,
  type PurchaseAllocationInput,
} from './purchaseCosts.ts';
import type {
  MedicationCostWindow,
  MedicationCostAnalytics,
  MedicationCostAnalyticsRow,
} from '../schemas/api/MedicationCostAnalytics.api.zod.ts';
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export interface MedicationCostInvoice extends Omit<
  PurchaseAllocationInput,
  'lines'
> {
  id: string;
  ordered_date: string;
  currency: string;
  lines: (PurchaseAllocationInput['lines'][number] & {
    kind: 'medication' | 'consumable';
    medication_id: string | null;
  })[];
}
export interface MedicationCostVial {
  id: string;
  medication_id: string;
  label_mass_mg: string | null;
  purchase_item_id: string | null;
}
export interface MedicationCostDose {
  medication_id: string | null;
  pen_id: string | null;
  entry_date: string;
  dose_mg: string | null;
  volume_ml: string | null;
  dose_input_unit: string | null;
}
function finite(value: string | null): Decimal | null {
  if (value === null || !value.trim()) return null;
  try {
    const number = new D(value);
    return number.isFinite() ? number : null;
  } catch {
    return null;
  }
}
/** Calendar month rollover matches Date.setMonth, independent of the server zone. */
export function medicationCostRange(
  today: string,
  key: MedicationCostWindow = '12'
): MedicationCostAnalytics['window'] {
  if (key === 'all') return { key, from_date: '1970-01-01', to_date: today };
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - Number(key));
  const year = String(date.getUTCFullYear()).padStart(4, '0'),
    month = String(date.getUTCMonth() + 1).padStart(2, '0'),
    day = String(date.getUTCDate()).padStart(2, '0');
  return { key, from_date: `${year}-${month}-${day}`, to_date: today };
}
interface Accumulator {
  spend: Decimal;
  spendCurrencies: Set<string>;
  cost: Decimal;
  usageCurrencies: Set<string>;
  mass: Decimal;
  costed: number;
  uncosted: number;
}
/** Derived current purchase/label estimates only; no requested-dose or preparation-mass inference. */
export function buildMedicationCostAnalytics(input: {
  today: string;
  window?: MedicationCostWindow;
  medications: { id: string; name: string }[];
  invoices: MedicationCostInvoice[];
  vials: MedicationCostVial[];
  doses: MedicationCostDose[];
}): MedicationCostAnalytics {
  const window = medicationCostRange(input.today, input.window ?? '12');
  const names = new Map(input.medications.map((med) => [med.id, med.name]));
  const acc = new Map<string, Accumulator>();
  const touch = (id: string) => {
    if (!names.has(id)) return null;
    let row = acc.get(id);
    if (!row) {
      row = {
        spend: new D(0),
        spendCurrencies: new Set(),
        cost: new D(0),
        usageCurrencies: new Set(),
        mass: new D(0),
        costed: 0,
        uncosted: 0,
      };
      acc.set(id, row);
    }
    return row;
  };
  const prices = new Map<
    string,
    { value: Decimal; currency: string; medication_id: string }
  >();
  for (const invoice of input.invoices) {
    const allocation = allocateMedicationPurchase(invoice);
    const byLine = new Map(allocation.lines.map((line) => [line.id, line]));
    for (const line of invoice.lines) {
      if (line.kind !== 'medication' || !line.medication_id) continue;
      const allocated = byLine.get(line.id);
      if (!allocated) continue;
      const unit = finite(allocated.landed_unit);
      if (unit !== null)
        prices.set(line.id, {
          value: unit,
          currency: invoice.currency,
          medication_id: line.medication_id,
        });
      if (
        invoice.ordered_date < window.from_date ||
        invoice.ordered_date > window.to_date
      )
        continue;
      const row = touch(line.medication_id);
      if (!row) continue;
      row.spend = row.spend.plus(allocated.landed);
      row.spendCurrencies.add(invoice.currency);
    }
  }
  const rates = new Map<
    string,
    { rate: Decimal; currency: string; medication_id: string }
  >();
  for (const vial of input.vials) {
    const price = vial.purchase_item_id
      ? prices.get(vial.purchase_item_id)
      : undefined;
    const mass = finite(vial.label_mass_mg);
    if (
      !price ||
      mass === null ||
      !mass.gt(0) ||
      price.medication_id !== vial.medication_id
    )
      continue;
    rates.set(vial.id, {
      rate: price.value.div(mass.times(1000)),
      currency: price.currency,
      medication_id: vial.medication_id,
    });
  }
  for (const dose of input.doses) {
    if (
      !dose.medication_id ||
      dose.entry_date < window.from_date ||
      dose.entry_date > window.to_date
    )
      continue;
    const row = touch(dose.medication_id);
    if (!row) continue;
    const rate = dose.pen_id ? rates.get(dose.pen_id) : undefined;
    const mass = finite(dose.dose_mg);
    const recordedVolume = finite(dose.volume_ml);
    const known =
      mass !== null &&
      mass.gte(0) &&
      !(
        mass.isZero() &&
        (recordedVolume === null ||
          recordedVolume.lt(0) ||
          dose.dose_input_unit === null)
      );
    if (
      !rate ||
      rate.medication_id !== dose.medication_id ||
      !known ||
      mass === null
    ) {
      row.uncosted++;
      continue;
    }
    const deliveredMcg = mass.times(1000);
    row.cost = row.cost.plus(rate.rate.times(deliveredMcg));
    row.mass = row.mass.plus(deliveredMcg);
    row.costed++;
    row.usageCurrencies.add(rate.currency);
  }
  const reportSpendCurrencies = new Set(
    [...acc.values()].flatMap((row) => [...row.spendCurrencies])
  );
  const rows: MedicationCostAnalyticsRow[] = [...acc.entries()]
    .map(([id, row]) => {
      const spendCurrency =
        row.spendCurrencies.size === 1 ? [...row.spendCurrencies][0]! : null;
      const usageCurrency =
        row.usageCurrencies.size === 1 ? [...row.usageCurrencies][0]! : null;
      return {
        medication_id: id,
        medication_name: names.get(id)!,
        spend:
          spendCurrency !== null
            ? row.spend.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2)
            : null,
        spend_currency: spendCurrency,
        spend_present: row.spendCurrencies.size > 0,
        spend_mixed_currency: row.spendCurrencies.size > 1,
        cost_per_dose:
          usageCurrency !== null && row.costed > 0
            ? row.cost.div(row.costed).toString()
            : null,
        cost_per_mg:
          usageCurrency !== null && row.mass.gt(0)
            ? row.cost.div(row.mass.div(1000)).toString()
            : null,
        usage_currency: usageCurrency,
        usage_mixed_currency: row.usageCurrencies.size > 1,
        costed_doses: row.costed,
        uncosted_doses: row.uncosted,
      };
    })
    .sort((a, b) => {
      // Source ranks comparable spend, treating absent spend as zero for order
      // only. Incomparable currencies use names rather than a financial rank.
      const spendOrder =
        reportSpendCurrencies.size <= 1
          ? new D(b.spend ?? '0').comparedTo(a.spend ?? '0')
          : 0;
      return (
        spendOrder ||
        a.medication_name.localeCompare(b.medication_name) ||
        a.medication_id.localeCompare(b.medication_id)
      );
    });
  return { window, rows };
}
