-- Forecast configuration only. No stock, actual doses, history links or old device bindings are inferred.
ALTER TABLE public.medication_course_revisions
  ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES public.medication_syringes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_choice TEXT NOT NULL DEFAULT 'preferred';
ALTER TABLE public.medication_course_revisions DROP CONSTRAINT IF EXISTS medication_course_device_choice_check;
ALTER TABLE public.medication_course_revisions ADD CONSTRAINT medication_course_device_choice_check
  CHECK(device_choice IN ('preferred','explicit') AND (device_choice='explicit' OR device_id IS NULL));
COMMENT ON COLUMN public.medication_course_revisions.device_choice IS
  'Preferred uses the explicitly saved owner default; explicit with a null FK records a deleted selection and must not fall back.';
CREATE INDEX IF NOT EXISTS medication_course_revision_device ON public.medication_course_revisions(device_id) WHERE device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_medication_course_device_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_course_revisions'
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid medication course device scope binding'; END IF;
  IF NEW.device_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medication_syringes s WHERE s.id=NEW.device_id
      AND (s.user_id=NEW.user_id OR s.user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Selected course device is not available to owner'; END IF;
  -- SET NULL on real device deletion deliberately leaves device_choice untouched.
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_course_device_scope ON public.medication_course_revisions;
CREATE TRIGGER medication_course_device_scope BEFORE INSERT OR UPDATE OF device_id,device_choice,user_id
  ON public.medication_course_revisions FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_device_scope();

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS medication_reorder_lead_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS medication_reorder_buffer_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS medication_reorder_lead_days_check;
ALTER TABLE public.user_preferences ADD CONSTRAINT medication_reorder_lead_days_check CHECK(medication_reorder_lead_days>=0);
ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS medication_reorder_buffer_days_check;
ALTER TABLE public.user_preferences ADD CONSTRAINT medication_reorder_buffer_days_check CHECK(medication_reorder_buffer_days>=0);
COMMENT ON COLUMN public.user_preferences.medication_reorder_lead_days IS
  'Owner reorder lead time in whole days. Source default 14; zero is retained. Read-only forecast GET never persists defaults.';
COMMENT ON COLUMN public.user_preferences.medication_reorder_buffer_days IS
  'Owner reorder safety buffer in whole days. Source default 3; zero is retained.';
-- Existing medication-table and owner-write user_preferences RLS policies apply unchanged.
