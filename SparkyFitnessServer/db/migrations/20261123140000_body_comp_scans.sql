-- DEXA whole-body scans: what a report printed, in grams, with the scanner, the conditions the
-- scan was taken in and, if the report has them, the regions. Indices, change against the
-- scanner's own noise and comparability between scans are recomputed when read, and nothing here
-- is read by any target or goal. Yes/no conditions are three-valued: NULL means not recorded.
-- The regions are a small list always read with the scan, so they are one JSON array of
-- { region, fat_g, lean_g, bmc_g, total_g, pct_fat } checked by the API.
CREATE TABLE IF NOT EXISTS public.body_comp_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  scanned_day DATE NOT NULL,
  device_label TEXT CHECK (device_label IS NULL OR length(btrim(device_label)) BETWEEN 1 AND 100),
  device_serial TEXT CHECK (device_serial IS NULL OR length(btrim(device_serial)) BETWEEN 1 AND 60),
  software_version TEXT CHECK (software_version IS NULL OR length(btrim(software_version)) BETWEEN 1 AND 60),
  facility TEXT CHECK (facility IS NULL OR length(btrim(facility)) BETWEEN 1 AND 100),
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  age_years NUMERIC NOT NULL CHECK (age_years > 0 AND age_years <= 120),
  height_cm NUMERIC NOT NULL CHECK (height_cm >= 100 AND height_cm <= 250),
  clinic_weight_kg NUMERIC CHECK (clinic_weight_kg IS NULL OR (clinic_weight_kg >= 1 AND clinic_weight_kg <= 700)),
  total_fat_g NUMERIC NOT NULL CHECK (total_fat_g >= 0 AND total_fat_g <= 300000),
  total_lean_g NUMERIC NOT NULL CHECK (total_lean_g > 0 AND total_lean_g <= 400000),
  total_bmc_g NUMERIC NOT NULL CHECK (total_bmc_g > 0 AND total_bmc_g <= 20000),
  total_mass_g NUMERIC NOT NULL CHECK (total_mass_g > 0 AND total_mass_g <= 700000),
  pct_fat NUMERIC NOT NULL CHECK (pct_fat >= 0 AND pct_fat <= 100),
  vat_mass_g NUMERIC CHECK (vat_mass_g IS NULL OR (vat_mass_g >= 0 AND vat_mass_g <= 20000)),
  vat_volume_cm3 NUMERIC CHECK (vat_volume_cm3 IS NULL OR (vat_volume_cm3 >= 0 AND vat_volume_cm3 <= 30000)),
  vat_area_cm2 NUMERIC CHECK (vat_area_cm2 IS NULL OR (vat_area_cm2 >= 0 AND vat_area_cm2 <= 2000)),
  total_bmd_gcm2 NUMERIC CHECK (total_bmd_gcm2 IS NULL OR (total_bmd_gcm2 >= 0.2 AND total_bmd_gcm2 <= 3)),
  prep_fasted BOOLEAN,
  prep_fasting_hours NUMERIC CHECK (prep_fasting_hours IS NULL OR (prep_fasting_hours >= 0 AND prep_fasting_hours <= 72)),
  prep_no_caffeine BOOLEAN,
  prep_no_training_prior_day BOOLEAN,
  prep_active_travel BOOLEAN,
  prep_euhydrated_voided BOOLEAN,
  prep_illness_free_14d BOOLEAN,
  creatine_status TEXT CHECK (creatine_status IS NULL OR creatine_status IN ('stable', 'started', 'stopped', 'none')),
  carb_pattern_48h TEXT CHECK (carb_pattern_48h IS NULL OR carb_pattern_48h IN ('normal', 'loaded', 'depleted')),
  regions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(regions) = 'array' AND jsonb_array_length(regions) <= 8),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT body_comp_scans_fat_within_mass CHECK (total_fat_g <= total_mass_g)
);
CREATE INDEX IF NOT EXISTS body_comp_scans_user_day ON public.body_comp_scans (user_id, scanned_day);
DROP TRIGGER IF EXISTS set_timestamp ON public.body_comp_scans;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.body_comp_scans
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
