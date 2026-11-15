import { describe, expect, it, vi } from 'vitest';
import { calculateStoredDraw } from '../models/medicationSyringeRepository.js';
import type { PoolClient } from 'pg';
import {
  computeDraw,
  drawTargetDisplay,
  drawTargetFillFraction,
  drawConcentration,
  positiveDrawDoseSchema,
} from '@workspace/shared';
const syringe = {
  name: 'Test syringe',
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
};
const draw = (
  value: string,
  options: Partial<Parameters<typeof computeDraw>[0]> = {}
) =>
  computeDraw({
    dose: { value, unit: 'mg' },
    concentrationMcgPerMl: '1000',
    syringe,
    ...options,
  });
describe('reference syringe draw semantics', () => {
  it('reports missing legacy concentration as a normal validation error', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            kind: 'vial',
            type_id: 'injection',
            mass_value: null,
            concentration_mg_ml: null,
            volume_ml: null,
            doses_used: 0,
            linked_count: 0,
            missing_count: 0,
            used_mg: '0',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [syringe] });
    await expect(
      calculateStoredDraw({ query } as unknown as PoolClient, 'owner', 'vial', {
        syringe_id: 'syringe',
        dose: { value: '1', unit: 'mg' },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it('binds preview capacity to the same saved device used in the calculation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            kind: 'vial',
            type_id: 'injection',
            mass_value: null,
            concentration_mg_ml: '1',
            volume_ml: '1',
            doses_used: 0,
            linked_count: 0,
            missing_count: 0,
            used_mg: '0',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ ...syringe, capacity_ml: '0.5' }] });
    const result = await calculateStoredDraw(
      { query } as unknown as PoolClient,
      'owner',
      'vial',
      { syringe_id: 'syringe', dose: { value: '1', unit: 'ml' } }
    );
    expect(result.syringeCapacityMl).toBe('0.5');
    expect(
      result.warnings.some((w) => w.code === 'EXCEEDS_SYRINGE_CAPACITY')
    ).toBe(true);
  });
  it('formats the four target values at source precision independently of delivered rounding', () => {
    expect(
      drawTargetDisplay({
        targetMassMcg: '1234.56',
        targetVolumeMl: '0.123456',
        rawUnits: '12.3456',
      })
    ).toEqual({ mcg: '1234.6', mg: '1.235', ml: '0.123', units: '12.3' });
    expect(
      drawTargetDisplay({
        targetMassMcg: '500',
        targetVolumeMl: '0.5',
        rawUnits: '50',
      })
    ).toEqual({ mcg: '500', mg: '0.5', ml: '0.5', units: '50' });
  });
  it('keeps the syringe visual finite and capped without changing draw checks', () => {
    expect(drawTargetFillFraction('0.25', '0.5')).toBe(0.5);
    expect(drawTargetFillFraction('2', '1')).toBe(1);
    expect(drawTargetFillFraction('0', '1')).toBe(0);
    expect(drawTargetFillFraction('1e300', '1e-300')).toBe(1);
    for (const capacity of ['0', '-1', '', 'Infinity'])
      expect(drawTargetFillFraction('1', capacity)).toBeNull();
  });
  it('invalid decimal strings safely fail parsing', () => {
    for (const value of ['', 'abc', 'NaN', 'Infinity', '-1'])
      expect(
        positiveDrawDoseSchema.safeParse({ value, unit: 'mg' }).success
      ).toBe(false);
  });
  it('rounds halfway up and reports delivered mass separately', () => {
    expect(draw('0.015')).toMatchObject({
      targetMassMcg: '15',
      targetVolumeMl: '0.015',
      markingValue: '2',
      deliveredVolumeMl: '0.02',
      deliveredMassMcg: '20',
      roundingErrorMcg: '5',
    });
  });
  it('keeps positive subgraduation draws valid with delivered zero', () => {
    const r = draw('0.001');
    expect(r.deliveredMassMcg).toBe('0');
    expect(r.warnings.map((w) => w.code)).toEqual([
      'BELOW_MEASURABLE_MINIMUM',
      'ROUNDING_ERROR_HIGH',
    ]);
    expect(r.warnings.some((w) => w.severity === 'block')).toBe(false);
  });
  it('accepts source API zero but keeps source UI input positive', () => {
    expect(draw('0').warnings).toEqual([]);
    expect(
      positiveDrawDoseSchema.safeParse({ value: '0', unit: 'mg' }).success
    ).toBe(false);
  });
  it('checks target volume rather than rounded delivery', () => {
    const r = draw('0.995', {
      syringe: { ...syringe, capacity_ml: '0.996' },
      remainingMl: '0.996',
    });
    expect(r.deliveredVolumeMl).toBe('1');
    expect(r.warnings.some((w) => w.severity === 'block')).toBe(false);
  });
  it('uses strict capacity/remaining limits and full barrel warning', () => {
    expect(draw('1', { remainingMl: '1' }).warnings.map((w) => w.code)).toEqual(
      ['FULL_BARREL']
    );
    expect(
      draw('1.001', { remainingMl: '1' }).warnings.map((w) => w.code)
    ).toEqual(['EXCEEDS_SYRINGE_CAPACITY', 'EXCEEDS_REMAINING_VIAL']);
  });
  it('does not warn at exactly 2 raw units', () => {
    expect(draw('0.02').warnings).toEqual([]);
  });
  it('warns rounding strictly above 5 percent', () => {
    expect(
      draw('0.1', { syringe: { ...syringe, increment: '2.1' } }).warnings.map(
        (w) => w.code
      )
    ).toEqual([]);
    expect(
      draw('0.1', { syringe: { ...syringe, increment: '2.102' } }).warnings.map(
        (w) => w.code
      )
    ).toEqual(['ROUNDING_ERROR_HIGH']);
  });
  it('supports mL graduations and every input unit', () => {
    for (const dose of [
      { value: '1', unit: 'mg' as const },
      { value: '1000', unit: 'mcg' as const },
      { value: '1', unit: 'ml' as const },
      { value: '100', unit: 'units' as const },
    ])
      expect(
        computeDraw({
          dose,
          concentrationMcgPerMl: '1000',
          syringe: { ...syringe, graduation_type: 'ml', increment: '0.01' },
        }).deliveredMassMcg
      ).toBe('1000');
  });
  it('uses original inputs before a lossy concentration projection', () => {
    expect(
      drawConcentration({
        mass_value: '1',
        mass_unit: 'mg',
        final_volume_ml: '3',
        concentration_mg_ml: '0.3333333333333333',
      })
    ).toBe('333.3333333333333333333333333333333333333');
  });
});
