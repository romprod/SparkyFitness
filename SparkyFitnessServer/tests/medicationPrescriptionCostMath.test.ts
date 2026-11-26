import { describe, expect, it } from 'vitest';
import {
  buildMedicationCostAnalytics,
  buildMedicationPrescriptionCostAnalytics,
  buildMedicationVialCostEstimates,
  resolveMedicationVialPrice,
  medicationPrescriptionCostAnalyticsSchema,
  medicationPrescriptionVialCostsSchema,
  medicationPrescriptionVialCostSchema,
  type MedicationCostAnalyticsInput,
  type MedicationCostPrescription,
  type MedicationCostVial,
  type MedicationVialInvoicePrice,
} from '@workspace/shared';
const uid = (n: number) =>
  '70000000-0000-4000-a000-' + String(n).padStart(12, '0');
const med = uid(1),
  other = uid(2),
  today = '2026-11-17';
const vial = (patch: Partial<MedicationCostVial> = {}): MedicationCostVial => ({
  id: uid(10),
  medication_id: med,
  kind: 'vial',
  label_mass_mg: '10',
  purchase_item_id: null,
  prescription_id: uid(20),
  status: 'finished',
  ...patch,
});
const rx = (
  patch: Partial<MedicationCostPrescription> = {}
): MedicationCostPrescription => ({
  id: uid(20),
  medication_ids: [med],
  cost: '30',
  currency: 'GBP',
  date_written: '2026-11-01',
  cost_basis: 'per_vial',
  ...patch,
});
const invoicePrice = (
  patch: Partial<MedicationVialInvoicePrice> = {}
): MedicationVialInvoicePrice => ({
  purchase_id: uid(30),
  purchase_item_id: uid(31),
  medication_id: med,
  unit_cost: '20',
  currency: 'GBP',
  ...patch,
});
function resolve(
  v = vial(),
  r = rx(),
  p: MedicationVialInvoicePrice | null = null
) {
  return resolveMedicationVialPrice({
    vial: v,
    invoice_prices: new Map(p ? [[p.purchase_item_id, p]] : []),
    prescriptions: new Map([[r.id, r]]),
  });
}
function input(): MedicationCostAnalyticsInput & {
  prescriptions: MedicationCostPrescription[];
} {
  return {
    today,
    window: '3',
    medications: [{ id: med, name: 'Synthetic medication' }],
    invoices: [],
    vials: [vial()],
    doses: [
      {
        medication_id: med,
        pen_id: uid(10),
        entry_date: today,
        dose_mg: '1',
        volume_ml: '0.1',
        dose_input_unit: 'mg',
      },
    ],
    prescriptions: [rx()],
  };
}
const result = (i = input()) =>
  medicationPrescriptionCostAnalyticsSchema.parse(
    buildMedicationPrescriptionCostAnalytics(i)
  );
