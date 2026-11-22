import { describe, expect, it } from 'vitest';
import {
  analyseMetabolicTest,
  metabolicTestExportRows,
  metabolicTestInputSchema,
  METABOLIC_TEST_EXPORT_HEADERS,
  rmrConditionsUnknown,
  rmrEquations,
  rmrNoiseBand,
  rmrPerKg,
  vo2FromRmr,
  type MetabolicTest,
} from '@workspace/shared';

const allUnknown = {
  fasted: null,
  fasting_hours: null,
  no_caffeine: null,
  no_training_prior_day: null,
  active_travel: null,
  rested: null,
  rest_min_before_test: null,
  illness_free_14d: null,
  awake_quiet: null,
};
const test = (patch: Partial<MetabolicTest> = {}): MetabolicTest => ({
  id: '00000000-0000-4000-a000-0000000000a1',
  tested_day: '2026-10-05',
  method: 'ic_vo2_only',
  device_label: 'VO2-only analyser',
  facility: 'Clinic',
  measured_rmr_kcal: 2000,
  kcal_per_litre_o2: 4.81,
  vo2_ml_min: null,
  vco2_ml_min: null,
  rq: null,
  duration_min: 15,
  steady_state_cv_pct: 6.5,
  sex: 'male',
  age_years: 40,
  height_cm: 180,
  weight_kg: 90,
  fat_free_mass_kg: null,
  reported_predicted_kcal: 1900,
  reported_prediction_equation: 'Mifflin-St Jeor',
  reported_activity_factor: 1.4,
  reported_activity_label: 'Moderate',
  prep: allUnknown,
  room_temp_c: 21,
  notes: 'private',
  ...patch,
});
const row = (rows: ReturnType<typeof rmrEquations>, key: string) =>
  rows.find((r) => r.key === key)!;

describe('prediction equations', () => {
  const base = {
    rmrKcal: 2000,
    sex: 'male' as const,
    ageYears: 40,
    heightCm: 180,
    weightKg: 90,
  };

  it('computes the weight-based equations from the subject values', () => {
    const rows = rmrEquations({ ...base, ffmKg: null });
    expect(row(rows, 'mifflin').predictedKcal).toBeCloseTo(1830, 6);
    expect(row(rows, 'harris_benedict_roza').predictedKcal).toBeCloseTo(
      1930.832,
      3
    );
    expect(row(rows, 'ten_haaf_weight').predictedKcal).toBeCloseTo(2027.22, 1);
    expect(row(rows, 'tinsley_2019_weight').predictedKcal).toBeCloseTo(2242, 6);
  });

  it('uses the female constants', () => {
    const rows = rmrEquations({
      rmrKcal: 1400,
      sex: 'female',
      ageYears: 30,
      heightCm: 165,
      weightKg: 60,
      ffmKg: null,
    });
    expect(row(rows, 'mifflin').predictedKcal).toBeCloseTo(1320.25, 6);
    expect(row(rows, 'harris_benedict_roza').predictedKcal).toBeCloseTo(
      447.593 + 9.247 * 60 + 3.098 * 165 - 4.33 * 30,
      6
    );
  });

  it('gives measured over predicted, and leaves the fat-free-mass equations blank without a mass', () => {
    const rows = rmrEquations({ ...base, ffmKg: null });
    expect(row(rows, 'mifflin').ratio).toBeCloseTo(2000 / 1830, 6);
    for (const key of [
      'katch_mcardle',
      'cunningham_1980',
      'ten_haaf_ffm',
      'tinsley_2019_ffm',
    ]) {
      expect(row(rows, key).predictedKcal).toBeNull();
      expect(row(rows, key).ratio).toBeNull();
      expect(row(rows, key).basis).toBe('ffm');
    }
  });

  it('adds the fat-free-mass equations when a mass is known', () => {
    const rows = rmrEquations({ ...base, ffmKg: 70 });
    expect(row(rows, 'katch_mcardle').predictedKcal).toBeCloseTo(1882, 6);
    expect(row(rows, 'cunningham_1980').predictedKcal).toBeCloseTo(2040, 6);
    expect(row(rows, 'ten_haaf_ffm').predictedKcal).toBeCloseTo(2078.2, 1);
    expect(row(rows, 'tinsley_2019_ffm').predictedKcal).toBeCloseTo(2097, 6);
    expect(row(rows, 'tinsley_2019_ffm').ratio).toBeCloseTo(2000 / 2097, 6);
  });

  it('marks one reference row: Mifflin-St Jeor, or Tinsley on fat-free mass when it is known', () => {
    const primaries = (ffmKg: number | null) =>
      rmrEquations({ ...base, ffmKg })
        .filter((r) => r.primary)
        .map((r) => r.key);
    expect(primaries(null)).toEqual(['mifflin']);
    expect(primaries(70)).toEqual(['tinsley_2019_ffm']);
  });
});

