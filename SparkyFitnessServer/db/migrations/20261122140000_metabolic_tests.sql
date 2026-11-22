-- Measured resting metabolic rate (RMR) tests: what a clinic's indirect-calorimetry test
-- printed, the values the clinic fed its prediction equation, and the conditions of the test.
-- The prediction equations are recomputed when read and no target is ever derived from the
-- clinic's own figures, so only what was measured and printed is stored. The yes/no conditions
-- are three-valued: NULL means not recorded.
CREATE TABLE IF NOT EXISTS public.metabolic_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  tested_day DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('ic_vo2_only', 'ic_vo2_vco2', 'other')),
  device_label TEXT CHECK (device_label IS NULL OR length(btrim(device_label)) BETWEEN 1 AND 100),
  facility TEXT CHECK (facility IS NULL OR length(btrim(facility)) BETWEEN 1 AND 100),
  measured_rmr_kcal NUMERIC NOT NULL CHECK (measured_rmr_kcal > 0 AND measured_rmr_kcal <= 10000),
  kcal_per_litre_o2 NUMERIC CHECK (kcal_per_litre_o2 IS NULL OR (kcal_per_litre_o2 > 0 AND kcal_per_litre_o2 <= 10)),
  vo2_ml_min NUMERIC CHECK (vo2_ml_min IS NULL OR vo2_ml_min > 0),
  vco2_ml_min NUMERIC CHECK (vco2_ml_min IS NULL OR vco2_ml_min > 0),
  rq NUMERIC CHECK (rq IS NULL OR (rq > 0 AND rq <= 2)),
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  steady_state_cv_pct NUMERIC CHECK (steady_state_cv_pct IS NULL OR steady_state_cv_pct >= 0),
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  age_years NUMERIC NOT NULL CHECK (age_years > 0 AND age_years <= 120),
  height_cm NUMERIC NOT NULL CHECK (height_cm >= 100 AND height_cm <= 250),
  weight_kg NUMERIC NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 700),
  fat_free_mass_kg NUMERIC CHECK (fat_free_mass_kg IS NULL OR (fat_free_mass_kg > 0 AND fat_free_mass_kg <= weight_kg)),
  reported_predicted_kcal NUMERIC CHECK (reported_predicted_kcal IS NULL OR reported_predicted_kcal > 0),
  reported_prediction_equation TEXT CHECK (reported_prediction_equation IS NULL OR length(btrim(reported_prediction_equation)) BETWEEN 1 AND 60),
  reported_activity_factor NUMERIC CHECK (reported_activity_factor IS NULL OR reported_activity_factor > 0),
  reported_activity_label TEXT CHECK (reported_activity_label IS NULL OR length(btrim(reported_activity_label)) BETWEEN 1 AND 40),
  prep_fasted BOOLEAN,
  prep_fasting_hours NUMERIC CHECK (prep_fasting_hours IS NULL OR prep_fasting_hours >= 0),
  prep_no_caffeine BOOLEAN,
  prep_no_training_prior_day BOOLEAN,
  prep_active_travel BOOLEAN,
  prep_rested BOOLEAN,
  prep_rest_min_before_test INTEGER CHECK (prep_rest_min_before_test IS NULL OR prep_rest_min_before_test >= 0),
  prep_illness_free_14d BOOLEAN,
  prep_awake_quiet BOOLEAN,
  room_temp_c NUMERIC CHECK (room_temp_c IS NULL OR (room_temp_c > -50 AND room_temp_c < 60)),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metabolic_tests_user_day ON public.metabolic_tests (user_id, tested_day);
DROP TRIGGER IF EXISTS set_timestamp ON public.metabolic_tests;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.metabolic_tests
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
