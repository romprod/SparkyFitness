import { describe, expect, it } from 'vitest';
import {
  buildMedicationCostAnalytics,
  type MedicationCostInvoice,
  type MedicationCostDose,
  type MedicationCostVial,
} from '@workspace/shared';
const consumable = (
  id: string,
  unit_cost = '20',
  extra: Partial<MedicationCostInvoice['lines'][number]> = {}
): MedicationCostInvoice['lines'][number] => ({
  id,
  kind: 'consumable',
  medication_id: null,
  quantity: 2,
  unit_cost,
  category: 'needle',
  units_per_pack: 10,
  ...extra,
});
const invoice = (
  lines: MedicationCostInvoice['lines'],
  extra: Partial<MedicationCostInvoice> = {}
): MedicationCostInvoice => ({
  id: 'invoice',
  ordered_date: '2026-11-15',
  currency: 'GBP',
  allocation_method: 'value',
  lines,
  ...extra,
});
const dose = (
  mass: string | null,
  extra: Partial<MedicationCostDose> = {}
): MedicationCostDose => ({
  medication_id: 'med',
  pen_id: 'vial',
  entry_date: '2026-11-15',
  dose_mg: mass,
  volume_ml: '0',
  dose_input_unit: 'mg',
  ...extra,
});
const vial = (extra: Partial<MedicationCostVial> = {}): MedicationCostVial => ({
  id: 'vial',
  medication_id: 'med',
  label_mass_mg: '10',
  purchase_item_id: 'med-line',
  status: 'finished',
  ...extra,
});
const medLine: MedicationCostInvoice['lines'][number] = {
  id: 'med-line',
  kind: 'medication',
  medication_id: 'med',
  quantity: 1,
  unit_cost: '100',
};
const report = (
  invoices: MedicationCostInvoice[] = [],
  doses: MedicationCostDose[] = [],
  vials: MedicationCostVial[] = []
) =>
  buildMedicationCostAnalytics({
    today: '2026-11-15',
    window: '3',
    medications: [{ id: 'med', name: 'Synthetic medication' }],
    invoices,
    doses,
    vials,
  });

