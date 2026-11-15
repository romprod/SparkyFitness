import { describe, it, expect } from 'vitest';
import {
  buildMedicationCostAnalytics,
  medicationCostRange,
  formatPurchaseRate,
  type MedicationCostInvoice,
  type MedicationCostVial,
  type MedicationCostDose,
} from '@workspace/shared';
const today = '2026-11-15',
  med = 'med';
const invoice = (
  id: string,
  unit_cost: string,
  ordered_date = today,
  currency = 'AUD',
  discount = '0'
): MedicationCostInvoice => ({
  id,
  ordered_date,
  currency,
  discount,
  allocation_method: 'value',
  lines: [
    { id, kind: 'medication', medication_id: med, quantity: 1, unit_cost },
  ],
});
const vial = (
  id: string,
  item: string | null,
  label = '10'
): MedicationCostVial => ({
  id,
  medication_id: med,
  purchase_item_id: item,
  label_mass_mg: label,
});
const dose = (
  pen_id: string | null,
  dose_mg: string | null,
  entry_date = today
): MedicationCostDose => ({
  pen_id,
  medication_id: med,
  dose_mg,
  entry_date,
  volume_ml: '0',
  dose_input_unit: 'mg',
});
const report = (
  invoices: MedicationCostInvoice[],
  vials: MedicationCostVial[],
  doses: MedicationCostDose[]
) =>
  buildMedicationCostAnalytics({
    today,
    medications: [{ id: med, name: 'Synthetic' }],
    invoices,
    vials,
    doses,
  });
