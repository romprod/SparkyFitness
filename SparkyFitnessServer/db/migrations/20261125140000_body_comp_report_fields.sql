-- What a Hologic report prints beyond the grams: the scan mode, the reference population the
-- scores are taken against, whole-body bone T-score, Z-score and the site's own CV %, and the
-- population percentiles for percentage fat and the three indices (younger adult YN, age-matched
-- AM). Every column is nullable: NULL means the report did not print it. Region percentiles and
-- region bone density live in the regions JSON, which needs no change. Each column is added with
-- IF NOT EXISTS together with its CHECK, so running this again changes nothing.
ALTER TABLE public.body_comp_scans
  ADD COLUMN IF NOT EXISTS scan_mode TEXT CHECK (scan_mode IS NULL OR length(btrim(scan_mode)) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS reference_population TEXT CHECK (reference_population IS NULL OR length(btrim(reference_population)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS bmd_t_score NUMERIC CHECK (bmd_t_score IS NULL OR (bmd_t_score >= -20 AND bmd_t_score <= 20)),
  ADD COLUMN IF NOT EXISTS bmd_z_score NUMERIC CHECK (bmd_z_score IS NULL OR (bmd_z_score >= -20 AND bmd_z_score <= 20)),
  ADD COLUMN IF NOT EXISTS bmd_cv_pct NUMERIC CHECK (bmd_cv_pct IS NULL OR (bmd_cv_pct >= 0 AND bmd_cv_pct <= 100)),
  ADD COLUMN IF NOT EXISTS pct_fat_yn NUMERIC CHECK (pct_fat_yn IS NULL OR (pct_fat_yn >= 0 AND pct_fat_yn <= 100)),
  ADD COLUMN IF NOT EXISTS pct_fat_am NUMERIC CHECK (pct_fat_am IS NULL OR (pct_fat_am >= 0 AND pct_fat_am <= 100)),
  ADD COLUMN IF NOT EXISTS fmi_yn NUMERIC CHECK (fmi_yn IS NULL OR (fmi_yn >= 0 AND fmi_yn <= 100)),
  ADD COLUMN IF NOT EXISTS fmi_am NUMERIC CHECK (fmi_am IS NULL OR (fmi_am >= 0 AND fmi_am <= 100)),
  ADD COLUMN IF NOT EXISTS lmi_yn NUMERIC CHECK (lmi_yn IS NULL OR (lmi_yn >= 0 AND lmi_yn <= 100)),
  ADD COLUMN IF NOT EXISTS lmi_am NUMERIC CHECK (lmi_am IS NULL OR (lmi_am >= 0 AND lmi_am <= 100)),
  ADD COLUMN IF NOT EXISTS almi_yn NUMERIC CHECK (almi_yn IS NULL OR (almi_yn >= 0 AND almi_yn <= 100)),
  ADD COLUMN IF NOT EXISTS almi_am NUMERIC CHECK (almi_am IS NULL OR (almi_am >= 0 AND almi_am <= 100));
