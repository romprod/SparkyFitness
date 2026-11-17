import { describe, it, expect } from 'vitest';
import { prescriptionCostBasis } from '../services/medicationPrescriptionCostBasis.js';
const confirmed = {
  cost: '5.000',
  currency: 'AUD',
  cost_basis: 'per_vial' as const,
};
describe('explicit prescription per-vial intent', () => {
  it.each([{}, { cost: '5' }, { cost: '0' }])(
    'never confirms a new generic price %o',
    (intent) => {
      expect(prescriptionCostBasis(intent)).toBeNull();
    }
  );
  it.each(['5', '0', '0.000'])(
    'accepts supplied known cost including zero %s',
    (cost) => {
      expect(prescriptionCostBasis({ cost, cost_basis: 'per_vial' })).toBe(
        'per_vial'
      );
    }
  );
  it.each([{}, { cost: null }, { cost: 'NaN' }, { cost: '-1' }])(
    'rejects confirmation without valid supplied cost %o',
    (intent) => {
      expect(() =>
        prescriptionCostBasis({ ...intent, cost_basis: 'per_vial' })
      ).toThrow();
    }
  );
  it('notes-only saves preserve existing intent and never confirm legacy costs', () => {
    expect(prescriptionCostBasis({}, confirmed)).toBe('per_vial');
    expect(
      prescriptionCostBasis({}, { ...confirmed, cost_basis: null })
    ).toBeNull();
  });
  it('preserves exact numeric equality and unchanged currency, not display formatting', () => {
    expect(
      prescriptionCostBasis({ cost: '5.00', currency: 'AUD' }, confirmed)
    ).toBe('per_vial');
    expect(
      prescriptionCostBasis({ cost: '0.0' }, { ...confirmed, cost: '0' })
    ).toBe('per_vial');
  });
  it.each([
    { cost: '5.000000000000000001' },
    { cost: null },
    { currency: 'GBP' },
    { currency: 'aud' },
  ])(
    'invalidates omitted basis when exact price/currency changes %o',
    (intent) => {
      expect(prescriptionCostBasis(intent, confirmed)).toBeNull();
    }
  );
  it('honours explicit clearing and explicit reconfirmation separately', () => {
    expect(
      prescriptionCostBasis({ cost: '5', cost_basis: null }, confirmed)
    ).toBeNull();
    expect(
      prescriptionCostBasis(
        { cost: '5', cost_basis: 'per_vial' },
        { ...confirmed, cost_basis: null }
      )
    ).toBe('per_vial');
  });
});