// Nine expected rate/count cases independently executed against b305 costs-core at precision 40.
describe('source product-cost rollups', () => {
  it('matches costed denominators, zero and uncosted source golden', () => {
    expect(
      report(
        [invoice('a', '40'), invoice('b', '100'), invoice('c', '0')],
        [vial('a', 'a'), vial('b', 'b', '20'), vial('c', 'c'), vial('d', null)],
        [
          dose('a', '1'),
          dose('a', '0'),
          dose('b', '2'),
          dose('c', '1'),
          dose('d', '9'),
        ]
      ).rows[0]
    ).toMatchObject({
      spend: '140.00',
      cost_per_dose: '3.5',
      cost_per_mg: '3.5',
      costed_doses: 4,
      uncosted_doses: 1,
    });
  });
  it.each([
    {
      name: 'all-zero-delivery',
      price: '40',
      label: '10',
      amount: '0',
      expected: {
        cost_per_dose: '0',
        cost_per_mg: null,
        costed_doses: 1,
        uncosted_doses: 0,
      },
    },
    {
      name: 'unknown-label',
      price: '40',
      label: '0',
      amount: '1',
      expected: {
        cost_per_dose: null,
        cost_per_mg: null,
        costed_doses: 0,
        uncosted_doses: 1,
      },
    },
    {
      name: 'old-invoice-current-dose',
      price: '40',
      label: '10',
      amount: '1',
      expected: {
        cost_per_dose: '4',
        cost_per_mg: '4',
        costed_doses: 1,
        uncosted_doses: 0,
      },
    },
    {
      name: 'retrospective-price-edit',
      price: '60',
      label: '10',
      amount: '1',
      expected: {
        cost_per_dose: '6',
        cost_per_mg: '6',
        costed_doses: 1,
        uncosted_doses: 0,
      },
    },
    {
      name: 'retrospective-label-edit',
      price: '40',
      label: '20',
      amount: '1',
      expected: {
        cost_per_dose: '2',
        cost_per_mg: '2',
        costed_doses: 1,
        uncosted_doses: 0,
      },
    },
  ])('$name', (test) => {
    expect(
      report(
        [invoice('a', test.price, '2020-01-01')],
        [vial('a', 'a', test.label)],
        [dose('a', test.amount)]
      ).rows[0]
    ).toMatchObject({ spend: null, ...test.expected });
  });
  it('matches negative current invoice, knownzero spend-only and unlinked source goldens', () => {
    expect(
      report(
        [invoice('a', '0', today, 'AUD', '5')],
        [vial('a', 'a')],
        [dose('a', '1')]
      ).rows[0]
    ).toMatchObject({
      spend: '-5.00',
      cost_per_dose: '-0.5',
      cost_per_mg: '-0.5',
    });
    expect(report([invoice('a', '0')], [], []).rows[0]).toMatchObject({
      spend: '0.00',
      spend_present: true,
      cost_per_dose: null,
      costed_doses: 0,
    });
    expect(report([], [], [dose(null, '1')]).rows[0]).toMatchObject({
      spend: null,
      cost_per_dose: null,
      costed_doses: 0,
      uncosted_doses: 1,
    });
  });
  it('sums rounded landed lines but uses unrounded landed-unit rates', () => {
    const invoices = [
      {
        ...invoice('a', '0.335'),
        lines: ['a', 'b', 'c'].map((id) => ({
          id,
          kind: 'medication' as const,
          medication_id: med,
          quantity: 1,
          unit_cost: '0.335',
        })),
      },
    ];
    expect(
      report(invoices, [vial('v', 'a', '1')], [dose('v', '1')]).rows[0]
    ).toMatchObject({
      spend: '1.02',
      cost_per_dose: '0.335',
      cost_per_mg: '0.335',
    });
  });
  it('separates metric currencies and includes old zero-cost usage contributors', () => {
    const invoices = [
      invoice('a', '0', today, 'AUD'),
      invoice('b', '40', '2020-01-01', 'GBP'),
    ];
    expect(
      report(invoices, [vial('a', 'a'), vial('b', 'b')], [dose('b', '1')])
        .rows[0]
    ).toMatchObject({
      spend: '0.00',
      spend_currency: 'AUD',
      spend_mixed_currency: false,
      usage_currency: 'GBP',
      cost_per_dose: '4',
      usage_mixed_currency: false,
    });
    expect(
      report(
        invoices,
        [vial('a', 'a'), vial('b', 'b')],
        [dose('a', '0'), dose('b', '1')]
      ).rows[0]
    ).toMatchObject({
      spend: '0.00',
      usage_currency: null,
      usage_mixed_currency: true,
      cost_per_dose: null,
      cost_per_mg: null,
      costed_doses: 2,
    });
    expect(
      report(
        [invoice('a', '0', today, 'AUD'), invoice('b', '40', today, 'GBP')],
        [vial('b', 'b')],
        [dose('b', '1')]
      ).rows[0]
    ).toMatchObject({
      spend: null,
      spend_present: true,
      spend_mixed_currency: true,
      usage_currency: 'GBP',
      cost_per_dose: '4',
    });
  });
  it('leaves missing invalid mass and unreliable zeros uncosted', () => {
    const cases = [
      dose('a', '0'),
      { ...dose('a', '0'), volume_ml: null },
      { ...dose('a', '0'), volume_ml: 'NaN' },
      { ...dose('a', '0'), volume_ml: 'Infinity' },
      dose('a', null),
      dose('a', 'NaN'),
      dose('a', '-1'),
    ];
    expect(
      report([invoice('a', '0')], [vial('a', 'a')], cases).rows[0]
    ).toMatchObject({
      cost_per_dose: '0',
      cost_per_mg: null,
      costed_doses: 1,
      uncosted_doses: 6,
    });
  });
  it('excludes out-of-window slots and never invents orphan groups', () => {
    const invoices = [
      invoice('a', '40'),
      {
        ...invoice('orphan', '10'),
        lines: [{ ...invoice('orphan', '10').lines[0]!, medication_id: null }],
      },
    ];
    const result = report(
      invoices,
      [vial('a', 'a')],
      [
        dose('a', '1', '2025-11-14'),
        dose('a', '1', '2026-11-16'),
        { ...dose('a', '1'), medication_id: null },
      ]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      spend: '40.00',
      costed_doses: 0,
      uncosted_doses: 0,
    });
  });
  it('orders comparable spend exactly descending, with absent/zero/negative source positions and stable ties', () => {
    const medications = [
      { id: 'alpha', name: 'Alpha' },
      { id: 'zulu', name: 'Zulu' },
      { id: 'absent', name: 'Absent' },
      { id: 'zero', name: 'Zero' },
      { id: 'negative', name: 'Negative' },
    ];
    const priced = (id: string, price: string, discount = '0') => ({
      ...invoice(id, price, today, 'AUD', discount),
      lines: [{ ...invoice(id, price).lines[0]!, medication_id: id }],
    });
    const result = buildMedicationCostAnalytics({
      today,
      medications,
      invoices: [
        priced('alpha', '123456789123456789.12'),
        priced('zulu', '123456789123456789.13'),
        priced('zero', '0'),
        priced('negative', '0', '1'),
      ],
      vials: [],
      doses: [{ ...dose(null, '1'), medication_id: 'absent' }],
    });
    expect(result.rows.map((row) => row.medication_id)).toEqual([
      'zulu',
      'alpha',
      'absent',
      'zero',
      'negative',
    ]);
    expect(
      result.rows.find((row) => row.medication_id === 'absent')
    ).toMatchObject({ spend: null, spend_present: false });
    const tied = buildMedicationCostAnalytics({
      today,
      medications: [
        { id: 'b', name: 'Same' },
        { id: 'a', name: 'Same' },
      ],
      invoices: [],
      vials: [],
      doses: [
        { ...dose(null, '1'), medication_id: 'b' },
        { ...dose(null, '1'), medication_id: 'a' },
      ],
    });
    expect(tied.rows.map((row) => row.medication_id)).toEqual(['a', 'b']);
  });
  it('uses alphabetical order for multiple spend currencies or a mixed-spend row', () => {
    const medications = [
      { id: 'alpha', name: 'Alpha' },
      { id: 'zulu', name: 'Zulu' },
    ];
    const a = {
      ...invoice('a', '1', today, 'AUD'),
      lines: [{ ...invoice('a', '1').lines[0]!, medication_id: 'alpha' }],
    };
    const z = {
      ...invoice('z', '100', today, 'GBP'),
      lines: [{ ...invoice('z', '100').lines[0]!, medication_id: 'zulu' }],
    };
    expect(
      buildMedicationCostAnalytics({
        today,
        medications,
        invoices: [z, a],
        vials: [],
        doses: [],
      }).rows.map((row) => row.medication_id)
    ).toEqual(['alpha', 'zulu']);
    const mixed = {
      ...invoice('mixed', '100', today, 'GBP'),
      lines: [{ ...invoice('mixed', '100').lines[0]!, medication_id: 'alpha' }],
    };
    const result = buildMedicationCostAnalytics({
      today,
      medications,
      invoices: [mixed, a, { ...z, currency: 'AUD' }],
      vials: [],
      doses: [],
    });
    expect(result.rows.map((row) => row.medication_id)).toEqual([
      'alpha',
      'zulu',
    ]);
    expect(result.rows[0]?.spend_mixed_currency).toBe(true);
  });
  it('uses inclusive source month rollover and exact source rate display', () => {
    expect(medicationCostRange('2026-05-31', '3')).toEqual({
      key: '3',
      from_date: '2026-03-03',
      to_date: '2026-05-31',
    });
    expect(medicationCostRange(today, 'all').from_date).toBe('1970-01-01');
    expect(
      report(
        [invoice('a', '40', '2025-11-15')],
        [vial('a', 'a')],
        [dose('a', '1', '2025-11-15')]
      ).rows[0]
    ).toMatchObject({ spend: '40.00', costed_doses: 1 });
    expect(formatPurchaseRate('0.335', 'custom')).toBe('custom 0.335');
    expect(formatPurchaseRate('-0.0004', 'GBP')).toBe('GBP -0.000');
    expect(formatPurchaseRate('123456789123456789.12', 'AUD')).toBe(
      'AUD 123456789123456789.12'
    );
    expect(formatPurchaseRate('0', 'AUD')).toBe('AUD 0.00');
  });
});
