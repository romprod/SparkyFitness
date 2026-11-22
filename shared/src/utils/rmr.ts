import type {
  MetabolicTest,
  MetabolicTestPrep,
} from '../schemas/api/MetabolicTests.api.zod.ts';
import type { CsvCell } from './csv.ts';

/**
 * Measured resting metabolic rate beside the usual prediction equations, as Pitstop's RMR panel
 * shows it. Every equation is recomputed from the subject values, and the clinic's own predicted
 * figure and activity factor are shown as printed, never used to set a target. All of it is
 * descriptive: how far a measurement sits from each equation, not what to eat.
 */

/** Typical coefficient of variation of a VO2-only device, in per cent (Pitstop's default). */
export const RMR_DEFAULT_CV_PCT = 8;
/** 2.77 = 1.96 x sqrt(2): the smallest change between two measurements that exceeds their noise. */
export const RMR_LSC_K = 2.77;

/** The least significant change: a difference between two tests smaller than this is within noise. */
export function rmrNoiseBand(
  rmrKcal: number,
  cvPct: number = RMR_DEFAULT_CV_PCT
): number {
  return ((rmrKcal * cvPct) / 100) * RMR_LSC_K;
}

export interface RmrInputs {
  rmrKcal: number;
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** Fat-free mass in kilograms, or null when no body scan gave one. */
  ffmKg: number | null;
}
export interface RmrEquationRow {
  key: string;
  label: string;
  basis: 'weight' | 'ffm';
  /** Null when the equation needs a fat-free mass that is not known. */
  predictedKcal: number | null;
  /** Measured divided by predicted. */
  ratio: number | null;
  /** The reference row: the scan-matched equation when a fat-free mass is known, else Mifflin-St Jeor. */
  primary: boolean;
  note: string;
}

export function rmrEquations(input: RmrInputs): RmrEquationRow[] {
  const { sex, ageYears: a, heightCm: h, weightKg: w, ffmKg: f } = input;
  const hm = h / 100;
  const male = sex === 'male';
  const rows: Omit<RmrEquationRow, 'ratio' | 'primary'>[] = [
    {
      key: 'mifflin',
      label: 'Mifflin-St Jeor (1990)',
      basis: 'weight',
      predictedKcal: 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161),
      note: 'General population; under-predicts trained subjects.',
    },
    {
      key: 'harris_benedict_roza',
      label: 'Harris-Benedict (Roza 1984)',
      basis: 'weight',
      predictedKcal: male
        ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a
        : 447.593 + 9.247 * w + 3.098 * h - 4.33 * a,
      note: 'Basal, not resting.',
    },
    {
      key: 'ten_haaf_weight',
      label: 'ten Haaf & Weijs 2014 (weight)',
      basis: 'weight',
      predictedKcal:
        (49.94 * w +
          2459.053 * hm -
          34.014 * a +
          799.257 * (male ? 1 : 0) +
          122.502) /
        4.184,
      note: 'Recreational athletes.',
    },
    {
      key: 'tinsley_2019_weight',
      label: 'Tinsley 2019 (weight)',
      basis: 'weight',
      predictedKcal: 24.8 * w + 10,
      note: 'Muscular athletes.',
    },
    {
      key: 'katch_mcardle',
      label: 'Katch-McArdle / Cunningham 1991',
      basis: 'ffm',
      predictedKcal: f === null ? null : 370 + 21.6 * f,
      note: 'Lowest intercept; sits about 155 kcal under Cunningham 1980.',
    },
    {
      key: 'cunningham_1980',
      label: 'Cunningham 1980',
      basis: 'ffm',
      predictedKcal: f === null ? null : 500 + 22 * f,
      note: 'Basal; re-analysis of Harris-Benedict data.',
    },
    {
      key: 'ten_haaf_ffm',
      label: 'ten Haaf & Weijs 2014 (FFM)',
      basis: 'ffm',
      predictedKcal: f === null ? null : (95.272 * f + 2026.161) / 4.184,
      note: 'Fat-free mass by air-displacement plethysmography.',
    },
    {
      key: 'tinsley_2019_ffm',
      label: 'Tinsley 2019 (FFM)',
      basis: 'ffm',
      predictedKcal: f === null ? null : 25.9 * f + 284,
      note: 'Fat-free mass by DXA, the method-matched reference.',
    },
  ];
  const primaryKey = f === null ? 'mifflin' : 'tinsley_2019_ffm';
  return rows.map((row) => ({
    ...row,
    ratio: row.predictedKcal ? input.rmrKcal / row.predictedKcal : null,
    primary: row.key === primaryKey,
  }));
}

/** Measured RMR per kilogram of fat-free mass and of body mass; each null when its mass is unknown. */
export function rmrPerKg(
  rmrKcal: number,
  ffmKg: number | null,
  bodyMassKg: number | null
): { perKgFfm: number | null; perKgBodyMass: number | null } {
  return {
    perKgFfm: ffmKg ? rmrKcal / ffmKg : null,
    perKgBodyMass: bodyMassKg ? rmrKcal / bodyMassKg : null,
  };
}