describe('derived figures', () => {
  it('works out the noise band: 2.77 times the device’s 8 per cent CV', () => {
    expect(rmrNoiseBand(2000)).toBeCloseTo(443.2, 6);
    expect(rmrNoiseBand(2000, 5)).toBeCloseTo(277, 6);
  });

  it('divides the measurement by each mass that is known', () => {
    expect(rmrPerKg(2000, 70, 90)).toEqual({
      perKgFfm: 2000 / 70,
      perKgBodyMass: 2000 / 90,
    });
    expect(rmrPerKg(2000, null, 90).perKgFfm).toBeNull();
    expect(rmrPerKg(2000, null, null).perKgBodyMass).toBeNull();
  });

  it('works out the oxygen use the device assumed', () => {
    const vo2 = vo2FromRmr(2000, 4.81, 90);
    // 2000 kcal at 4.81 kcal per litre is about 415.8 litres a day, about 288.8 mL a minute.
    const mlPerMin = ((2000 / 4.81) * 1000) / 1440;
    expect(vo2.litresPerDay).toBeCloseTo(2000 / 4.81, 9);
    expect(vo2.mlPerMin).toBeCloseTo(mlPerMin, 9);
    expect(vo2.mlPerMin).toBeCloseTo(288.75, 1);
    expect(vo2.mets).toBeCloseTo(mlPerMin / 90 / 3.5, 9);
    expect(vo2FromRmr(2000, 4.81, null).mets).toBeNull();
  });

  it('flags a test whose conditions are not all recorded', () => {
    expect(rmrConditionsUnknown(allUnknown)).toBe(true);
    const answered = {
      ...allUnknown,
      fasted: true,
      no_caffeine: true,
      no_training_prior_day: false,
      active_travel: false,
      rested: true,
      illness_free_14d: true,
      awake_quiet: true,
    };
    expect(rmrConditionsUnknown(answered)).toBe(false);
    expect(rmrConditionsUnknown({ ...answered, awake_quiet: null })).toBe(true);
    expect(rmrConditionsUnknown({ ...answered, rested: null })).toBe(true);
  });

  it('puts it together for one test, with the clinic’s activity factor as plain arithmetic', () => {
    const out = analyseMetabolicTest(test({ fat_free_mass_kg: 70 }));
    expect(out.ladder).toHaveLength(8);
    expect(out.noiseBand).toBeCloseTo(443.2, 6);
    expect(out.perKg.perKgFfm).toBeCloseTo(2000 / 70, 6);
    expect(out.vo2?.mlPerMin).toBeCloseTo(288.75, 1);
    expect(out.conditionsUnknown).toBe(true);
    // 2000 x 1.4, rounded: a projection of the clinic's assumption, not a target.
    expect(out.activityProjection).toBe(2800);
    const bare = analyseMetabolicTest(
      test({ kcal_per_litre_o2: null, reported_activity_factor: null })
    );
    expect(bare.vo2).toBeNull();
    expect(bare.activityProjection).toBeNull();
  });
});

describe('a test as entered', () => {
  const valid = {
    tested_day: '2026-10-05',
    method: 'ic_vo2_only',
    measured_rmr_kcal: 1950,
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    weight_kg: 92,
  };
  const parse = (value: unknown) => metabolicTestInputSchema.safeParse(value);

  it('needs only the day, method, measurement and the subject values', () => {
    const out = parse(valid);
    expect(out.success).toBe(true);
    if (!out.success) return;
    expect(out.data.kcal_per_litre_o2).toBeNull();
    expect(out.data.fat_free_mass_kg).toBeNull();
    expect(out.data.prep.fasted).toBeNull();
    expect(out.data.notes).toBeNull();
  });

  it('keeps unanswered conditions as not recorded rather than no', () => {
    const out = parse({ ...valid, prep: { fasted: true, fasting_hours: 12 } });
    expect(out.success && out.data.prep).toMatchObject({
      fasted: true,
      fasting_hours: 12,
      no_caffeine: null,
      rested: null,
    });
  });

  it('refuses values that cannot be right', () => {
    for (const bad of [
      { ...valid, measured_rmr_kcal: 0 },
      { ...valid, measured_rmr_kcal: 20000 },
      { ...valid, tested_day: '2026-02-31' },
      { ...valid, method: 'guess' },
      { ...valid, sex: 'other' },
      { ...valid, height_cm: 90 },
      { ...valid, weight_kg: -1 },
      { ...valid, age_years: 0 },
      { ...valid, rq: 3 },
      { ...valid, fat_free_mass_kg: 95 },
      { ...valid, duration_min: 12.5 },
    ])
      expect(parse(bad).success).toBe(false);
  });

  it('allows a fat-free mass up to the body weight', () => {
    expect(parse({ ...valid, fat_free_mass_kg: 92 }).success).toBe(true);
    expect(parse({ ...valid, fat_free_mass_kg: 70.5 }).success).toBe(true);
  });
});

describe('RMR CSV', () => {
  it('lays out one row per test with a cell for every header and leaves the notes out', () => {
    const rows = metabolicTestExportRows([
      test({
        prep: { ...allUnknown, fasted: true, fasting_hours: 12, rested: false },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(METABOLIC_TEST_EXPORT_HEADERS.length);
    expect(rows[0]).not.toContain('private');
    const cell = (header: (typeof METABOLIC_TEST_EXPORT_HEADERS)[number]) =>
      rows[0]![METABOLIC_TEST_EXPORT_HEADERS.indexOf(header)];
    expect(cell('tested_day')).toBe('2026-10-05');
    expect(cell('measured_rmr_kcal')).toBe(2000);
    expect(cell('prep_fasted')).toBe('true');
    expect(cell('prep_rested')).toBe('false');
    expect(cell('prep_no_caffeine')).toBeNull();
    expect(cell('prep_fasting_hours')).toBe(12);
  });
});
