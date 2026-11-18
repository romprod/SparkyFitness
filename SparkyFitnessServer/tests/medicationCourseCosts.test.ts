import { describe, expect, it } from 'vitest';
import {
  buildMedicationCourseCosts,
  type MedicationCostDose,
  type MedicationCostInvoice,
  type MedicationCostVial,
  type MedicationCourseCostInput,
} from '@workspace/shared';

// One 10 mg vial costing 100 => 10 per mg.
const invoice = (currency = 'GBP'): MedicationCostInvoice => ({
  id: 'inv',
  ordered_date: '2026-11-01',
  currency,
  allocation_method: 'value',
  lines: [
    {
      id: 'line',
      kind: 'medication',
      medication_id: 'med',
      quantity: 1,
      unit_cost: '100',
    },
  ],
});
const vial = (id: string, line = 'line'): MedicationCostVial => ({
  id,
  medication_id: 'med',
  label_mass_mg: '10',
  purchase_item_id: line,
  status: 'in_use',
});
const dose = (
  course_id: string | null,
  mg: string,
  pen_id: string | null = 'v1'
): MedicationCostDose => ({
  course_id,
  medication_id: 'med',
  pen_id,
  entry_date: '2026-11-10',
  dose_mg: mg,
  volume_ml: '0',
  dose_input_unit: 'mg',
});
const course = (id: string, name = id) => ({
  course_id: id,
  medication_id: 'med',
  medication_name: 'Med',
  name,
  status: 'active',
  start_date: '2026-11-01',
  end_date: null,
});
const input = (
  over: Partial<MedicationCourseCostInput> = {}
): MedicationCourseCostInput => ({
  as_of: '2026-11-18',
  courses: [course('a')],
  invoices: [invoice()],
  vials: [vial('v1')],
  doses: [],
  ...over,
});
const row = (r: ReturnType<typeof buildMedicationCourseCosts>, id = 'a') =>
  r.rows.find((x) => x.course_id === id)!;

describe('buildMedicationCourseCosts', () => {
  it('sums actual consumed cost per course and keeps unattributed doses apart', () => {
    const r = buildMedicationCourseCosts(
      input({
        courses: [course('a'), course('b')],
        doses: [
          dose('a', '1'),
          dose('a', '2'),
          dose('b', '0.5'),
          dose(null, '4'),
        ],
      })
    );
    expect(row(r, 'a').actual).toMatchObject({
      cost: '30.00',
      currency: 'GBP',
      costed_doses: 2,
      delivered_mg: '3',
      cost_per_dose: '15',
      cost_per_mg: '10',
    });
    expect(row(r, 'b').actual.cost).toBe('5.00');
    expect(r.unattributed.cost).toBe('40.00');
  });

  it('counts uncosted doses instead of guessing a price', () => {
    const r = buildMedicationCourseCosts(
      input({
        doses: [
          dose('a', '1'),
          dose('a', '1', null),
          dose('a', '1', 'unknown'),
        ],
      })
    );
    expect(row(r).actual).toMatchObject({
      costed_doses: 1,
      uncosted_doses: 2,
      cost: '10.00',
    });
  });

  it('treats doses of a course that is not listed as unattributed', () => {
    const r = buildMedicationCourseCosts(input({ doses: [dose('gone', '1')] }));
    expect(r.unattributed.costed_doses).toBe(1);
    expect(row(r).actual.costed_doses).toBe(0);
  });

  it('hides cost when a course mixes currencies', () => {
    const r = buildMedicationCourseCosts(
      input({
        invoices: [
          invoice('GBP'),
          {
            ...invoice('USD'),
            id: 'inv2',
            lines: [
              {
                id: 'line2',
                kind: 'medication',
                medication_id: 'med',
                quantity: 1,
                unit_cost: '100',
              },
            ],
          },
        ],
        vials: [vial('v1'), vial('v2', 'line2')],
        doses: [dose('a', '1'), dose('a', '1', 'v2')],
      })
    );
    expect(row(r).actual).toMatchObject({
      mixed_currency: true,
      cost: null,
      currency: null,
    });
  });

  it('lists the newest course first', () => {
    const r = buildMedicationCourseCosts(
      input({
        courses: [
          { ...course('old'), start_date: '2026-01-01' },
          { ...course('new'), start_date: '2026-06-01' },
        ],
      })
    );
    expect(r.rows.map((x) => x.course_id)).toEqual(['new', 'old']);
  });
});
