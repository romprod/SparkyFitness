-- Existing reports remain imported; single-marker manual rows stay ungrouped.
ALTER TABLE public.lab_reports
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.lab_reports DROP CONSTRAINT IF EXISTS lab_reports_origin_check;
ALTER TABLE public.lab_reports ADD CONSTRAINT lab_reports_origin_check CHECK (origin IN ('imported', 'manual'));
COMMENT ON TABLE public.lab_reports IS 'One explicit imported or manually entered lab panel.';
COMMENT ON COLUMN public.lab_results.report_id IS 'Explicit panel membership. NULL for ungrouped manual/FHIR rows. Deleting the panel deletes its results.';
