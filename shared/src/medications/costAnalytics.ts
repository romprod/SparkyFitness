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
    category?: string | null;
    units_per_pack?: number | null;
    units_per_dose?: string | null;
  })[];
}
export interface MedicationCostVial {
  id: string;
  medication_id: string;
  label_mass_mg: string | null;
  purchase_item_id: string | null;
  status?: string | null;
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
  return { window, rows, ...buildCostBreakdown(input, window, prices) };
}

function buildCostBreakdown(
  input: Parameters<typeof buildMedicationCostAnalytics>[0],
  window: MedicationCostAnalytics['window'],
  prices: Map<
    string,
    { value: Decimal; currency: string; medication_id: string }
  >
): Pick<MedicationCostAnalytics, 'consumables' | 'waste' | 'monthly_spend'> {
  const within = (day: string) =>
    day >= window.from_date && day <= window.to_date;
  const money = (value: Decimal) => value.toFixed(2, D.ROUND_HALF_UP);
  const currency = (values: Set<string>) =>
    values.size === 1 ? [...values][0]! : null;
  const groups = new Map<
    string,
    { spend: Decimal; pieces: Decimal; currencies: Set<string> }
  >();
  const months = new Map<
    string,
    {
      medication: Decimal;
      consumable: Decimal;
      medicationRaw: Decimal;
      consumableRaw: Decimal;
      medicationPresent: boolean;
      consumablePresent: boolean;
      overhead: Decimal;
      total: Decimal;
      currencies: Set<string>;
    }
  >();
  let spend = new D(0),
    modelled = new D(0),
    modelledLines = 0,
    unmodelledLines = 0;
  const spendCurrencies = new Set<string>(),
    modelledCurrencies = new Set<string>();
  const doseCount = input.doses.filter((dose) =>
    within(dose.entry_date)
  ).length;
  for (const invoice of input.invoices) {
    if (!within(invoice.ordered_date)) continue;
    const allocation = allocateMedicationPurchase(invoice);
    const allocated = new Map(allocation.lines.map((line) => [line.id, line]));
    const key = invoice.ordered_date.slice(0, 7);
    const month = months.get(key) ?? {
      medication: new D(0),
      consumable: new D(0),
      medicationRaw: new D(0),
      consumableRaw: new D(0),
      medicationPresent: false,
      consumablePresent: false,
      overhead: new D(0),
      total: new D(0),
      currencies: new Set<string>(),
    };
    month.total = month.total.plus(allocation.total);
    month.overhead = month.overhead.plus(allocation.overhead);
    month.currencies.add(invoice.currency);
    for (const line of invoice.lines) {
      const values = allocated.get(line.id);
      if (!values) continue;
      const raw = (finite(line.unit_cost) ?? new D(0)).times(line.quantity);
      if (line.kind === 'medication') {
        month.medication = month.medication.plus(values.subtotal);
        month.medicationRaw = month.medicationRaw.plus(raw);
        month.medicationPresent = true;
        continue;
      }
      month.consumable = month.consumable.plus(values.subtotal);
      month.consumableRaw = month.consumableRaw.plus(raw);
      month.consumablePresent = true;
      const landed = new D(values.landed);
      const category = line.category ?? 'other';
      const group = groups.get(category) ?? {
        spend: new D(0),
        pieces: new D(0),
        currencies: new Set<string>(),
      };
      // Source missing pack size means one piece per pack. Explicit invalid
      // denominators cannot produce a modelled rate.
      const perPack = new D(line.units_per_pack ?? 1);
      const pieces = perPack.times(line.quantity);
      group.spend = group.spend.plus(landed);
      group.pieces = group.pieces.plus(pieces);
      group.currencies.add(invoice.currency);
      groups.set(category, group);
      spend = spend.plus(landed);
      spendCurrencies.add(invoice.currency);
      const units = finite(line.units_per_dose ?? null);
      if (units !== null && units.gt(0) && pieces.gt(0)) {
        modelled = modelled.plus(landed.div(pieces).times(units));
        modelledLines++;
        modelledCurrencies.add(invoice.currency);
      } else unmodelledLines++;
    }
    months.set(key, month);
  }
  const spendCurrency = currency(spendCurrencies);
  const doseCurrencies =
    modelledLines > 0 ? modelledCurrencies : spendCurrencies;
  const doseCurrency = currency(doseCurrencies);
  const doseBasis =
    modelledLines > 0
      ? 'modelled'
      : doseCount > 0 && groups.size > 0
        ? 'amortised'
        : 'unavailable';
  const consumables: MedicationCostAnalytics['consumables'] = {
    rows: [...groups]
      .sort(
        ([a, left], [b, right]) =>
          (spendCurrencies.size <= 1
            ? right.spend.comparedTo(left.spend)
            : 0) || a.localeCompare(b)
      )
      .map(([category, group]) => ({
        category,
        spend: currency(group.currencies) ? money(group.spend) : null,
        spend_currency: currency(group.currencies),
        spend_mixed_currency: group.currencies.size > 1,
        pieces: group.pieces.toString(),
        cost_per_piece:
          currency(group.currencies) && group.pieces.gt(0)
            ? group.spend.div(group.pieces).toString()
            : null,
      })),
    spend: spendCurrency ? money(spend) : null,
    spend_currency: spendCurrency,
    spend_mixed_currency: spendCurrencies.size > 1,
    cost_per_dose:
      doseCurrency && doseBasis !== 'unavailable'
        ? (modelledLines > 0 ? modelled : spend.div(doseCount)).toString()
        : null,
    cost_per_dose_basis: doseBasis,
    cost_per_dose_currency: doseCurrency,
    cost_per_dose_mixed_currency: doseCurrencies.size > 1,
    modelled_lines: modelledLines,
    unmodelled_lines: unmodelledLines,
    dose_count: doseCount,
  };
  const lifetime = new Map<string, { mass: Decimal; unknown: boolean }>();
  for (const dose of input.doses) {
    if (!dose.pen_id) continue;
    const delivered = lifetime.get(dose.pen_id) ?? {
      mass: new D(0),
      unknown: false,
    };
    const mass = finite(dose.dose_mg),
      volume = finite(dose.volume_ml);
    if (
      mass === null ||
      mass.lt(0) ||
      (mass.isZero() &&
        (volume === null || volume.lt(0) || dose.dose_input_unit === null))
    )
      delivered.unknown = true;
    else delivered.mass = delivered.mass.plus(mass);
    lifetime.set(dose.pen_id, delivered);
  }
  const wasteRows: MedicationCostAnalytics['waste']['rows'] = [];
  const wasteCurrencies = new Set<string>();
  let wasteValue = new D(0),
    unavailable = 0;
  const names = new Map(input.medications.map((med) => [med.id, med.name]));
  for (const vial of input.vials) {
    if (vial.status !== 'finished' && vial.status !== 'discarded') continue;
    const price = vial.purchase_item_id
      ? prices.get(vial.purchase_item_id)
      : undefined;
    const label = finite(vial.label_mass_mg),
      history = lifetime.get(vial.id);
    const delivered = history?.unknown ? null : (history?.mass ?? new D(0));
    const utilisation =
      label?.gt(0) && delivered !== null
        ? delivered.div(label).times(100)
        : null;
    if (utilisation !== null && utilisation.gt(70)) continue;
    const unused =
      label !== null && label.gte(0) && delivered !== null
        ? D.max(0, label.minus(delivered))
        : null;
    const value =
      price &&
      price.medication_id === vial.medication_id &&
      label?.gt(0) &&
      unused !== null
        ? price.value.times(unused).div(label)
        : null;
    if (value === null) unavailable++;
    else {
      wasteValue = wasteValue.plus(value);
      wasteCurrencies.add(price!.currency);
    }
    wasteRows.push({
      vial_id: vial.id,
      medication_id: vial.medication_id,
      medication_name: names.get(vial.medication_id) ?? '',
      status: vial.status,
      label_mass_mg: label?.toString() ?? null,
      delivered_mass_mg: delivered?.toString() ?? null,
      estimated_unused_mg: unused?.toString() ?? null,
      utilisation_percent: utilisation?.toString() ?? null,
      estimated_unused_value: value === null ? null : money(value),
      currency: value === null ? null : price!.currency,
      value_unavailable: value === null,
    });
  }
  wasteRows.sort(
    (a, b) =>
      (a.value_unavailable !== b.value_unavailable
        ? a.value_unavailable
          ? 1
          : -1
        : 0) ||
      (wasteCurrencies.size <= 1 &&
      a.estimated_unused_value !== null &&
      b.estimated_unused_value !== null
        ? new D(b.estimated_unused_value).comparedTo(a.estimated_unused_value)
        : 0) ||
      a.medication_name.localeCompare(b.medication_name) ||
      a.vial_id.localeCompare(b.vial_id)
  );
  return {
    consumables,
    waste: {
      basis: 'current_closed_stock_lifetime_delivered',
      rows: wasteRows,
      estimated_unused_value: currency(wasteCurrencies)
        ? money(wasteValue)
        : null,
      currency: currency(wasteCurrencies),
      mixed_currency: wasteCurrencies.size > 1,
      unavailable_vials: unavailable,
    },
    monthly_spend: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => {
        const comparable = currency(values.currencies);
        let medication = new D(money(values.medication)),
          consumable = new D(money(values.consumable));
        const residual = values.total
          .minus(values.overhead)
          .minus(medication)
          .minus(consumable);
        // Category totals include rounding adjustments. Keep real net fees intact;
        // reconcile invoice payment rounding in the largest raw category, with
        // medication first on ties. After cancellation prefer an existing nonzero
        // rounded category over inventing a value in an empty category.
        if (!residual.isZero()) {
          const medicationNonzero = !medication.isZero(),
            consumableNonzero = !consumable.isZero();
          const medicationFirst =
            medicationNonzero !== consumableNonzero
              ? medicationNonzero
              : values.medicationPresent !== values.consumablePresent
                ? values.medicationPresent
                : !values.medicationRaw.abs().eq(values.consumableRaw.abs())
                  ? values.medicationRaw.abs().gt(values.consumableRaw.abs())
                  : !values.medicationRaw.isZero() ||
                    medication.abs().gte(consumable.abs());
          if (medicationFirst) medication = medication.plus(residual);
          else consumable = consumable.plus(residual);
        }
        return {
          month,
          medication_subtotal: comparable ? money(medication) : null,
          consumable_subtotal: comparable ? money(consumable) : null,
          overhead: comparable ? money(values.overhead) : null,
          total: comparable ? money(values.total) : null,
          currency: comparable,
          mixed_currency: values.currencies.size > 1,
        };
      }),
  };
}
