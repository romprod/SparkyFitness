import {
  CreateInjectionBodySchema,
  CreatePenBodySchema,
} from '../schemas/medicationSchemas.js';
import { describe, it, expect } from 'vitest';
import {
  calculatePreparation,
  calculateVialStock,
} from '../../shared/src/medications/preparation.ts';
describe('preparation and mass stock', () => {
  it('converts labelled mass and final volume into concentration and draw', () => {
    expect(calculatePreparation(12, 3, 0.6)).toEqual({
      concentrationMgMl: 4,
      drawMl: 0.15,
      dosesAvailable: 20,
      exceedsVial: false,
    });
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid input %s', (v) => {
    expect(calculatePreparation(v, 2, 1)).toBeNull();
    expect(calculatePreparation(10, v, 1)).toBeNull();
    expect(calculatePreparation(10, 2, v)).toBeNull();
  });
  it('tracks variable dose mass rather than injection count', () => {
    const stock = calculateVialStock(4, 3, 0.6 + 1.2 + 0.3, 0)!;
    expect(stock.remainingMg).toBeCloseTo(9.9);
    expect(stock.remainingMl).toBeCloseTo(2.475);
  });
  it('does not invent amounts for missing doses', () => {
    expect(calculateVialStock(4, 3, 1, 1)).toBeNull();
    expect(calculateVialStock(null, 3, 1, 0)).toBeNull();
  });
  it('reports overdraw without negative remaining volume', () => {
    expect(calculateVialStock(4, 3, 13, 0)).toMatchObject({
      remainingMg: 0,
      remainingMl: 0,
      overdrawnMg: 1,
    });
  });
});

it('does not leave phantom mass after a decimal vial is exhausted', () => {
  expect(calculateVialStock(0.1, 3, 0.3, 0)?.remainingMg).toBe(0);
});
it('rejects overflowing vial capacity', () => {
  expect(calculateVialStock(1e300, 1e300, 0, 0)).toBeNull();
});

it('rejects invalid stock inputs at the API boundary', () => {
  expect(CreatePenBodySchema.safeParse({ volume_ml: 0 }).success).toBe(false);
  expect(
    CreatePenBodySchema.safeParse({ concentration_mg_ml: -1 }).success
  ).toBe(false);
  expect(
    CreateInjectionBodySchema.safeParse({
      medication_id: '00000000-0000-4000-8000-000000000001',
      dose_mg: -0.5,
    }).success
  ).toBe(false);
});
