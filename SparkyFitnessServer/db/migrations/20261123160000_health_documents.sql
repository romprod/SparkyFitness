-- Stored originals: the PDF or photo a record was made from (a lab report, a DEXA report, an RMR
-- report, a prescription), kept as the person uploaded it, so the figures typed in can be checked
-- against the paper. The file itself is on disk under the uploads folder; this row holds what was
-- checked about it (its real type and size, a checksum) and which record it is for. A document can
-- be tied to one DEXA scan or one RMR test and is kept if that record is deleted. The same file
-- is not stored twice.
CREATE TABLE IF NOT EXISTS public.health_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prescription', 'lab_report', 'dexa_report', 'rmr_report', 'other')),
  label TEXT CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 100),
  document_day DATE,
  original_name TEXT NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 200),
  mime TEXT NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_path TEXT NOT NULL CHECK (length(file_path) BETWEEN 1 AND 400),
  body_comp_scan_id UUID REFERENCES public.body_comp_scans(id) ON DELETE SET NULL,
  metabolic_test_id UUID REFERENCES public.metabolic_tests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT health_documents_one_record CHECK (body_comp_scan_id IS NULL OR metabolic_test_id IS NULL),
  CONSTRAINT health_documents_user_sha UNIQUE (user_id, sha256)
);
CREATE INDEX IF NOT EXISTS health_documents_user_created ON public.health_documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS health_documents_scan ON public.health_documents (body_comp_scan_id) WHERE body_comp_scan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS health_documents_test ON public.health_documents (metabolic_test_id) WHERE metabolic_test_id IS NOT NULL;
DROP TRIGGER IF EXISTS set_timestamp ON public.health_documents;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.health_documents
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- A document can only be tied to the owner's own scan or test.
CREATE OR REPLACE FUNCTION public.check_health_document_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body_comp_scan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.body_comp_scans s WHERE s.id = NEW.body_comp_scan_id AND s.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A document can only be linked to the owner''s own scan'; END IF;
  IF NEW.metabolic_test_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.metabolic_tests t WHERE t.id = NEW.metabolic_test_id AND t.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A document can only be linked to the owner''s own test'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS health_document_links ON public.health_documents;
CREATE TRIGGER health_document_links BEFORE INSERT OR UPDATE ON public.health_documents
  FOR EACH ROW EXECUTE FUNCTION public.check_health_document_links();
