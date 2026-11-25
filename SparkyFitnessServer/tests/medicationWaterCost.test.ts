import { describe, expect, it } from 'vitest';
import {
  buildMedicationCostAnalytics,
  buildMedicationCourseCosts,
  medicationPurchaseInputSchema,
  waterCostPerMl,
  vialWaterCost,
  type MedicationCostDose,
  type MedicationCostInvoice,
  type MedicationCostVial,
} from '@workspace/shared';

type Line = MedicationCostInvoice['lines'][number];
const medLine: Line = {
  id: 'med-line',
  kind: 'medication',
  medication_id: 'med',
  quantity: 1,
  unit_cost: '100',
};
const water = (extra: Partial<Line> = {}): Line => ({
  id: 'water-line',
  kind: 'consumable',
  medication_id: null,
  quantity: 1,
  unit_cost: '15',
  category: 'bac_water',
  units_per_pack: 10,
  ml_per_piece: '10',
  ...extra,
});
const invoice = (
  lines: Line[],
  extra: Partial<MedicationCostInvoice> = {}
): MedicationCostInvoice => ({
  id: 'invoice',
  ordered_date: '2026-11-15',
  currency: 'GBP',
  allocation_method: 'none',
  lines,
  ...extra,
});
const vial = (extra: Partial<MedicationCostVial> = {}): MedicationCostVial => ({
  id: 'vial',
  medication_id: 'med',
  label_mass_mg: '10',
  purchase_item_id: 'med-line',
  status: 'in_use',
  diluent_ml: '2',
  ...extra,
});
const dose = (mass = '1'): MedicationCostDose => ({
  medication_id: 'med',
  pen_id: 'vial',
  entry_date: '2026-11-15',
  dose_mg: mass,
  volume_ml: '0.1',
  dose_input_unit: 'mg',
});
const report = (
  invoices: MedicationCostInvoice[],
  vials: MedicationCostVial[] = [vial()],
  doses: MedicationCostDose[] = [dose()]
) =>
  buildMedicationCostAnalytics({
    today: '2026-11-15',
    window: '3',
    medications: [{ id: 'med', name: 'Synthetic medication' }],
    invoices,
    vials,
    doses,
  });

describe('water cost per millilitre', () => {
  it('divides the landed cost of the lines that state a bottle size by the millilitres they bought', () => {
    // 1 pack x 10 bottles x 10 mL = 100 mL for 15.
    expect(waterCostPerMl([invoice([water()])])).toEqual({
      rate: '0.15',
      currency: 'GBP',
      ml: '100',
      spend: '15',
    });
  });
  it('includes the line share of shipping and pools every line', () => {
    const first = invoice([water(), medLine], {
      shipping_cost: '11',
      allocation_method: 'value',
    });
    const second = invoice(
      [
        water({
          id: 'water-3ml',
          unit_cost: '7.5',
          ml_per_piece: '3',
        }),
      ],
      { id: 'second' }
    );
    const result = waterCostPerMl([first, second])!;
    // first line landed = 15 + 11 x 15/115; second = 7.5 over 30 mL; pooled over 130 mL.
    expect(result.ml).toBe('130');
    expect(Number(result.spend)).toBeCloseTo(15 + 1.43 + 7.5, 2);
    expect(Number(result.rate)).toBeCloseTo(Number(result.spend) / 130, 10);
  });
  it('ignores water without a bottle size, other categories, and mixed currencies', () => {
    expect(
      waterCostPerMl([invoice([water({ ml_per_piece: null })])])
    ).toBeNull();
    expect(
      waterCostPerMl([invoice([water({ category: 'other' })])])
    ).toBeNull();
    expect(
      waterCostPerMl([
        invoice([water()]),
        invoice([water({ id: 'w2' })], { id: 'other', currency: 'AUD' }),
      ])
    ).toBeNull();
  });
  it('costs a vial by the volume it was mixed with and nothing when that is unknown', () => {
    const rate = waterCostPerMl([invoice([water()])]);
    expect(vialWaterCost('2', rate)?.toString()).toBe('0.3');
    expect(vialWaterCost(null, rate)).toBeNull();
    expect(vialWaterCost('2', null)).toBeNull();
    expect(vialWaterCost('0', rate)).toBeNull();
  });
});

