import { describe, expect, it } from 'vitest';
import {
  medicationVialLabelMassSchema,
  medicationPreparationReviewInputSchema,
} from '@workspace/shared';
import {
  CreatePenBodySchema,
  UpdatePenBodySchema,
} from '../schemas/medicationSchemas.js';

describe('independent printed vial amount contract', () => {
  it('keeps exact high precision and normalizes syntax without number coercion', () => {
    expect(
      medicationVialLabelMassSchema.parse(' 1.23456789123456789123456789 ')
    ).toBe('1.23456789123456789123456789');
    expect(medicationVialLabelMassSchema.parse('1.25e1')).toBe('12.5');
    for (const value of [
      '',
      ' ',
      '0',
      '-1',
      'NaN',
      'Infinity',
      '-Infinity',
      '1e131072',
      '1e-16384',
      1,
    ])
      expect(medicationVialLabelMassSchema.safeParse(value).success).toBe(
        false
      );
  });
  it('distinguishes omission, explicit clearing and independent creation metadata', () => {
    expect(
      CreatePenBodySchema.safeParse({ kind: 'pen', label_mass_mg: '10' })
        .success
    ).toBe(false);
    expect(UpdatePenBodySchema.parse({})).not.toHaveProperty('label_mass_mg');
    expect(UpdatePenBodySchema.parse({ label_mass_mg: null })).toHaveProperty(
      'label_mass_mg',
      null
    );
    const created = CreatePenBodySchema.parse({
      kind: 'vial',
      label_mass_mg: '7.25',
      preparation: {
        mode: 'reconstituted',
        mass_value: '10',
        mass_unit: 'mg',
        final_volume_ml: '2',
        prepared_date: '2026-11-15',
      },
    });
    expect(created.label_mass_mg).toBe('7.25');
    expect(created.preparation?.mass_value).toBe(10);
    expect(
      CreatePenBodySchema.parse({
        kind: 'vial',
        preparation: {
          mode: 'reconstituted',
          mass_value: 10,
          mass_unit: 'mg',
          final_volume_ml: 2,
          prepared_date: '2026-11-15',
        },
      })
    ).not.toHaveProperty('label_mass_mg');
  });
  it('does not accept label mutation as part of active preparation correction', () => {
    const request = medicationPreparationReviewInputSchema.parse({
      expected_revision: 0,
      label_mass_mg: '999',
      preparation: {
        mode: 'reconstituted',
        mass_value: '10',
        mass_unit: 'mg',
        final_volume_ml: '2',
        prepared_date: '2026-11-15',
      },
    });
    expect(request).not.toHaveProperty('label_mass_mg');
  });
});