describe('consumable purchase estimates', () => {
  it('models each qualifying line from landed pack cost; partial declarations exclude other lines', () => {
    const result = report(
      [
        invoice(
          [
            consumable('a', '20', { units_per_dose: '2' }),
            consumable('b', '10', { units_per_dose: '1' }),
            consumable('c', '30', { category: 'swab' }),
          ],
          { shipping_cost: '12' }
        ),
      ],
      [dose('1')]
    ).consumables;
    expect(result).toMatchObject({
      spend: '132.00',
      cost_per_dose: '5.5',
      cost_per_dose_basis: 'modelled',
      modelled_lines: 2,
      unmodelled_lines: 1,
    });
    expect(result.rows[0]).toMatchObject({
      category: 'needle',
      pieces: '40',
      spend: '66.00',
      cost_per_piece: '1.65',
    });
  });
  it('defaults missing pack size to one and preserves free modelled lines', () => {
    expect(
      report([
        invoice([
          consumable('a', '0', { units_per_pack: null, units_per_dose: '1' }),
        ]),
      ]).consumables
    ).toMatchObject({
      cost_per_dose: '0',
      cost_per_dose_basis: 'modelled',
      dose_count: 0,
    });
    expect(
      report([
        invoice([
          consumable('a', '20', { units_per_pack: null, units_per_dose: '1' }),
        ]),
      ]).consumables.cost_per_dose
    ).toBe('20');
  });
  it('amortises all landed spend only when no eligible line and has doses', () => {
    const invoices = [
      invoice([consumable('a', '20', { units_per_dose: '0' })], {
        discount: '10',
      }),
    ];
    expect(report(invoices, [dose('1'), dose(null)]).consumables).toMatchObject(
      { cost_per_dose: '15', cost_per_dose_basis: 'amortised', dose_count: 2 }
    );
    expect(report(invoices).consumables).toMatchObject({
      cost_per_dose: null,
      cost_per_dose_basis: 'unavailable',
    });
    const zero = report([
      invoice([
        consumable('a', '20', {
          quantity: 0,
          units_per_dose: '1',
          units_per_pack: 0,
        }),
      ]),
    ]).consumables;
    expect(zero.rows[0]?.cost_per_piece).toBeNull();
    expect(zero.modelled_lines).toBe(0);
  });
  it('tracks modelled currency separately from mixed total spend and preserves negative estimates', () => {
    const result = report([
      invoice([consumable('a', '20', { units_per_dose: '1' })], {
        discount: '60',
      }),
      invoice([consumable('b')], { currency: 'USD' }),
    ]).consumables;
    expect(result).toMatchObject({
      spend: null,
      spend_mixed_currency: true,
      cost_per_dose: '-1',
      cost_per_dose_currency: 'GBP',
      cost_per_dose_mixed_currency: false,
    });
    const mixed = report([
      invoice([consumable('a', '20', { units_per_dose: '1' })]),
      invoice([consumable('b', '20', { units_per_dose: '1' })], {
        currency: 'USD',
      }),
    ]).consumables;
    expect(mixed).toMatchObject({
      cost_per_dose: null,
      cost_per_dose_mixed_currency: true,
    });
  });
});
describe('monthly invoice cash spend', () => {
  it('uses inclusive invoice dates, ascending nonempty months and raw bands plus net overhead', () => {
    const result = report([
      invoice([medLine, consumable('a')], {
        ordered_date: '2026-08-15',
        shipping_cost: '10',
        discount: '30',
      }),
      invoice([medLine], { ordered_date: '2026-11-15' }),
      invoice([medLine], { ordered_date: '2026-08-14' }),
      invoice([medLine], { ordered_date: '2026-11-16' }),
    ]).monthly_spend;
    expect(result).toEqual([
      {
        month: '2026-08',
        medication_subtotal: '100.00',
        consumable_subtotal: '40.00',
        overhead: '-20.00',
        total: '120.00',
        currency: 'GBP',
        mixed_currency: false,
      },
      {
        month: '2026-11',
        medication_subtotal: '100.00',
        consumable_subtotal: '0.00',
        overhead: '0.00',
        total: '100.00',
        currency: 'GBP',
        mixed_currency: false,
      },
    ]);
  });
  it('reconciles fractional cents to paid invoice totals and never combines currencies', () => {
    const result = report([
      invoice(
        [
          { ...medLine, unit_cost: '0.005' },
          consumable('a', '0.005', { quantity: 1 }),
        ],
        { discount: '0.03' }
      ),
    ]).monthly_spend[0];
    expect(result).toMatchObject({
      medication_subtotal: '0.00',
      consumable_subtotal: '0.01',
      overhead: '-0.03',
      total: '-0.02',
    });
    expect(
      report([invoice([medLine]), invoice([medLine], { currency: 'USD' })])
        .monthly_spend[0]
    ).toMatchObject({
      total: null,
      medication_subtotal: null,
      overhead: null,
      currency: null,
      mixed_currency: true,
    });
  });
});
describe('current closed stock unused estimates', () => {
  it('uses lifetime delivered mass outside the reporting window and includes exactly 70 percent', () => {
    const result = report(
      [invoice([medLine], { ordered_date: '2025-01-01' })],
      [dose('6', { entry_date: '2025-01-01' }), dose('1')],
      [vial()]
    );
    expect(result.waste.rows[0]).toMatchObject({
      delivered_mass_mg: '7',
      utilisation_percent: '70',
      estimated_unused_mg: '3',
      estimated_unused_value: '30.00',
    });
    expect(result.rows[0]?.spend).toBeNull();
    expect(
      report([invoice([medLine])], [dose('7.0001')], [vial()]).waste.rows
    ).toEqual([]);
  });
  it('excludes sealed/in-use/reopened stock and overdrawn closed stock', () => {
    for (const status of ['sealed', 'in_use', 'active', null])
      expect(
        report([invoice([medLine])], [], [vial({ status })]).waste.rows
      ).toEqual([]);
    expect(
      report(
        [invoice([medLine])],
        [dose('11')],
        [vial({ status: 'discarded' })]
      ).waste.rows
    ).toEqual([]);
  });
  it('keeps unknown and zero labels or delivered history explicit, and zero/negative prices known', () => {
    for (const label_mass_mg of [null, '0'])
      expect(
        report([invoice([medLine])], [], [vial({ label_mass_mg })]).waste
      ).toMatchObject({ unavailable_vials: 1, estimated_unused_value: null });
    expect(
      report([invoice([medLine])], [dose(null)], [vial()]).waste.rows[0]
    ).toMatchObject({
      delivered_mass_mg: null,
      estimated_unused_mg: null,
      estimated_unused_value: null,
      value_unavailable: true,
    });
    expect(
      report([invoice([{ ...medLine, unit_cost: '0' }])], [dose('0')], [vial()])
        .waste.rows[0]?.estimated_unused_value
    ).toBe('0.00');
    expect(
      report([invoice([medLine], { discount: '120' })], [], [vial()]).waste
        .rows[0]?.estimated_unused_value
    ).toBe('-20.00');
  });
  it('recomputes from corrected/deleted records and separates mixed currency totals', () => {
    const invoices = [invoice([medLine])];
    expect(
      report(invoices, [dose('6')], [vial()]).waste.estimated_unused_value
    ).toBe('40.00');
    expect(
      report(invoices, [dose('2')], [vial()]).waste.estimated_unused_value
    ).toBe('80.00');
    expect(report(invoices, [], [vial()]).waste.estimated_unused_value).toBe(
      '100.00'
    );
    expect(
      report(
        [
          ...invoices,
          invoice([{ ...medLine, id: 'usd' }], { currency: 'USD' }),
        ],
        [],
        [vial(), vial({ id: 'vial2', purchase_item_id: 'usd' })]
      ).waste
    ).toMatchObject({
      estimated_unused_value: null,
      currency: null,
      mixed_currency: true,
    });
  });
});