describe('water in the cost report', () => {
  it('adds a mixed vial water to its per-mg and per-dose cost and reports it apart', () => {
    const result = report([invoice([medLine, water()])]);
    // Vial: 100 for 10 mg = 10 per mg; 2 mL of water at 0.15 = 0.30 more over 10 mg.
    expect(result.rows[0]).toMatchObject({
      costed_doses: 1,
      cost_per_dose: '10.03',
      cost_per_mg: '10.03',
    });
    expect(result.summary.per_dose).toMatchObject({
      peptide: '10',
      water: '0.03',
      sundries: null,
      total: '10.03',
      currency: 'GBP',
    });
    expect(result.consumables).toMatchObject({
      water_cost_per_ml: '0.15',
      water_currency: 'GBP',
      // Water costed through vials is neither a per-dose sundry nor a gap.
      modelled_lines: 0,
      unmodelled_lines: 0,
      cost_per_dose_basis: 'unavailable',
    });
  });
  it('changes nothing until a water line states its bottle size', () => {
    const result = report([invoice([medLine, water({ ml_per_piece: null })])]);
    expect(result.rows[0]).toMatchObject({ cost_per_dose: '10' });
    expect(result.summary.per_dose.water).toBeNull();
    expect(result.consumables.water_cost_per_ml).toBeNull();
    expect(result.consumables.unmodelled_lines).toBe(1);
  });
  it('adds nothing for a vial with no recorded water or in another currency', () => {
    const noWater = report(
      [invoice([medLine, water()])],
      [vial({ diluent_ml: null })]
    );
    expect(noWater.rows[0]).toMatchObject({ cost_per_dose: '10' });
    const otherCurrency = report([
      invoice([medLine]),
      invoice([water()], { id: 'aud', currency: 'AUD' }),
    ]);
    expect(otherCurrency.rows[0]).toMatchObject({ cost_per_dose: '10' });
  });
  it('still models other sundries per dose alongside costed water', () => {
    const swab: Line = {
      id: 'swab',
      kind: 'consumable',
      medication_id: null,
      quantity: 1,
      unit_cost: '4',
      category: 'swab',
      units_per_pack: 100,
      units_per_dose: '2',
    };
    const result = report([invoice([medLine, water(), swab])]);
    expect(result.consumables).toMatchObject({
      modelled_lines: 1,
      unmodelled_lines: 0,
      cost_per_dose: '0.08',
      cost_per_dose_basis: 'modelled',
    });
    expect(result.summary.per_dose).toMatchObject({
      peptide: '10',
      water: '0.03',
      sundries: '0.08',
      total: '10.11',
    });
  });
  it('does not spread costed water over doses again when other sundries are amortised', () => {
    const tip: Line = {
      id: 'tip',
      kind: 'consumable',
      medication_id: null,
      quantity: 1,
      unit_cost: '2',
      category: 'needle',
      units_per_pack: 10,
    };
    const result = report([invoice([medLine, water(), tip])]);
    // Only the needle line is amortised over the one dose; the water is not.
    expect(result.consumables).toMatchObject({
      cost_per_dose: '2',
      cost_per_dose_basis: 'amortised',
    });
  });
  it('flows into course costs the same way', () => {
    const costs = buildMedicationCourseCosts({
      as_of: '2026-11-15',
      courses: [
        {
          course_id: 'course',
          medication_id: 'med',
          medication_name: 'Synthetic medication',
          name: 'Plan',
          status: 'active',
          start_date: '2026-11-01',
          end_date: null,
        },
      ],
      invoices: [invoice([medLine, water()])],
      vials: [vial()],
      doses: [{ ...dose(), course_id: 'course' }],
    });
    expect(costs.rows[0]!.actual).toMatchObject({
      cost: '10.03',
      cost_per_dose: '10.03',
    });
  });
});

describe('invoice line bottle size', () => {
  const base = {
    ordered_date: '2026-11-15',
    currency: 'GBP',
    shipping_cost: '',
    tax_cost: '',
    other_fees: '',
    discount: '',
  };
  const item = (extra: Record<string, unknown> = {}) => ({
    kind: 'consumable',
    category: 'bac_water',
    description: 'Water',
    quantity: 1,
    unit_cost: '5',
    ...extra,
  });
  it('accepts a positive bottle size and treats blank as none', () => {
    const ok = medicationPurchaseInputSchema.parse({
      ...base,
      items: [item({ ml_per_piece: '3' }), item({ ml_per_piece: '' })],
    });
    expect(ok.items.map((i) => i.ml_per_piece)).toEqual(['3', null]);
  });
  it('rejects a zero or negative bottle size', () => {
    for (const ml_per_piece of ['0', '-1', 'abc'])
      expect(
        medicationPurchaseInputSchema.safeParse({
          ...base,
          items: [item({ ml_per_piece })],
        }).success
      ).toBe(false);
  });
});