/** The oxygen use implied by a measured RMR and the kcal per litre of O2 the device assumed. */
export function vo2FromRmr(
  rmrKcal: number,
  kcalPerLitreO2: number,
  weightKg: number | null
): { litresPerDay: number; mlPerMin: number; mets: number | null } {
  const litresPerDay = rmrKcal / kcalPerLitreO2;
  const mlPerMin = (litresPerDay * 1000) / 1440;
  return {
    litresPerDay,
    mlPerMin,
    mets: weightKg ? mlPerMin / weightKg / 3.5 : null,
  };
}

/** True when any condition of the test is not recorded, which the panel flags. */
export function rmrConditionsUnknown(prep: MetabolicTestPrep): boolean {
  return [
    prep.fasted,
    prep.no_caffeine,
    prep.no_training_prior_day,
    prep.active_travel,
    prep.illness_free_14d,
    prep.awake_quiet,
    prep.rested,
  ].some((answer) => answer === null);
}

export interface RmrAnalysis {
  ladder: RmrEquationRow[];
  perKg: ReturnType<typeof rmrPerKg>;
  /** From the kcal per litre of O2, when the device printed it. */
  vo2: ReturnType<typeof vo2FromRmr> | null;
  noiseBand: number;
  conditionsUnknown: boolean;
  /**
   * The measured RMR times the clinic's own activity factor, as plain arithmetic on the clinic's
   * assumption. It is not a target and nothing else uses it.
   */
  activityProjection: number | null;
}

export function analyseMetabolicTest(test: MetabolicTest): RmrAnalysis {
  return {
    ladder: rmrEquations({
      rmrKcal: test.measured_rmr_kcal,
      sex: test.sex,
      ageYears: test.age_years,
      heightCm: test.height_cm,
      weightKg: test.weight_kg,
      ffmKg: test.fat_free_mass_kg,
    }),
    perKg: rmrPerKg(
      test.measured_rmr_kcal,
      test.fat_free_mass_kg,
      test.weight_kg
    ),
    vo2: test.kcal_per_litre_o2
      ? vo2FromRmr(
          test.measured_rmr_kcal,
          test.kcal_per_litre_o2,
          test.weight_kg
        )
      : null,
    noiseBand: rmrNoiseBand(test.measured_rmr_kcal),
    conditionsUnknown: rmrConditionsUnknown(test.prep),
    activityProjection:
      test.reported_activity_factor === null
        ? null
        : Math.round(test.measured_rmr_kcal * test.reported_activity_factor),
  };
}

export const METABOLIC_TEST_EXPORT_HEADERS = [
  'tested_day',
  'method',
  'device',
  'facility',
  'measured_rmr_kcal',
  'kcal_per_litre_o2',
  'vo2_ml_min',
  'vco2_ml_min',
  'rq',
  'duration_min',
  'steady_state_cv_pct',
  'sex',
  'age_years',
  'height_cm',
  'weight_kg',
  'fat_free_mass_kg',
  'reported_predicted_kcal',
  'reported_prediction_equation',
  'reported_activity_factor',
  'reported_activity_label',
  'prep_fasted',
  'prep_fasting_hours',
  'prep_no_caffeine',
  'prep_no_training_prior_day',
  'prep_active_travel',
  'prep_rest_min_before_test',
  'prep_rested',
  'prep_illness_free_14d',
  'prep_awake_quiet',
  'room_temp_c',
] as const;

const triCell = (answer: boolean | null): CsvCell =>
  answer === null ? null : answer ? 'true' : 'false';

/** Rows for the RMR CSV: every test, newest first, as the clinic reported it. The notes are not included. */
export function metabolicTestExportRows(
  tests: readonly MetabolicTest[]
): CsvCell[][] {
  return tests.map((t) => [
    t.tested_day,
    t.method,
    t.device_label,
    t.facility,
    t.measured_rmr_kcal,
    t.kcal_per_litre_o2,
    t.vo2_ml_min,
    t.vco2_ml_min,
    t.rq,
    t.duration_min,
    t.steady_state_cv_pct,
    t.sex,
    t.age_years,
    t.height_cm,
    t.weight_kg,
    t.fat_free_mass_kg,
    t.reported_predicted_kcal,
    t.reported_prediction_equation,
    t.reported_activity_factor,
    t.reported_activity_label,
    triCell(t.prep.fasted),
    t.prep.fasting_hours,
    triCell(t.prep.no_caffeine),
    triCell(t.prep.no_training_prior_day),
    triCell(t.prep.active_travel),
    t.prep.rest_min_before_test,
    triCell(t.prep.rested),
    triCell(t.prep.illness_free_14d),
    triCell(t.prep.awake_quiet),
    t.room_temp_c,
  ]);
}
