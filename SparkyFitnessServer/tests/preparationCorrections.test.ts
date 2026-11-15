import { describe, expect, it } from 'vitest';
import {
  medicationPreparationInputSchema,
  medicationPreparationReviewInputSchema,
  preparationCorrectionValues,
  preparationCorrectionBalance,
  correctedDeliveredMass,
  calculatePreparationValues,
  previewPreparationCreation,
  preparationCreationValues,
} from '@workspace/shared';

describe('reviewed preparation arithmetic and compatible labelled inputs', () => {
  it('normalizes premix label creation without fabricating a requested dose', () => {
    const parsed = medicationPreparationInputSchema.parse({
      mode: 'premixed',
      label_concentration_value: '3.125',
      label_concentration_unit: 'mg/ml',
      final_volume_ml: 2,
      prepared_date: '2026-11-15',
    });
    expect(parsed).toMatchObject({
      mass_value: 6.25,
      mass_unit: 'mg',
      label_concentration_value: '3.125',
    });
    expect(
      medicationPreparationInputSchema.safeParse({
        mode: 'premixed',
        label_concentration_value: '0',
        label_concentration_unit: 'mg/ml',
        mass_value: 10,
        mass_unit: 'mg',
        final_volume_ml: 2,
        prepared_date: '2026-11-15',
      }).success
    ).toBe(false);
    const repeating = medicationPreparationInputSchema.parse({
      mode: 'premixed',
      label_concentration_value: '3.3',
      label_concentration_unit: 'mg/ml',
      final_volume_ml: 0.3,
      prepared_date: '2026-11-15',
    });
    expect(calculatePreparationValues(repeating)).toEqual({
      mass_mg: 0.99,
      concentration_mg_ml: 3.3,
    });
    expect(
      medicationPreparationInputSchema.safeParse({
        mode: 'premixed',
        label_concentration_value: '1e400',
        label_concentration_unit: 'mg/ml',
        final_volume_ml: 2,
        prepared_date: '2026-11-15',
      }).success
    ).toBe(false);
  });
  it('keeps original legacy numeric preparation input compatible', () => {
    const value = {
      mode: 'reconstituted',
      mass_value: 10000,
      mass_unit: 'mcg',
      final_volume_ml: 2,
      prepared_date: '2026-11-15',
    };
    expect(medicationPreparationInputSchema.parse(value)).toEqual(value);
  });
  it('uses exact mass correction for physical draws without rerounding, including zero', () => {
    expect(correctedDeliveredMass('0.03', '0.1')).toBe('0.003');
    expect(correctedDeliveredMass('0', '4')).toBe('0');
    expect(() => correctedDeliveredMass('-0.01', '4')).toThrow();
    expect(
      preparationCorrectionValues({
        mode: 'reconstituted',
        mass_value: '10000',
        mass_unit: 'mcg',
        final_volume_ml: '2',
        prepared_date: '2026-11-15',
      })
    ).toMatchObject({ mass_mg: '10', concentration_mg_ml: '5' });
  });
  it('retains unknown stock and exposes known overdraw rather than hiding deficit', () => {
    const dose = { dose_mg: '4', volume_ml: '1', dose_input_unit: 'mg' };
    expect(preparationCorrectionBalance('3', '1', [dose], true)).toEqual({
      view: {
        concentration_mg_ml: '3',
        final_volume_ml: '1',
        remaining_mg: '0',
        remaining_ml: '0',
      },
      overdrawn: '1',
    });
    expect(
      preparationCorrectionBalance('3', '1', [dose], false).view.remaining_mg
    ).toBeNull();
    expect(
      preparationCorrectionBalance('3', '1', [{ ...dose, dose_mg: null }], true)
        .view.remaining_mg
    ).toBeNull();
  });
  it('requires source label mg/mL and real calendar dates on new contracts', () => {
    const request = {
      expected_revision: 0,
      preparation: {
        mode: 'premixed',
        label_concentration_value: '3',
        label_concentration_unit: 'mg/ml',
        final_volume_ml: '2',
        prepared_date: '2026-11-15',
      },
    };
    expect(
      medicationPreparationReviewInputSchema.safeParse(request).success
    ).toBe(true);
    expect(
      medicationPreparationReviewInputSchema.safeParse({
        ...request,
        preparation: {
          ...request.preparation,
          label_concentration_unit: 'mcg/ml',
        },
      }).success
    ).toBe(false);
    expect(
      medicationPreparationReviewInputSchema.safeParse({
        ...request,
        preparation: { ...request.preparation, prepared_date: '2026-02-30' },
      }).success
    ).toBe(false);
  });
  it('previews source target-volume yield from the same device and leaves no stale figures for invalid/zero targets', () => {
    const raw = {
      mode: 'premixed' as const,
      label_concentration_value: '3.125',
      label_concentration_unit: 'mg/ml' as const,
      final_volume_ml: '1',
      prepared_date: '2026-11-15',
    };
    const device = {
      id: 'synthetic-device',
      name: 'Synthetic mL syringe',
      device_type: 'syringe' as const,
      graduation_type: 'ml' as const,
      units_per_ml: 100,
      capacity_ml: '1',
      capacity_units: 100,
      increment: '0.01',
    };
    const preview = previewPreparationCreation(
      raw,
      { value: '0.051', unit: 'ml' },
      device
    )!;
    expect(preview.values).toEqual({
      mass_mg: '3.125',
      concentration_mg_ml: '3.125',
      final_volume_ml: '1',
    });
    expect(preview.draw).toMatchObject({
      targetVolumeMl: '0.051',
      deliveredVolumeMl: '0.05',
      device: { id: 'synthetic-device', capacity_ml: '1', increment: '0.01' },
    });
    expect(preview.doses_in_vial).toBe('19');
    expect(
      previewPreparationCreation(raw, { value: '0', unit: 'ml' }, device)
        ?.doses_in_vial
    ).toBeNull();
    expect(previewPreparationCreation(raw, null, null)).toMatchObject({
      draw: null,
      doses_in_vial: null,
    });
    expect(
      previewPreparationCreation(raw, { value: '1', unit: 'pumps' }, device)
    ).toMatchObject({ draw: null, doses_in_vial: null });
  });
  it('derives internal exact creation fields from validated raw inputs and strips forged canonical overrides', () => {
    const forged = {
      mode: 'premixed',
      label_concentration_value: '3.125',
      label_concentration_unit: 'mg/ml',
      final_volume_ml: '2',
      prepared_date: '2026-11-15',
      mass_value: 999,
      mass_mg: 999,
      concentration_mg_ml: 999,
      mass_value_exact: '999',
      final_volume_ml_exact: '999',
    };
    const parsed = medicationPreparationInputSchema.parse(forged);
    expect(preparationCreationValues(parsed)).toMatchObject({
      mass_value: '6.25',
      mass_mg: '6.25',
      concentration_mg_ml: '3.125',
      final_volume_ml: '2',
    });
    const legacy = medicationPreparationInputSchema.parse({
      mode: 'reconstituted',
      mass_value: 10,
      mass_unit: 'mg',
      final_volume_ml: 2,
      prepared_date: '2026-11-15',
      mass_value_exact: '999',
      final_volume_ml_exact: '999',
    });
    expect(preparationCreationValues(legacy)).toMatchObject({
      mass_mg: '10',
      concentration_mg_ml: '5',
      final_volume_ml: '2',
    });
  });
});
