import { describe, expect, it } from 'vitest';
import {
  buildMedicationCostAnalytics,
  usageMonths,
  type MedicationCostDose,
  type MedicationCostInvoice,
  type MedicationCostVial,
} from '@workspace/shared';

// One 10 mg vial for 100 => 10 per mg.
const invoice = (currency = 'GBP', line = 'line'): MedicationCostInvoice => ({
  id: 'inv-' + line,
  ordered_date: '2026-01-01',
  currency,
  allocation_method: 'value',
  lines: [
    {
      id: line,
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
  entry_date: string,
  mg = '1',
  pen_id: string | null = 'v1'
): MedicationCostDose => ({
  medication_id: 'med',
  pen_id,
  entry_date,
  dose_mg: mg,
  volume_ml: '0',
  dose_input_unit: 'mg',
});
const run = (
  doses: MedicationCostDose[],
  window: '3' | '6' | '12' | 'all' = '12',
  extra: Partial<Parameters<typeof buildMedicationCostAnalytics>[0]> = {}
) =>
  buildMedicationCostAnalytics({
    today: '2026-08-14',
    window,
    medications: [{ id: 'med', name: 'Med' }],
    invoices: [invoice()],
    vials: [vial('v1')],
    doses,
    ...extra,
  }).run_rate;

describe('usageMonths', () => {
  it('spans first costed dose to today', () => {
    expect(
      usageMonths({
        firstDayKey: '2026-02-14',
        todayKey: '2026-08-14',
        windowMonths: 12,
      })
    ).toBe(6);
  });
  it('never exceeds the window', () => {
    expect(
      usageMonths({
        firstDayKey: '2024-01-01',
        todayKey: '2026-08-14',
        windowMonths: 3,
      })
    ).toBe(3);
  });
  it('falls back to the window when there is no usage', () => {
    expect(
      usageMonths({
        firstDayKey: null,
        todayKey: '2026-08-14',
        windowMonths: 6,
      })
    ).toBe(6);
    expect(
      usageMonths({
        firstDayKey: null,
        todayKey: '2026-08-14',
        windowMonths: null,
      })
    ).toBe(1);
  });
  it('floors at one month so a short span never inflates the rate', () => {
    expect(
      usageMonths({
        firstDayKey: '2026-08-14',
        todayKey: '2026-08-14',
        windowMonths: null,
      })
    ).toBe(1);
  });
});

describe('cost report run rate', () => {
  it('divides costed dose spend by months of actual use, not the window', () => {
    // 4 mg => 40, first costed dose six months ago inside a 12 month window.
    const rate = run([
      dose('2026-02-14', '1'),
      dose('2026-05-01', '1'),
      dose('2026-07-01', '2'),
    ]);
    expect(rate).toEqual({
      per_month: '6.67',
      months_of_data: 6,
      currency: 'GBP',
      mixed_currency: false,
    });
  });
  it('reports about a month for one recent week rather than a fraction', () => {
    expect(run([dose('2026-08-10', '1')])).toMatchObject({
      per_month: '10.00',
      months_of_data: 1,
    });
  });
  it('takes the span from costed doses only, ignoring older uncosted history', () => {
    const rate = run([dose('2025-09-01', '1', null), dose('2026-08-01', '1')]);
    expect(rate.months_of_data).toBe(1);
    expect(rate.per_month).toBe('10.00');
  });
  it('has no rate when nothing could be costed', () => {
    expect(run([dose('2026-08-01', '1', null)], '6')).toEqual({
      per_month: null,
      months_of_data: 6,
      currency: null,
      mixed_currency: false,
    });
  });
  it('hides the rate when costs are in different currencies', () => {
    const rate = run(
      [dose('2026-08-01', '1'), dose('2026-08-02', '1', 'v2')],
      '12',
      {
        invoices: [invoice('GBP'), invoice('USD', 'line2')],
        vials: [vial('v1'), vial('v2', 'line2')],
      }
    );
    expect(rate).toMatchObject({
      per_month: null,
      currency: null,
      mixed_currency: true,
    });
  });
});