it('ranks comparable category spend and unused value with Decimal; mixed values use stable names', () => {
  const result = report(
    [
      invoice([
        consumable('cheap', '1', { category: 'needle' }),
        consumable('dear', '20', { category: 'swab' }),
        medLine,
        { ...medLine, id: 'more', unit_cost: '200' },
      ]),
    ],
    [],
    [vial({ id: 'low' }), vial({ id: 'high', purchase_item_id: 'more' })]
  );
  expect(result.consumables.rows.map((row) => row.category)).toEqual([
    'swab',
    'needle',
  ]);
  expect(result.waste.rows.map((row) => row.vial_id)).toEqual(['high', 'low']);
  const mixed = report([
    invoice([consumable('a', '1', { category: 'swab' })]),
    invoice([consumable('b', '200', { category: 'needle' })], {
      currency: 'USD',
    }),
  ]);
  expect(mixed.consumables.rows.map((row) => row.category)).toEqual([
    'needle',
    'swab',
  ]);
});

it('keeps actual zero fees and never assigns category rounding to an empty band', () => {
  const noFees = report([
    invoice([
      { ...medLine, unit_cost: '0.005' },
      consumable('a', '0.005', { quantity: 1 }),
    ]),
  ]).monthly_spend[0];
  expect(noFees).toMatchObject({
    medication_subtotal: '0.00',
    consumable_subtotal: '0.01',
    overhead: '0.00',
    total: '0.01',
  });
  const onlyConsumables = report([
    invoice([
      consumable('a', '0.005', { quantity: 1 }),
      consumable('b', '0.005', { quantity: 1 }),
    ]),
  ]).monthly_spend[0];
  expect(onlyConsumables).toMatchObject({
    medication_subtotal: '0.00',
    consumable_subtotal: '0.01',
    overhead: '0.00',
    total: '0.01',
  });
  // Synthetic signed source values exercise cancellation independently of write validation.
  const cancelled = report([
    invoice([
      { ...medLine, unit_cost: '0.005' },
      consumable('a', '0.005', { quantity: 1 }),
    ]),
    invoice([{ ...medLine, id: 'b', unit_cost: '0.005' }]),
    invoice([
      { ...medLine, id: 'c', unit_cost: '-0.01' },
      consumable('d', '-0.005', { quantity: 1 }),
    ]),
  ]).monthly_spend[0];
  expect(cancelled).toMatchObject({
    medication_subtotal: '0.00',
    consumable_subtotal: '0.00',
    overhead: '0.00',
    total: '0.00',
  });
});

it('uses category membership after raw and rounded cancellation, preserving real overhead', () => {
  const monthly = report([
    invoice([consumable('positive', '0.004', { quantity: 1 })], {
      shipping_cost: '0.004',
    }),
    invoice([consumable('negative', '-0.004', { quantity: 1 })], {
      shipping_cost: '0.004',
    }),
  ]).monthly_spend[0];
  expect(monthly).toMatchObject({
    medication_subtotal: '0.00',
    consumable_subtotal: '0.01',
    overhead: '0.00',
    total: '0.01',
  });
});