describe('one explicit linked-vial cost resolver', () => {
  it.each(['20', '0', '-5'])(
    'preserves finite invoice %s before any prescription estimate',
    (value) => {
      const p = invoicePrice({ unit_cost: value }),
        selected = resolve(
          vial({ purchase_item_id: p.purchase_item_id }),
          rx(),
          p
        );
      expect(selected).toMatchObject({
        cost_source: 'invoice',
        unit_cost: value,
        prescription_id: null,
        estimate_basis: null,
        is_costed: true,
      });
    }
  );
  it.each([null, '', 'NaN', 'Infinity'])(
    'permits fallback only when invoice unit price %s is unavailable',
    (value) => {
      const p = invoicePrice({ unit_cost: value });
      expect(
        resolve(vial({ purchase_item_id: p.purchase_item_id }), rx(), p)
      ).toMatchObject({
        cost_source: 'prescription',
        unit_cost: '30',
        purchase_id: null,
      });
    }
  );
  it('does not infer a stock prescription from another course, latest record, or different medication', () => {
    expect(resolve(vial({ prescription_id: null })).is_costed).toBe(false);
    expect(resolve(vial(), rx({ medication_ids: [other] })).is_costed).toBe(
      false
    );
    // A prescription that covers several medicines prices the vial of each one it covers, and only those.
    expect(
      resolve(vial(), rx({ medication_ids: [other, med] })).is_costed
    ).toBe(true);
    expect(
      resolve(vial({ medication_id: other }), rx({ medication_ids: [med] }))
        .is_costed
    ).toBe(false);
    expect(resolve(vial(), rx({ medication_ids: [] })).is_costed).toBe(false);
    expect(resolve(vial({ prescription_id: uid(99) })).is_costed).toBe(false);
  });
  it('requires an explicit per-vial basis and vial kind; no cost confirmation is inferred', () => {
    expect(resolve(vial(), rx({ cost_basis: null })).is_costed).toBe(false);
    expect(resolve(vial({ kind: 'pen' })).is_costed).toBe(false);
    expect(resolve(vial({ kind: undefined })).is_costed).toBe(false);
  });
  it.each([null, '', '-1', 'NaN'])(
    'leaves unpriced/invalid prescription %s unknown',
    (cost) => {
      expect(resolve(vial(), rx({ cost })).is_costed).toBe(false);
    }
  );
  it('keeps confirmed prescription zero known and ignores status/expiry as financial eligibility', () => {
    expect(
      resolve(vial({ status: 'discarded' }), rx({ cost: '0' }))
    ).toMatchObject({
      is_costed: true,
      cost_source: 'prescription',
      unit_cost: '0',
    });
    const expired = {
      ...rx(),
      status: 'cancelled',
      expiration: '2020-01-01',
      quantity: 100,
      refills_authorized: 4,
    };
    expect(resolve(vial({ status: 'sealed' }), expired).unit_cost).toBe('30');
  });
  it('keeps a known invoice unit authoritative when its native currency is unknown', () => {
    const p = invoicePrice({ currency: null });
    expect(
      resolve(
        vial({ purchase_item_id: p.purchase_item_id }),
        rx({ currency: 'USD' }),
        p
      )
    ).toMatchObject({
      is_costed: true,
      cost_source: 'invoice',
      unit_cost: '20',
      currency: null,
      prescription_id: null,
    });
  });
  it('does not divide a confirmed unit price by quantity/refills, and counts each explicit vial once', () => {
    const prescription = { ...rx(), quantity: 2, refills_remaining: 10 };
    const out = medicationPrescriptionVialCostsSchema.parse(
      buildMedicationVialCostEstimates({
        vials: [vial(), vial({ id: uid(11) })],
        invoice_prices: [],
        prescriptions: [prescription],
      })
    );
    expect(out.vials.map((v) => v.unit_cost)).toEqual(['30', '30']);
  });
});
describe('separate estimate accounting and common usage/waste rates', () => {
  it('supports no-invoice stock with separate estimated buckets and shared vial/usage/waste provenance', () => {
    const out = result();
    expect(out.rows[0]).toMatchObject({
      spend: null,
      spend_present: false,
      cost_per_dose: '3',
      cost_per_mg: '3',
      usage_sources: { invoice: 0, prescription: 1 },
    });
    expect(out.accounted).toEqual([
      {
        currency: 'GBP',
        invoice_cash: '0.00',
        prescription_estimate: '30.00',
        accounted_total: '30.00',
        estimated_vials: 1,
        undated_vials: 0,
      },
    ]);
    expect(out.waste.rows[0]).toMatchObject({
      estimated_unused_value: '27.00',
      cost_source: 'prescription',
      currency: 'GBP',
    });
    expect(out.monthly_spend).toEqual([]);
  });
  it('includes fallback-only stock as an accounting row even without logged doses', () => {
    const i = input();
    i.doses = [];
    const out = result(i);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.accounted[0]?.estimated_vials).toBe(1);
    expect(out.rows[0]?.usage_sources).toEqual({ invoice: 0, prescription: 0 });
  });
  it('prices current usage from an old authoritative invoice without adding a new Rx estimate', () => {
    const i = input();
    i.invoices = [
      {
        id: uid(30),
        ordered_date: '2020-01-01',
        currency: 'GBP',
        allocation_method: 'none',
        lines: [
          {
            id: uid(31),
            kind: 'medication',
            medication_id: med,
            quantity: 1,
            unit_cost: '20',
          },
        ],
      },
    ];
    i.vials[0]!.purchase_item_id = uid(31);
    const out = result(i);
    expect(out.rows[0]).toMatchObject({
      cost_per_dose: '2',
      usage_sources: { invoice: 1, prescription: 0 },
    });
    expect(out.accounted).toEqual([]);
    expect(out.waste.rows[0]?.cost_source).toBe('invoice');
  });
  it('keeps known invoice zero/credits authoritative in usage, waste and estimate counts', () => {
    for (const unit of ['0', '-5']) {
      const i = input();
      i.invoices = [
        {
          id: uid(30),
          ordered_date: today,
          currency: 'GBP',
          allocation_method: 'none',
          lines: [
            {
              id: uid(31),
              kind: 'medication',
              medication_id: med,
              quantity: 1,
              unit_cost: unit,
            },
          ],
        },
      ];
      i.vials[0]!.purchase_item_id = uid(31);
      const out = result(i);
      expect(out.rows[0]?.cost_per_dose).toBe(unit === '0' ? '0' : '-0.5');
      expect(out.accounted[0]?.estimated_vials).toBe(0);
      expect(out.waste.rows[0]?.cost_source).toBe('invoice');
    }
  });
  it('keeps confirmed Rx zero costed without turning missing mass into a free known rate', () => {
    const i = input();
    i.prescriptions[0]!.cost = '0';
    let out = result(i);
    expect(out.rows[0]).toMatchObject({
      cost_per_dose: '0',
      cost_per_mg: '0',
      costed_doses: 1,
      usage_sources: { invoice: 0, prescription: 1 },
    });
    expect(out.accounted[0]).toMatchObject({
      prescription_estimate: '0.00',
      estimated_vials: 1,
    });
    i.vials[0]!.label_mass_mg = null;
    out = result(i);
    expect(out.rows[0]?.uncosted_doses).toBe(1);
    expect(out.rows[0]?.cost_per_dose).toBeNull();
    expect(out.waste.rows[0]?.value_unavailable).toBe(true);
  });
  it('does not infer label mass from preparation or concentration while retaining known unit-price estimates', () => {
    const i = input();
    const prepared = {
      ...vial({ label_mass_mg: null }),
      prepared_mass_mg: '10',
      concentration_mg_ml: '5',
      volume_ml: '2',
    };
    i.vials = [prepared];
    const out = result(i);
    expect(out.accounted[0]?.prescription_estimate).toBe('30.00');
    expect(out.rows[0]?.uncosted_doses).toBe(1);
    expect(out.waste.rows[0]).toMatchObject({
      cost_source: 'prescription',
      estimated_unused_value: null,
    });
  });
  it('leaves positive volume-only zero-mass sentinels unknown only in the new financial mode', () => {
    const i = input();
    i.doses[0]!.dose_mg = '0';
    i.doses[0]!.volume_ml = '0.125';
    i.doses[0]!.dose_input_unit = 'ml';
    i.invoices = [
      {
        id: uid(30),
        ordered_date: today,
        currency: 'GBP',
        allocation_method: 'none',
        lines: [
          {
            id: uid(31),
            kind: 'medication',
            medication_id: med,
            quantity: 1,
            unit_cost: '20',
          },
        ],
      },
    ];
    i.vials[0]!.purchase_item_id = uid(31);
    expect(buildMedicationCostAnalytics(i).rows[0]?.costed_doses).toBe(1);
    const out = result(i);
    expect(out.rows[0]?.uncosted_doses).toBe(1);
    expect(out.waste.rows[0]?.delivered_mass_mg).toBeNull();
    expect(out.waste.rows[0]?.estimated_unused_value).toBeNull();
  });
  it('preserves true known zero delivery and its zero cost without dividing by zero mass', () => {
    const i = input();
    Object.assign(i.doses[0]!, {
      dose_mg: '0',
      volume_ml: '0',
      dose_input_unit: 'mg',
    });
    const out = result(i);
    expect(out.rows[0]).toMatchObject({
      cost_per_dose: '0',
      cost_per_mg: null,
      costed_doses: 1,
      uncosted_doses: 0,
    });
    expect(out.waste.rows[0]).toMatchObject({
      delivered_mass_mg: '0',
      estimated_unused_value: '30.00',
    });
  });
  it('suppresses affected mixed-currency usage but keeps independent native-currency accounting buckets', () => {
    const i = input();
    i.invoices = [
      {
        id: uid(30),
        ordered_date: today,
        currency: 'USD',
        allocation_method: 'none',
        lines: [
          {
            id: uid(31),
            kind: 'medication',
            medication_id: med,
            quantity: 1,
            unit_cost: '20',
          },
        ],
      },
    ];
    i.vials.push(vial({ id: uid(11), purchase_item_id: uid(31) }));
    i.doses.push({ ...i.doses[0]!, pen_id: uid(11) });
    const out = result(i);
    expect(out.rows[0]).toMatchObject({
      usage_mixed_currency: true,
      usage_currency: null,
      cost_per_dose: null,
      cost_per_mg: null,
      usage_sources: { invoice: 1, prescription: 1 },
    });
    expect(out.accounted.map((b) => [b.currency, b.accounted_total])).toEqual([
      ['GBP', '30.00'],
      ['USD', '20.00'],
    ]);
    expect(out).not.toHaveProperty('accounted_total');
  });
  it('does not manufacture currency-based rates or buckets when a selected Rx currency is missing', () => {
    const i = input();
    i.prescriptions[0]!.currency = null;
    const out = result(i);
    expect(out.rows[0]?.uncosted_doses).toBe(1);
    expect(out.rows[0]?.usage_sources).toEqual({ invoice: 0, prescription: 0 });
    expect(out.accounted).toEqual([]);
    expect(out.waste.rows[0]).toMatchObject({
      cost_source: 'prescription',
      estimated_unused_value: null,
      currency: null,
    });
  });
  it('uses written-date boundaries and includes undated estimates once per vial with explicit counts', () => {
    const i = input();
    i.prescriptions = [
      rx({ date_written: '2026-08-17' }),
      rx({ id: uid(21), date_written: '2026-11-18' }),
      rx({ id: uid(22), date_written: null }),
    ];
    i.vials = [
      vial(),
      vial({ id: uid(11), prescription_id: uid(21) }),
      vial({ id: uid(12), prescription_id: uid(22) }),
    ];
    const out = result(i);
    expect(out.accounted[0]).toMatchObject({
      prescription_estimate: '60.00',
      estimated_vials: 2,
      undated_vials: 1,
    });
    expect(out.rows[0]?.accounted).toEqual(out.accounted);
  });
  it('preserves an old valid written year rather than treating it as undated recent spend', () => {
    const i = input();
    i.prescriptions[0]!.date_written = '0001-01-01';
    expect(resolve(vial(), i.prescriptions[0]!).prescription_date_written).toBe(
      '0001-01-01'
    );
    expect(result(i).accounted).toEqual([]);
    i.prescriptions[0]!.date_written = null;
    expect(result(i).accounted[0]).toMatchObject({
      estimated_vials: 1,
      undated_vials: 1,
      prescription_estimate: '30.00',
    });
  });
  it('reprices usage from an out-of-window Rx without presenting it as in-window estimated spend', () => {
    const i = input();
    i.prescriptions[0]!.date_written = '2020-01-01';
    const out = result(i);
    expect(out.rows[0]?.cost_per_dose).toBe('3');
    expect(out.accounted).toEqual([]);
  });
  it('leaves invoice monthly/consumable/cash fields byte-identical and counts global fees only in invoice cash', () => {
    const i = input();
    i.invoices = [
      {
        id: uid(30),
        ordered_date: today,
        currency: 'GBP',
        shipping_cost: '2',
        tax_cost: '1',
        other_fees: '0',
        discount: '0',
        allocation_method: 'quantity',
        lines: [
          {
            id: uid(31),
            kind: 'medication',
            medication_id: med,
            quantity: 1,
            unit_cost: '20',
          },
          {
            id: uid(32),
            kind: 'consumable',
            medication_id: null,
            category: 'syringe',
            quantity: 1,
            unit_cost: '4',
          },
        ],
      },
    ];
    const old = buildMedicationCostAnalytics(i),
      out = result(i);
    expect(out.monthly_spend).toEqual(old.monthly_spend);
    expect(out.consumables).toEqual(old.consumables);
    expect(out.rows[0]?.spend).toBe(old.rows[0]?.spend);
    expect(out.accounted[0]?.invoice_cash).toBe('27.00');
    expect(out.rows[0]?.accounted[0]?.invoice_cash).toBe('21.50');
  });
  it('reconciles displayed estimate cents with negative invoice cash without inventing fees', () => {
    const i = input();
    i.prescriptions[0]!.cost = '0.005';
    i.invoices = [
      {
        id: uid(30),
        ordered_date: today,
        currency: 'GBP',
        allocation_method: 'none',
        lines: [
          {
            id: uid(32),
            kind: 'consumable',
            medication_id: null,
            quantity: 1,
            unit_cost: '-0.01',
          },
        ],
      },
    ];
    const out = result(i);
    expect(out.accounted[0]).toMatchObject({
      invoice_cash: '-0.01',
      prescription_estimate: '0.01',
      accounted_total: '0.00',
    });
    expect(out.monthly_spend[0]?.overhead).toBe('0.00');
  });
  it('recomputes current Rx edits/link removal without mutating any physical, dose or invoice input', () => {
    const i = input(),
      before = structuredClone(i);
    expect(result(i).rows[0]?.cost_per_dose).toBe('3');
    expect(i).toEqual(before);
    i.prescriptions[0]!.cost = '40';
    expect(result(i).rows[0]?.cost_per_dose).toBe('4');
    i.vials[0]!.prescription_id = null;
    expect(result(i).rows[0]?.uncosted_doses).toBe(1);
  });
});

