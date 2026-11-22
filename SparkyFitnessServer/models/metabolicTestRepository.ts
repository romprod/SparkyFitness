import type { MetabolicTest, NewMetabolicTest } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * Measured RMR tests of the owner. Each is what a clinic's test reported; nothing here is read by
 * any target, goal or forecast.
 */
type Row = Record<string, string | number | boolean | null>;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** pg returns NUMERIC columns as text; the API carries numbers. */
export function toMetabolicTest(row: Row): MetabolicTest {
  return {
    id: String(row['id']),
    tested_day: String(row['tested_day']),
    method: row['method'] as MetabolicTest['method'],
    device_label: (row['device_label'] as string | null) ?? null,
    facility: (row['facility'] as string | null) ?? null,
    measured_rmr_kcal: Number(row['measured_rmr_kcal']),
    kcal_per_litre_o2: num(row['kcal_per_litre_o2']),
    vo2_ml_min: num(row['vo2_ml_min']),
    vco2_ml_min: num(row['vco2_ml_min']),
    rq: num(row['rq']),
    duration_min: num(row['duration_min']),
    steady_state_cv_pct: num(row['steady_state_cv_pct']),
    sex: row['sex'] as MetabolicTest['sex'],
    age_years: Number(row['age_years']),
    height_cm: Number(row['height_cm']),
    weight_kg: Number(row['weight_kg']),
    fat_free_mass_kg: num(row['fat_free_mass_kg']),
    reported_predicted_kcal: num(row['reported_predicted_kcal']),
    reported_prediction_equation:
      (row['reported_prediction_equation'] as string | null) ?? null,
    reported_activity_factor: num(row['reported_activity_factor']),
    reported_activity_label:
      (row['reported_activity_label'] as string | null) ?? null,
    prep: {
      fasted: (row['prep_fasted'] as boolean | null) ?? null,
      fasting_hours: num(row['prep_fasting_hours']),
      no_caffeine: (row['prep_no_caffeine'] as boolean | null) ?? null,
      no_training_prior_day:
        (row['prep_no_training_prior_day'] as boolean | null) ?? null,
      active_travel: (row['prep_active_travel'] as boolean | null) ?? null,
      rested: (row['prep_rested'] as boolean | null) ?? null,
      rest_min_before_test: num(row['prep_rest_min_before_test']),
      illness_free_14d:
        (row['prep_illness_free_14d'] as boolean | null) ?? null,
      awake_quiet: (row['prep_awake_quiet'] as boolean | null) ?? null,
    },
    room_temp_c: num(row['room_temp_c']),
    notes: (row['notes'] as string | null) ?? null,
  };
}

/** Every test of the owner, newest first. */
export async function listMetabolicTests(
  owner: string,
  authenticatedUserId?: string
): Promise<MetabolicTest[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT id, tested_day::text AS tested_day, method, device_label, facility,
              measured_rmr_kcal, kcal_per_litre_o2, vo2_ml_min, vco2_ml_min, rq, duration_min,
              steady_state_cv_pct, sex, age_years, height_cm, weight_kg, fat_free_mass_kg,
              reported_predicted_kcal, reported_prediction_equation, reported_activity_factor,
              reported_activity_label, prep_fasted, prep_fasting_hours, prep_no_caffeine,
              prep_no_training_prior_day, prep_active_travel, prep_rested,
              prep_rest_min_before_test, prep_illness_free_14d, prep_awake_quiet, room_temp_c, notes
         FROM metabolic_tests
        WHERE user_id = $1
        ORDER BY tested_day DESC, created_at DESC`,
      [owner]
    );
    return (rows as Row[]).map(toMetabolicTest);
  } finally {
    client.release();
  }
}

export async function createMetabolicTest(
  owner: string,
  test: NewMetabolicTest,
  authenticatedUserId?: string
): Promise<string> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { prep } = test;
    const { rows } = await client.query(
      `INSERT INTO metabolic_tests (
         user_id, tested_day, method, device_label, facility, measured_rmr_kcal,
         kcal_per_litre_o2, vo2_ml_min, vco2_ml_min, rq, duration_min, steady_state_cv_pct,
         sex, age_years, height_cm, weight_kg, fat_free_mass_kg,
         reported_predicted_kcal, reported_prediction_equation, reported_activity_factor,
         reported_activity_label, prep_fasted, prep_fasting_hours, prep_no_caffeine,
         prep_no_training_prior_day, prep_active_travel, prep_rested, prep_rest_min_before_test,
         prep_illness_free_14d, prep_awake_quiet, room_temp_c, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING id`,
      [
        owner,
        test.tested_day,
        test.method,
        test.device_label,
        test.facility,
        test.measured_rmr_kcal,
        test.kcal_per_litre_o2,
        test.vo2_ml_min,
        test.vco2_ml_min,
        test.rq,
        test.duration_min,
        test.steady_state_cv_pct,
        test.sex,
        test.age_years,
        test.height_cm,
        test.weight_kg,
        test.fat_free_mass_kg,
        test.reported_predicted_kcal,
        test.reported_prediction_equation,
        test.reported_activity_factor,
        test.reported_activity_label,
        prep.fasted,
        // How long fasted only means something when fasted is yes.
        prep.fasted === true ? prep.fasting_hours : null,
        prep.no_caffeine,
        prep.no_training_prior_day,
        prep.active_travel,
        prep.rested,
        prep.rested === true ? prep.rest_min_before_test : null,
        prep.illness_free_14d,
        prep.awake_quiet,
        test.room_temp_c,
        test.notes,
      ]
    );
    return (rows[0] as { id: string }).id;
  } finally {
    client.release();
  }
}

/** Deletes a test of the owner. A test already gone counts as deleted. */
export async function deleteMetabolicTest(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<void> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    await client.query(
      'DELETE FROM metabolic_tests WHERE user_id = $1 AND id = $2',
      [owner, id]
    );
  } finally {
    client.release();
  }
}
