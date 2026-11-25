import {
  buildSetupRequest,
  checkSetup,
  componentPreview,
  emptyDraft,
  newComponent,
  newRampRow,
  type SetupDraft,
} from '@/pages/Medications/medicationStackSetup';

const op = '00000000-0000-4000-b000-000000000001';
const draft = (over: Partial<SetupDraft> = {}): SetupDraft => ({
  ...emptyDraft('a'),
  name: 'Peptide stack',
  components: [
    {
      ...newComponent('a'),
      name: 'Peptide A',
      concentration: '5',
      concentrationUnit: 'mg/ml',
    },
  ],
  ...over,
});
const message = (value: SetupDraft) => {
  const check = checkSetup(value, op);
  return check.ok ? null : check.message;
};

describe('premixed stack form helpers', () => {
  it('starts a row with the Pitstop defaults', () => {
    expect(newComponent('k')).toMatchObject({
      vialVolume: '5',
      quantity: '1',
      doseVolume: '0.2',
      ramp: null,
    });
  });

  it('computes the live line with the shared decimal helper', () => {
    const row = {
      ...newComponent('a'),
      concentration: '2500',
      doseVolume: '0.1',
    };
    expect(componentPreview(row)).toEqual({
      volume: '0.1',
      dose: '250 mcg',
      vial: '12.5 mg',
    });
    expect(
      componentPreview({ ...row, vialVolume: '10', doseVolume: '0.2' })
    ).toEqual({ volume: '0.2', dose: '500 mcg', vial: '25 mg' });
    // 5 mg/mL x 0.2 mL is exactly 1 mg, with no float noise.
    expect(
      componentPreview({
        ...row,
        concentration: '5',
        concentrationUnit: 'mg/ml',
        doseVolume: '0.2',
      })?.dose
    ).toBe('1 mg');
    expect(
      componentPreview({
        ...row,
        concentration: '0.3',
        concentrationUnit: 'mg/ml',
        doseVolume: '0.1',
      })?.dose
    ).toBe('30 mcg');
  });

  it('has no line until the row can be computed', () => {
    expect(componentPreview(newComponent('a'))).toBeNull();
    expect(
      componentPreview({ ...newComponent('a'), concentration: 'abc' })
    ).toBeNull();
    expect(
      componentPreview({
        ...newComponent('a'),
        concentration: '5',
        doseVolume: '0',
      })
    ).toBeNull();
  });

  it('builds the request body with numbers, optional fields left out and a ramp as steps', () => {
    const base = draft();
    expect(buildSetupRequest(base, op)).toEqual({
      operation_id: op,
      name: 'Peptide stack',
      notes: '',
      start_date: undefined,
      time_of_day: undefined,
      components: [
        {
          medication_name: 'Peptide A',
          concentration_value: 5,
          concentration_unit: 'mg/ml',
          vial_volume_ml: 5,
          quantity: 1,
          dose_volume_ml: 0.2,
        },
      ],
    });
    const withRamp = draft({
      startDate: '2026-12-01',
      timeOfDay: '07:30',
      components: [
        {
          ...base.components[0]!,
          ramp: [
            { ...newRampRow('r1'), dose: '250', days: '14' },
            { ...newRampRow('r2'), dose: '0.5', unit: 'mg', days: '' },
          ],
        },
      ],
    });
    const body = buildSetupRequest(withRamp, op);
    expect(body.start_date).toBe('2026-12-01');
    expect(body.time_of_day).toBe('07:30');
    expect(body.components[0]!.steps).toEqual([
      { dose: '250', dose_unit: 'mcg', duration_days: 14 },
      { dose: '0.5', dose_unit: 'mg', duration_days: null },
    ]);
    expect(checkSetup(withRamp, op).ok).toBe(true);
  });

  it('accepts a complete form', () => {
    const check = checkSetup(draft(), op);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.name).toBe('Peptide stack');
  });

  it('uses the Pitstop wording for each error', () => {
    expect(message(draft({ name: '  ' }))).toBe('Give the stack a name.');
    const row = draft().components[0]!;
    const noAmount =
      'Add at least one component with a concentration and positive dose.';
    expect(message(draft({ components: [] }))).toBe(noAmount);
    expect(
      message(draft({ components: [{ ...row, concentration: '' }] }))
    ).toBe(noAmount);
    expect(message(draft({ components: [{ ...row, doseVolume: '0' }] }))).toBe(
      noAmount
    );
    expect(message(draft({ components: [{ ...row, quantity: '0' }] }))).toBe(
      'Each component needs a whole vial quantity of 1 or more.'
    );
    expect(message(draft({ components: [{ ...row, quantity: '1.5' }] }))).toBe(
      'Each component needs a whole vial quantity of 1 or more.'
    );
    expect(
      message(
        draft({
          components: Array.from({ length: 21 }, (_, i) => ({
            ...row,
            key: `k${i}`,
            name: `Peptide ${i}`,
          })),
        })
      )
    ).toBe('A stack can have at most 20 components.');
    expect(
      message(
        draft({
          components: [
            { ...row, quantity: '30' },
            { ...row, key: 'b', name: 'Peptide B', quantity: '30' },
          ],
        })
      )
    ).toBe('A stack can have at most 50 vials.');
    expect(
      message(
        draft({
          components: [{ ...row, ramp: [{ ...newRampRow('r'), dose: '250' }] }],
        })
      )
    ).toBe('A titration ramp needs a stack start date.');
  });

  it('flags an open-ended phase that is not the last', () => {
    const row = draft().components[0]!;
    const check = checkSetup(
      draft({
        startDate: '2026-12-01',
        components: [
          {
            ...row,
            ramp: [
              { ...newRampRow('r1'), dose: '250', days: '' },
              { ...newRampRow('r2'), dose: '500', days: '' },
            ],
          },
        ],
      }),
      op
    );
    expect(check).toMatchObject({ ok: false, code: 'rampOpenEnded' });
  });
});
