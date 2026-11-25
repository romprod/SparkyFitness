import { describe, expect, it } from 'vitest';
import {
  MAX_STACK_SETUP_COMPONENTS,
  MAX_STACK_SETUP_VIALS,
  medicationStackSetupInputSchema,
  stackAmountFromMcg,
  stackComponentAmounts,
} from '@workspace/shared';

const component = (over: Record<string, unknown> = {}) => ({
  medication_name: 'Peptide A',
  concentration_value: 5,
  concentration_unit: 'mg/ml',
  vial_volume_ml: 5,
  quantity: 1,
  dose_volume_ml: 0.2,
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  operation_id: '00000000-0000-4000-a000-000000000001',
  name: 'Stack',
  components: [component()],
  ...over,
});
const messages = (value: unknown) => {
  const parsed = medicationStackSetupInputSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe('premixed stack setup request', () => {
  it('accepts a minimal request and tidies the name and notes', () => {
    const parsed = medicationStackSetupInputSchema.parse(
      body({ name: '  Stack ', notes: '  ' })
    );
    expect(parsed.name).toBe('Stack');
    expect(parsed.notes).toBeNull();
    expect(parsed.start_date).toBeUndefined();
  });

  it('gives each limit the Pitstop wording', () => {
    expect(messages(body({ name: '   ' }))).toContain('Give the stack a name.');
    expect(messages(body({ components: [] }))).toContain(
      'Add at least one component with a concentration and positive dose.'
    );
    expect(
      messages(body({ components: [component({ concentration_value: 0 })] }))
    ).toContain(
      'Add at least one component with a concentration and positive dose.'
    );
    expect(
      messages(body({ components: [component({ dose_volume_ml: -1 })] }))
    ).toContain(
      'Add at least one component with a concentration and positive dose.'
    );
    expect(
      messages(
        body({
          components: Array.from(
            { length: MAX_STACK_SETUP_COMPONENTS + 1 },
            (_, i) => component({ medication_name: `Peptide ${i}` })
          ),
        })
      )
    ).toContain('A stack can have at most 20 components.');
    for (const quantity of [0, 1.5, -2])
      expect(
        messages(body({ components: [component({ quantity })] }))
      ).toContain('Each component needs a whole vial quantity of 1 or more.');
    expect(
      messages(body({ components: [component({ quantity: 51 })] }))
    ).toContain('A stack can have at most 50 vials.');
  });

  it('caps the total across components at 50 vials', () => {
    const at = (a: number, b: number) =>
      messages(
        body({
          components: [
            component({ quantity: a }),
            component({ medication_name: 'Peptide B', quantity: b }),
          ],
        })
      );
    expect(at(25, 25)).toEqual([]);
    expect(at(25, 26)).toContain('A stack can have at most 50 vials.');
    expect(MAX_STACK_SETUP_VIALS).toBe(50);
  });

  it('refuses repeated names, a dose larger than the vial and a missing volume', () => {
    expect(
      messages(
        body({
          components: [
            component(),
            component({ medication_name: ' peptide a ' }),
          ],
        })
      )
    ).toContain('Each component needs its own medicine; remove the repeat.');
    expect(
      messages(body({ components: [component({ dose_volume_ml: 6 })] }))
    ).toContain('A dose cannot be larger than its vial.');
    expect(
      messages(body({ components: [component({ vial_volume_ml: 0 })] }))
    ).toContain('Each vial needs a volume above zero.');
  });

  it('needs a start date for a titration ramp', () => {
    const steps = [{ dose: '250', dose_unit: 'mcg', duration_days: 7 }];
    expect(messages(body({ components: [component({ steps })] }))).toContain(
      'A titration ramp needs a stack start date.'
    );
    expect(
      messages(
        body({ start_date: '2026-11-25', components: [component({ steps })] })
      )
    ).toEqual([]);
    expect(
      messages(
        body({
          start_date: '2026-11-25',
          components: [
            component({
              steps: [{ dose: '1', dose_unit: 'ml', duration_days: 7 }],
            }),
          ],
        })
      ).length
    ).toBeGreaterThan(0);
  });

  it('refuses a bad id, time, unit, extra key and over-precise amount', () => {
    expect(messages(body({ operation_id: 'nope' })).length).toBeGreaterThan(0);
    expect(messages(body({ time_of_day: '25:00' })).length).toBeGreaterThan(0);
    expect(messages(body({ time_of_day: '07:30' }))).toEqual([]);
    expect(
      messages(
        body({ components: [component({ concentration_unit: 'iu/ml' })] })
      ).length
    ).toBeGreaterThan(0);
    expect(messages(body({ extra: true })).length).toBeGreaterThan(0);
    expect(
      messages(
        body({ components: [component({ concentration_value: 1.0000001 })] })
      ).length
    ).toBeGreaterThan(0);
  });
});

describe('premixed component amounts', () => {
  it('multiplies exactly: 5 mg/mL x 0.2 mL is 1 mg', () => {
    expect(
      stackComponentAmounts({
        concentration_value: 5,
        concentration_unit: 'mg/ml',
        vial_volume_ml: 5,
        dose_volume_ml: 0.2,
      })
    ).toEqual({
      dose: { value: '1', unit: 'mg' },
      vial: { value: '25', unit: 'mg' },
      concentration_mg_ml: '5',
      doses_per_vial: '25',
    });
  });

  it('reads mcg/mL input and picks mcg below 1 mg', () => {
    expect(
      stackComponentAmounts({
        concentration_value: 250,
        concentration_unit: 'mcg/ml',
        vial_volume_ml: 5,
        dose_volume_ml: 0.1,
      })
    ).toMatchObject({
      dose: { value: '25', unit: 'mcg' },
      vial: { value: '1.25', unit: 'mg' },
      concentration_mg_ml: '0.25',
      doses_per_vial: '50',
    });
  });

  it('avoids float noise and rounds only for display', () => {
    const input = {
      concentration_value: 0.3,
      concentration_unit: 'mg/ml' as const,
      vial_volume_ml: 3,
      dose_volume_ml: 0.1,
    };
    expect(stackComponentAmounts(input)!.dose).toEqual({
      value: '30',
      unit: 'mcg',
    });
    expect(
      stackComponentAmounts(
        { ...input, concentration_value: 1, dose_volume_ml: 0.3333333 },
        2
      )!.dose
    ).toEqual({ value: '333.33', unit: 'mcg' });
    expect(stackAmountFromMcg('1000')).toEqual({ value: '1', unit: 'mg' });
    expect(stackAmountFromMcg('999.5')).toEqual({
      value: '999.5',
      unit: 'mcg',
    });
  });

  it('returns null until every amount is a positive number', () => {
    const base = {
      concentration_value: '5',
      concentration_unit: 'mg/ml' as const,
      vial_volume_ml: '5',
      dose_volume_ml: '0.2',
    };
    expect(stackComponentAmounts(base)).not.toBeNull();
    for (const key of [
      'concentration_value',
      'vial_volume_ml',
      'dose_volume_ml',
    ] as const)
      for (const bad of ['', '0', '-1', 'abc'])
        expect(stackComponentAmounts({ ...base, [key]: bad })).toBeNull();
  });
});