/** Exact decimal strings as integers scaled by 10^60, so sums are compared without rounding. */
const SCALE = 60;
function exact(value: string): bigint {
  const [mantissa = '0', exponent = '0'] = value.toLowerCase().split('e');
  const [whole = '0', fraction = ''] = mantissa.split('.');
  const digits = BigInt(whole + fraction);
  const shift = SCALE - fraction.length + Number(exponent);
  return shift >= 0
    ? digits * 10n ** BigInt(shift)
    : digits / 10n ** BigInt(-shift);
}
describe('whole-prescription price split across linked vials (per_prescription)', () => {
  const total = (patch: Partial<MedicationCostPrescription> = {}) =>
    rx({ cost_basis: 'per_prescription', cost: '30', ...patch });
  const vials = (n: number, patch: Partial<MedicationCostVial> = {}) =>
    Array.from({ length: n }, (_, i) =>
      vial({ id: uid(100 + i), purchase_item_id: null, ...patch })
    );
  const estimates = (
    v: MedicationCostVial[],
    r = total(),
    invoices: MedicationVialInvoicePrice[] = []
  ) =>
    medicationPrescriptionVialCostsSchema.parse(
      buildMedicationVialCostEstimates({
        vials: v,
        invoice_prices: invoices,
        prescriptions: [r],
      })
    );
  it('gives every linked vial an equal share and labels the basis', () => {
    const out = estimates(vials(3));
    expect(out.vials.map((v) => v.unit_cost)).toEqual(['10', '10', '10']);
    for (const v of out.vials)
      expect(v).toMatchObject({
        cost_source: 'prescription',
        estimate_basis: 'per_prescription',
        prescription_id: uid(20),
        currency: 'GBP',
      });
  });
  it('never lets the shares add up to more than the price, whatever the count and rounding', () => {
    for (const cost of ['10', '2', '0.01', '1', '100.37', '0.3'])
      for (let n = 1; n <= 40; n++) {
        const out = estimates(vials(n), total({ cost }));
        const sum = out.vials.reduce((acc, v) => acc + exact(v.unit_cost!), 0n);
        expect(sum <= exact(cost)).toBe(true);
        // ...and falls short only by rounding far below a cent.
        expect(exact(cost) - sum < exact('1e-30')).toBe(true);
      }
  });
  it('treats a free prescription as a known free share and divides by the vials actually linked', () => {
    expect(estimates(vials(2), total({ cost: '0' })).vials[0]).toMatchObject({
      is_costed: true,
      unit_cost: '0',
    });
    // The snapshot's own count wins when it is larger than the vials in hand.
    expect(
      estimates(vials(1), total({ linked_vial_count: 3 })).vials[0]?.unit_cost
    ).toBe('10');
    expect(
      estimates(vials(4), total({ linked_vial_count: 1 })).vials[0]?.unit_cost
    ).toBe('7.5');
  });
  it('lets a linked vial that has its own invoice price take the invoice and leaves its share unspent', () => {
    const invoice = invoicePrice({ unit_cost: '4', purchase_item_id: uid(31) });
    const v = [
      ...vials(2),
      vial({ id: uid(120), purchase_item_id: invoice.purchase_item_id }),
    ];
    const out = estimates(v, total(), [invoice]);
    expect(out.vials.map((x) => [x.cost_source, x.unit_cost])).toEqual([
      ['prescription', '10'],
      ['prescription', '10'],
      ['invoice', '4'],
    ]);
    const split = out.vials
      .filter((x) => x.cost_source === 'prescription')
      .reduce((acc, x) => acc + exact(x.unit_cost!), 0n);
    expect(split <= exact('30')).toBe(true);
  });
  it('moves every share when a vial is linked or unlinked', () => {
    expect(estimates(vials(2)).vials[0]?.unit_cost).toBe('15');
    expect(estimates(vials(3)).vials[0]?.unit_cost).toBe('10');
    expect(estimates(vials(1)).vials[0]?.unit_cost).toBe('30');
  });
  it('prices nothing without a linked vial, for an uncovered medicine, or for a non-vial', () => {
    expect(
      resolveMedicationVialPrice({
        vial: vial(),
        invoice_prices: new Map(),
        prescriptions: new Map([[uid(20), total({ linked_vial_count: 0 })]]),
      }).is_costed
    ).toBe(false);
    expect(
      estimates(vials(2, { medication_id: other })).vials.some(
        (v) => v.is_costed
      )
    ).toBe(false);
    expect(
      estimates(vials(2, { kind: 'pen' })).vials.some((v) => v.is_costed)
    ).toBe(false);
  });
  it('prices the vials of every covered medicine from one total', () => {
    const v = [
      vial({ id: uid(100), medication_id: med }),
      vial({ id: uid(101), medication_id: other }),
    ];
    const out = estimates(v, total({ medication_ids: [med, other] }));
    expect(out.vials.map((x) => x.unit_cost)).toEqual(['15', '15']);
  });
  it('keeps the schema honest: a prescription estimate needs a known basis', () => {
    const base = estimates(vials(1)).vials[0]!;
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...base,
        estimate_basis: 'something_else',
      }).success
    ).toBe(false);
    expect(
      medicationPrescriptionVialCostSchema.safeParse({
        ...base,
        estimate_basis: null,
      }).success
    ).toBe(false);
  });
  it('reaches the cost report: the total is counted once however many vials share it', () => {
    const i = input();
    i.vials = vials(3);
    i.prescriptions = [total()];
    i.doses = [];
    const out = medicationPrescriptionCostAnalyticsSchema.parse(
      buildMedicationPrescriptionCostAnalytics(i)
    );
    expect(out.accounted[0]).toMatchObject({
      currency: 'GBP',
      prescription_estimate: '30.00',
      estimated_vials: 3,
    });
  });
  it('keeps currencies apart: two prescriptions in two currencies are two buckets', () => {
    const i = input();
    i.vials = [
      vial({ id: uid(100), prescription_id: uid(20) }),
      vial({ id: uid(101), prescription_id: uid(21) }),
    ];
    i.prescriptions = [
      total(),
      total({ id: uid(21), currency: 'EUR', cost: '8' }),
    ];
    i.doses = [];
    const out = medicationPrescriptionCostAnalyticsSchema.parse(
      buildMedicationPrescriptionCostAnalytics(i)
    );
    expect(
      out.accounted.map((b) => [b.currency, b.prescription_estimate])
    ).toEqual(
      expect.arrayContaining([
        ['GBP', '30.00'],
        ['EUR', '8.00'],
      ])
    );
  });
});
