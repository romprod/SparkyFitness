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
  planned: [],
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

  it('estimates remaining plan from the course own rate', () => {
    const r = buildMedicationCourseCosts(
      input({
        doses: [dose('a', '1')],
        planned: [
          {
            course_id: 'a',
            slots: [
              { value: '2', unit: 'mg' },
              { value: '500', unit: 'mcg' },
            ],
            basis: 'course_end',
            coverage_end: '2026-12-31',
          },
        ],
      })
    );
    expect(row(r).remaining).toMatchObject({
      planned_mg: '2.5',
      planned_doses: 2,
      basis: 'course_end',
      through: '2026-12-31',
      rate_per_mg: '10',
      rate_source: 'course_actual',
      currency: 'GBP',
      estimate: '25.00',
      unavailable_reason: null,
    });
    expect(row(r).projected_total).toBe('35.00');
    expect(row(r).projected_currency).toBe('GBP');
  });

  it('falls back to the medication rate when the course has no costed doses yet', () => {
    const r = buildMedicationCourseCosts(
      input({
        courses: [course('a'), course('b')],
        doses: [dose('b', '2')],
        planned: [
          {
            course_id: 'a',
            slots: [{ value: '1', unit: 'mg' }],
            basis: 'horizon',
            coverage_end: '2027-01-01',
          },
        ],
      })
    );
    expect(row(r).remaining.rate_source).toBe('medication_actual');
    expect(row(r).remaining.estimate).toBe('10.00');
    expect(row(r).remaining.basis).toBe('horizon');
    // No logged doses at all on this course: total is the estimate alone.
    expect(row(r).projected_total).toBe('10.00');
  });

  it('keeps partial actuals visible through the uncosted count', () => {
    const r = buildMedicationCourseCosts(
      input({
        doses: [dose('a', '1'), dose('a', '1', null)],
        planned: [
          {
            course_id: 'a',
            slots: [{ value: '1', unit: 'mg' }],
            basis: 'course_end',
            coverage_end: null,
          },
        ],
      })
    );
    expect(row(r).remaining.estimate).toBe('10.00');
    expect(row(r).projected_total).toBe('20.00');
    const none = buildMedicationCourseCosts(
      input({
        doses: [dose('a', '1', null)],
        planned: [
          {
            course_id: 'a',
            slots: [{ value: '1', unit: 'mg' }],
            basis: 'course_end',
            coverage_end: null,
          },
        ],
      })
    );
    expect(row(none).remaining.unavailable_reason).toBe('no_rate');
    expect(row(none).projected_total).toBeNull();
  });

  it('refuses an estimate for volume or unit based planned doses', () => {
    const r = buildMedicationCourseCosts(
      input({
        doses: [dose('a', '1')],
        planned: [
          {
            course_id: 'a',
            slots: [
              { value: '2', unit: 'mg' },
              { value: '0.1', unit: 'ml' },
            ],
            basis: 'course_end',
            coverage_end: null,
          },
        ],
      })
    );
    expect(row(r).remaining).toMatchObject({
      planned_mg: null,
      estimate: null,
      unavailable_reason: 'non_mass_dose',
    });
  });

  it('reports no plan and mixed currencies honestly', () => {
    const none = buildMedicationCourseCosts(input({ doses: [dose('a', '1')] }));
    expect(row(none).remaining).toMatchObject({
      basis: 'unavailable',
      unavailable_reason: 'no_plan',
      estimate: null,
    });
    const mixed = buildMedicationCourseCosts(
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
        planned: [
          {
            course_id: 'a',
            slots: [{ value: '1', unit: 'mg' }],
            basis: 'course_end',
            coverage_end: null,
          },
        ],
      })
    );
    expect(row(mixed).actual).toMatchObject({
      mixed_currency: true,
      cost: null,
      currency: null,
    });
    expect(row(mixed).remaining.unavailable_reason).toBe('mixed_currency');
  });
});
