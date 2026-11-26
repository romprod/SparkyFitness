-- Garmin ECG recordings, read from the PDF Garmin Connect exports. Garmin's own words (result,
-- symptoms, interpretation, lead note) are stored as printed. The page's name, date of birth, age
-- and sex are never read and have no column. The page prints a wall clock with no zone, so the
-- clock is the recording's identity (recorded_local_key, one row per printed minute per person);
-- recorded_at is that clock read in the person's time zone (tz) when it was imported, and
-- local_day is its day there. The trace is one JSON object of strips (about 128 Hz as drawn in
-- the PDF) kept with the row and left out of lists.
CREATE TABLE IF NOT EXISTS public.ecg_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  recorded_local_key TEXT NOT NULL CHECK (recorded_local_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  local_day DATE NOT NULL,
  tz TEXT NOT NULL CHECK (length(btrim(tz)) BETWEEN 1 AND 64),
  result TEXT NOT NULL CHECK (length(btrim(result)) BETWEEN 1 AND 500),
  avg_heart_rate_bpm INTEGER CHECK (avg_heart_rate_bpm IS NULL OR (avg_heart_rate_bpm >= 20 AND avg_heart_rate_bpm <= 300)),
  symptoms TEXT CHECK (symptoms IS NULL OR length(btrim(symptoms)) BETWEEN 1 AND 2000),
  interpretation TEXT CHECK (interpretation IS NULL OR length(btrim(interpretation)) BETWEEN 1 AND 2000),
  lead_note TEXT CHECK (lead_note IS NULL OR length(btrim(lead_note)) BETWEEN 1 AND 500),
  duration_sec INTEGER CHECK (duration_sec IS NULL OR (duration_sec >= 1 AND duration_sec <= 3600)),
  paper_speed_mm_s NUMERIC CHECK (paper_speed_mm_s IS NULL OR (paper_speed_mm_s > 0 AND paper_speed_mm_s <= 500)),
  gain_mm_mv NUMERIC CHECK (gain_mm_mv IS NULL OR (gain_mm_mv > 0 AND gain_mm_mv <= 200)),
  sample_rate_hz INTEGER CHECK (sample_rate_hz IS NULL OR (sample_rate_hz >= 1 AND sample_rate_hz <= 10000)),
  device_model TEXT CHECK (device_model IS NULL OR length(btrim(device_model)) BETWEEN 1 AND 200),
  device_software TEXT CHECK (device_software IS NULL OR length(btrim(device_software)) BETWEEN 1 AND 100),
  ecg_app_version TEXT CHECK (ecg_app_version IS NULL OR length(btrim(ecg_app_version)) BETWEEN 1 AND 100),
  connect_web_version TEXT CHECK (connect_web_version IS NULL OR length(btrim(connect_web_version)) BETWEEN 1 AND 100),
  pdf_template_version TEXT CHECK (pdf_template_version IS NULL OR length(btrim(pdf_template_version)) BETWEEN 1 AND 100),
  backend_version TEXT CHECK (backend_version IS NULL OR length(btrim(backend_version)) BETWEEN 1 AND 100),
  waveform JSONB CHECK (waveform IS NULL OR jsonb_typeof(waveform) = 'object'),
  waveform_points INTEGER CHECK (waveform_points IS NULL OR waveform_points >= 0),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ecg_recordings_user_local_key UNIQUE (user_id, recorded_local_key)
);
CREATE INDEX IF NOT EXISTS ecg_recordings_user_recorded ON public.ecg_recordings (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ecg_recordings_user_hash ON public.ecg_recordings (user_id, source_hash);
DROP TRIGGER IF EXISTS set_timestamp ON public.ecg_recordings;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.ecg_recordings
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Stored originals may now be an ECG report, tied to at most one recording. The kind check was
-- written inline, so Postgres named it health_documents_kind_check.
ALTER TABLE public.health_documents DROP CONSTRAINT IF EXISTS health_documents_kind_check;
ALTER TABLE public.health_documents ADD CONSTRAINT health_documents_kind_check
  CHECK (kind IN ('prescription', 'lab_report', 'dexa_report', 'rmr_report', 'ecg_report', 'other'));

ALTER TABLE public.health_documents
  ADD COLUMN IF NOT EXISTS ecg_recording_id UUID REFERENCES public.ecg_recordings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS health_documents_ecg ON public.health_documents (ecg_recording_id) WHERE ecg_recording_id IS NOT NULL;

ALTER TABLE public.health_documents DROP CONSTRAINT IF EXISTS health_documents_one_record;
ALTER TABLE public.health_documents ADD CONSTRAINT health_documents_one_record
  CHECK (num_nonnulls(body_comp_scan_id, metabolic_test_id, ecg_recording_id) <= 1);

-- A document can only be tied to the owner's own scan, test or recording.
CREATE OR REPLACE FUNCTION public.check_health_document_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body_comp_scan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.body_comp_scans s WHERE s.id = NEW.body_comp_scan_id AND s.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A document can only be linked to the owner''s own scan'; END IF;
  IF NEW.metabolic_test_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.metabolic_tests t WHERE t.id = NEW.metabolic_test_id AND t.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A document can only be linked to the owner''s own test'; END IF;
  IF NEW.ecg_recording_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ecg_recordings e WHERE e.id = NEW.ecg_recording_id AND e.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A document can only be linked to the owner''s own ECG recording'; END IF;
  RETURN NEW;
END;
$$;
