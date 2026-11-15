import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  computeDraw,
  medicationSyringeInputSchema,
  normalizeMedicationDevice,
  normalizeDeviceDose,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
  mlToPumps,
  recordedDoseForEdit,
  positiveDeviceDoseSchema,
  preparationBudNotice,
} from '@workspace/shared';
import { calculateStoredDraw } from '../models/medicationSyringeRepository.js';

const syringe = {
  name: 'Synthetic device',
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '5',
  capacity_units: 500,
  increment: '0.1',
};
const pump = normalizeMedicationDevice({ ...syringe, device_type: 'pump' });

describe('prepared device route and pump contract', () => {
  it('warns from the explicit BUD against local today without inventing a date or blocking', () => {
    expect(preparationBudNotice(null, '2026-11-15')).toBeNull();
    expect(preparationBudNotice('2026-11-19', '2026-11-15')).toBeNull();
    expect(preparationBudNotice('2026-11-18', '2026-11-15')).toEqual({
      state: 'approaching',
      daysRemaining: 3,
    });
    expect(preparationBudNotice('2026-11-15', '2026-11-15')).toEqual({
      state: 'approaching',
      daysRemaining: 0,
    });
    expect(preparationBudNotice('2026-11-14', '2026-11-15')).toEqual({
      state: 'passed',
      daysRemaining: -1,
    });
    expect(preparationBudNotice('2026-02-30', '2026-11-15')).toBeNull();
  });
  it.each([
    [{ type_id: 'injection', route_id: null }, 'injection'],
    [{ type_id: 'injection', route_id: 'subcutaneous' }, 'injection'],
    [{ type_id: 'injection', route_id: 'intramuscular' }, 'injection'],
    [{ type_id: 'injection', route_id: 'oral' }, null],
    [{ type_id: 'injection', route_id: 'topical' }, null],
    [{ type_id: 'nasal_spray', route_id: null }, 'nasal'],
    [{ type_id: 'nasal_spray', route_id: 'oral' }, null],
    [{ type_id: 'liquid', route_id: 'nasal' }, 'nasal'],
    [{ type_id: 'liquid', route_id: null }, null],
  ] as const)('classifies medication identity %j as %s', (med, expected) => {
    expect(resolvePreparedMedicationRoute(med)).toBe(expected);
  });

  it('keeps legacy input syringe-compatible and normalizes fixed spray fields', () => {
    expect(
      medicationSyringeInputSchema.parse(syringe).device_type
    ).toBeUndefined();
    expect(normalizeMedicationDevice(syringe).device_type).toBe('syringe');
    expect(pump).toMatchObject({
      device_type: 'pump',
      graduation_type: 'ml',
      capacity_units: 50,
    });
    expect(
      normalizeMedicationDevice({ ...pump, capacity_ml: '0.15' }).capacity_units
    ).toBe(2);
    expect(
      normalizeMedicationDevice({ ...pump, capacity_ml: '0.01' }).capacity_units
    ).toBe(0);
    expect(isDeviceEligibleForRoute(undefined, 'injection')).toBe(true);
    expect(isDeviceEligibleForRoute('pen', 'injection')).toBe(true);
    expect(isDeviceEligibleForRoute('pump', 'injection')).toBe(false);
    expect(isDeviceEligibleForRoute('syringe', 'nasal')).toBe(false);
  });

  it('normalizes request pump counts exactly and rounds mass to metered sprays', () => {
    expect(normalizeDeviceDose({ value: '3', unit: 'pumps' }, pump)).toEqual({
      value: '0.3',
      unit: 'ml',
    });
    expect(mlToPumps('0.3', '0.1')).toBe('3');
    const result = computeDraw({
      dose: normalizeDeviceDose({ value: '0.25', unit: 'mg' }, pump),
      concentrationMcgPerMl: '1000',
      syringe: pump,
    });
    expect(result).toMatchObject({
      targetVolumeMl: '0.25',
      markingValue: '0.3',
      deliveredMassMcg: '300',
    });
    expect(() =>
      normalizeDeviceDose({ value: '1', unit: 'units' }, pump)
    ).toThrow();
    expect(() =>
      normalizeDeviceDose({ value: '1', unit: 'pumps' }, syringe)
    ).toThrow();
  });

  it('loads delivered quantities into their original edit unit without guessing a requested target', () => {
    expect(
      recordedDoseForEdit({
        dose_mg: 0.3,
        dose_mg_exact: '0.300000000000000001',
        dose_input_unit: 'mg',
      })
    ).toEqual({ value: '0.300000000000000001', unit: 'mg' });
    expect(
      recordedDoseForEdit({
        dose_mg: '0.123456789123456789',
        dose_input_unit: 'mcg',
      })
    ).toEqual({ value: '123.456789123456789', unit: 'mcg' });
    expect(
      recordedDoseForEdit(
        { dose_mg: '0.3', volume_ml: '0.3', dose_input_unit: 'ml' },
        pump
      )
    ).toEqual({ value: '3', unit: 'pumps' });
    expect(
      recordedDoseForEdit(
        { dose_mg: '0.3', volume_ml: null, dose_input_unit: 'ml' },
        pump
      )
    ).toBeNull();
    expect(
      recordedDoseForEdit({ dose_mg: '0.3', dose_input_unit: 'unknown' })
    ).toBeNull();
    expect(
      recordedDoseForEdit({
        dose_mg: '0.3',
        syringe_units: '30',
        dose_input_unit: 'units',
      })
    ).toEqual({ value: '30', unit: 'units' });
    expect(
      recordedDoseForEdit(
        { dose_mg: '0.3', volume_ml: '0.3', dose_input_unit: 'units' },
        syringe
      )
    ).toBeNull();
    expect(
      positiveDeviceDoseSchema.safeParse({ value: '1e-400', unit: 'pumps' })
        .success
    ).toBe(true);
    expect(
      positiveDeviceDoseSchema.safeParse({ value: '0', unit: 'pumps' }).success
    ).toBe(false);
  });

  it('binds pump type/increment/capacity and normalized unit to the exact preview row', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            kind: 'vial',
            type_id: 'nasal_spray',
            route_id: null,
            mass_value: null,
            concentration_mg_ml: '1',
            volume_ml: '5',
            doses_used: 0,
            linked_count: 0,
            missing_count: 0,
            used_mg: '0',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ ...pump, id: 'device' }] });
    const result = await calculateStoredDraw(
      { query } as unknown as PoolClient,
      'owner',
      'vial',
      { syringe_id: 'device', dose: { value: '2', unit: 'pumps' } }
    );
    expect(result).toMatchObject({
      administrationRoute: 'nasal',
      doseInputUnit: 'ml',
      targetVolumeMl: '0.2',
      device: {
        id: 'device',
        device_type: 'pump',
        increment: '0.1',
        capacity_ml: '5',
      },
    });
  });

  it('rejects a pump for an injection medication before any draw can be written', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ kind: 'vial', type_id: 'injection', route_id: null }],
      })
      .mockResolvedValueOnce({ rows: [pump] });
    await expect(
      calculateStoredDraw({ query } as unknown as PoolClient, 'owner', 'vial', {
        syringe_id: 'device',
        dose: { value: '2', unit: 'pumps' },
      })
    ).rejects.toThrow('medication route');
  });
});
