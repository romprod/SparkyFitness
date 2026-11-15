import { legacyModelAvailability } from '@/pages/Medications/modelAvailability';
import type { Medication, SerumCurveResponse } from '@/types/medications';
const med = { name: 'Unlisted', custom_fields: {} } as Medication;
const empty: SerumCurveResponse = {
  drugId: null,
  curve: [],
  doseDays: [],
  anchorDate: null,
  currentLevelFraction: null,
  disclaimer: '',
};
it('does not identify a specific missing parameter for an unresolved old response', () => {
  expect(legacyModelAvailability(med, empty, 1)).toEqual({
    status: 'unavailable',
    reason: 'unresolved_profile',
  });
});
it('prefers populated server curve evidence over an unknown local catalogue', () => {
  expect(
    legacyModelAvailability(
      med,
      { ...empty, curve: [{ day: 0, level: 1, fraction: 1 }] },
      1
    ).status
  ).toBe('available');
});
it('uses server-resolved model evidence to distinguish an empty history', () => {
  expect(
    legacyModelAvailability(med, { ...empty, drugId: 'new-server-model' }, 0)
  ).toEqual({ status: 'no_logged_history', reason: null });
  expect(
    legacyModelAvailability(
      med,
      { ...empty, drugId: 'new-server-model' },
      undefined
    )
  ).toEqual({ status: 'unavailable', reason: null });
});
it.each([undefined, 0, 'not-a-number'])(
  'preserves the custom default behavior for raw %s',
  (value) => {
    const custom = {
      ...med,
      custom_fields: {
        glp1_drug: 'custom',
        custom_half_life_days: value,
        custom_t_max_days: value,
      },
    };
    expect(
      legacyModelAvailability(custom, { ...empty, drugId: 'custom' }, 0).status
    ).toBe('no_logged_history');
  }
);
it('preserves name-first resolution before an invalid configured custom model', () => {
  const named = {
    ...med,
    name: 'Ozempic',
    custom_fields: { glp1_drug: 'custom', custom_half_life_days: -2 },
  };
  expect(legacyModelAvailability(named, empty, 0).status).toBe(
    'no_logged_history'
  );
});
it('does not invent invalid field names from old ambiguous data', () => {
  const custom = {
    ...med,
    custom_fields: { glp1_drug: 'custom', custom_half_life_days: -2 },
  };
  expect(
    legacyModelAvailability(custom, { ...empty, drugId: 'custom' }, 0)
  ).toEqual({ status: 'unavailable', reason: null });
});

it('prefers a newer server-resolved profile over stale local custom fields', () => {
  const custom = {
    ...med,
    custom_fields: { glp1_drug: 'custom', custom_half_life_days: -2 },
  };
  expect(
    legacyModelAvailability(custom, { ...empty, drugId: 'new-server-model' }, 0)
  ).toEqual({ status: 'no_logged_history', reason: null });
});
