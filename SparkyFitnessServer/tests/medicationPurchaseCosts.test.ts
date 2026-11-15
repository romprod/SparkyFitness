import { describe, it, expect } from 'vitest';
import {
  allocateMedicationPurchase,
  formatPurchaseMoney,
  normalizePurchaseDecimal,
  medicationPurchaseCreateSchema,
} from '@workspace/shared';
const allocation = (
  costs: string[],
  options: Partial<Parameters<typeof allocateMedicationPurchase>[0]> = {}
) =>
  allocateMedicationPurchase({
    lines: costs.map((unit_cost, index) => ({
      id: String(index),
      quantity: 1,
      unit_cost,
    })),
    allocation_method: 'value',
    ...options,
  });
describe('source invoice allocation and exact money', () => {
  it('allocates exact cents and puts residual on first largest basis tie', () => {
    const result = allocation(['1', '1', '1'], { shipping_cost: '10' });
    expect(result.lines.map((line) => line.allocated)).toEqual([
      '3.34',
      '3.33',
      '3.33',
    ]);
    expect(result).toMatchObject({
      subtotal: '3.00',
      overhead: '10.00',
      total: '13.00',
      unallocated: '0.00',
    });
  });
  it('falls back from zero line values to quantities and discloses it', () => {
    const result = allocation([], {
      lines: [
        { id: 'a', quantity: 2, unit_cost: '0' },
        { id: 'b', quantity: 1, unit_cost: '0' },
      ],
      shipping_cost: '1',
    });
    expect(result.effective_method).toBe('quantity-fallback');
    expect(result.lines.map((line) => line.allocated)).toEqual([
      '0.67',
      '0.33',
    ]);
  });
  it('retains source negative overhead and explicit unallocated mode', () => {
    expect(allocation(['3', '3'], { discount: '10' })).toMatchObject({
      overhead: '-10.00',
      total: '-4.00',
      unallocated: '0.00',
    });
    const result = allocation(['3', '3'], {
      shipping_cost: '1',
      allocation_method: 'none',
    });
    expect(result.unallocated).toBe('1.00');
    expect(result.lines.map((line) => line.landed_unit)).toEqual(['3', '3']);
  });
  it('rounds raw sums at source boundaries, not every input or printed line', () => {
    const result = allocation(['0.335', '0.335', '0.335']);
    expect(result.lines.map((line) => line.subtotal)).toEqual([
      '0.34',
      '0.34',
      '0.34',
    ]);
    expect(result.lines.map((line) => line.landed_unit)).toEqual([
      '0.335',
      '0.335',
      '0.335',
    ]);
    expect(result.total).toBe('1.01');
  });
  it('renders free-form currency and accepted large money without Number clipping', () => {
    expect(
      formatPurchaseMoney('123456789123456789.12', 'custom currency')
    ).toBe('custom currency 123456789123456789.12');
    expect(formatPurchaseMoney('0', 'AUD')).toBe('AUD 0.00');
    expect(formatPurchaseMoney('1e500', 'AUD')).not.toMatch(/Infinity|NaN/);
  });
  it('retains monetary precision and validates only representable nonnegative inputs', () => {
    expect(normalizePurchaseDecimal('0.123456789123456789')).toBe(
      '0.123456789123456789'
    );
    for (const value of [
      '-1',
      'NaN',
      'Infinity',
      'abc',
      '1e131072',
      '1e-16384',
      '1.' + '0'.repeat(17000) + '1',
    ])
      expect(normalizePurchaseDecimal(value)).toBeNull();
    const draft = {
      expected_owner_id: '00000000-0000-4000-8000-000000000001',
      operation_id: '00000000-0000-4000-8000-000000000002',
      ordered_date: '2026-11-15',
      items: [
        {
          kind: 'consumable',
          description: 'Synthetic needles',
          quantity: '3',
          unit_cost: '0.335',
        },
      ],
    };
    expect(medicationPurchaseCreateSchema.parse(draft)).toMatchObject({
      currency: 'AUD',
      shipping_cost: '0',
      allocation_method: 'value',
      items: [{ quantity: 3, unit_cost: '0.335' }],
    });
    expect(
      medicationPurchaseCreateSchema.safeParse({
        ...draft,
        ordered_date: '0000-01-01',
      }).success
    ).toBe(false);
    expect(
      medicationPurchaseCreateSchema.safeParse({
        ...draft,
        received_date: '2026-11-14',
      }).success
    ).toBe(false);
    expect(
      medicationPurchaseCreateSchema.safeParse({
        ...draft,
        items: [
          {
            kind: 'consumable',
            quantity: 2,
            unit_cost: '12.50',
            description: '   ',
          },
        ],
      }).success
    ).toBe(false);
  });
});
