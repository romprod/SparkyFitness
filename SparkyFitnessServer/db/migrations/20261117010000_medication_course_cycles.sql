-- Weekly plans are advisory. Explicit reviewed actions alone commit cycle boundaries.
-- No legacy cadence, medical durations, dose counts or actual provenance are inferred.
ALTER TABLE public.medication_course_revisions
  ADD COLUMN IF NOT EXISTS course_cycle_on_weeks SMALLINT,
  ADD COLUMN IF NOT EXISTS course_cycle_off_weeks SMALLINT,
  ADD COLUMN IF NOT EXISTS course_cycle_anchor_date DATE,
  ADD COLUMN IF NOT EXISTS phase_family_id UUID,
  ADD COLUMN IF NOT EXISTS phase_origin_context JSONB;
ALTER TABLE public.medication_course_revisions DROP CONSTRAINT IF EXISTS medication_course_week_plan_check;
ALTER TABLE public.medication_course_revisions ADD CONSTRAINT medication_course_week_plan_check CHECK (
  (course_cycle_on_weeks IS NULL OR course_cycle_on_weeks BETWEEN 1 AND 104)
  AND (course_cycle_off_weeks IS NULL OR course_cycle_off_weeks BETWEEN 1 AND 104)
  AND (course_cycle_off_weeks IS NULL OR course_cycle_on_weeks IS NOT NULL)
);
ALTER TABLE public.medication_course_revisions DROP CONSTRAINT IF EXISTS medication_course_phase_origin_shape;
ALTER TABLE public.medication_course_revisions ADD CONSTRAINT medication_course_phase_origin_shape CHECK (
  phase_origin_context IS NULL OR (
    jsonb_typeof(phase_origin_context)='object'
    AND phase_origin_context ?& ARRAY['start_date','end_date']
    AND phase_origin_context-'start_date'-'end_date'='{}'::jsonb
    AND jsonb_typeof(phase_origin_context->'start_date')='string'
    AND phase_origin_context->>'start_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND (phase_origin_context->>'start_date')::date::text=phase_origin_context->>'start_date'
    AND (phase_origin_context->'end_date'='null'::jsonb OR (
      jsonb_typeof(phase_origin_context->'end_date')='string'
      AND phase_origin_context->>'end_date' ~ '^\d{4}-\d{2}-\d{2}$'
      AND (phase_origin_context->>'end_date')::date::text=phase_origin_context->>'end_date'
    ))
  )
);
CREATE INDEX IF NOT EXISTS medication_course_phase_family ON public.medication_course_revisions(user_id,course_id,phase_family_id);
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS phase_family_id UUID;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS phase_family_id UUID;
CREATE INDEX IF NOT EXISTS medication_entries_phase_family ON public.medication_entries(user_id,phase_family_id,entry_date) WHERE phase_family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS injection_entries_phase_family ON public.injection_entries(user_id,phase_family_id,entry_date) WHERE phase_family_id IS NOT NULL;
COMMENT ON COLUMN public.medication_course_revisions.phase_family_id IS
  'Immutable server continuation family; NULL means this revision id. Ordinary reviewed revisions start a new family.';
COMMENT ON COLUMN public.medication_course_revisions.phase_origin_context IS
  'Original authored start/end window facts for phase frequency derivation, never a delivered-count or frequency snapshot.';
COMMENT ON COLUMN public.medication_entries.phase_family_id IS
  'Server-derived phase-only provenance retained after matching attribution detaches. Never grants exact-slot credit.';
COMMENT ON COLUMN public.injection_entries.phase_family_id IS
  'Server-derived phase-only provenance retained after matching attribution detaches. Never grants exact-slot credit.';

CREATE OR REPLACE FUNCTION public.check_medication_course_phase_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  parent_family UUID;
  origin_row public.medication_course_revisions%ROWTYPE;
  has_facts BOOLEAN;
  has_continuation BOOLEAN;
  old_window JSONB;
  new_window JSONB;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_course_revisions'
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid course phase definition guard binding'; END IF;
  IF TG_OP='UPDATE' AND NEW.phase_family_id IS DISTINCT FROM OLD.phase_family_id
  THEN RAISE EXCEPTION 'Revision phase family is immutable'; END IF;
  IF NEW.phase_family_id IS NOT NULL THEN
    IF NEW.phase_family_id=NEW.id OR NEW.predecessor_id IS NULL
    THEN RAISE EXCEPTION 'A continuation requires a canonical predecessor family'; END IF;
    SELECT COALESCE(r.phase_family_id,r.id) INTO parent_family
      FROM public.medication_course_revisions r
      WHERE r.id=NEW.predecessor_id AND r.user_id=NEW.user_id AND r.course_id=NEW.course_id;
    IF parent_family IS NULL OR parent_family<>NEW.phase_family_id
    THEN RAISE EXCEPTION 'Continuation family does not belong to this predecessor'; END IF;
    SELECT r.* INTO origin_row FROM public.medication_course_revisions r
      WHERE r.id=NEW.phase_family_id AND r.user_id=NEW.user_id AND r.course_id=NEW.course_id AND r.phase_family_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Continuation phase origin does not belong to this course'; END IF;
    IF origin_row.phase_origin_context IS NULL THEN RAISE EXCEPTION 'Capture the known phase origin window before continuing it'; END IF;
    IF NEW.phase_origin_context IS NOT NULL
    THEN RAISE EXCEPTION 'Continuation phase context belongs to its origin'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.phase_family_id IS NULL AND NEW.phase_origin_context IS NOT NULL
      AND NEW.phase_origin_context IS DISTINCT FROM jsonb_build_object('start_date',NEW.start_date::text,'end_date',NEW.end_date::text)
    THEN RAISE EXCEPTION 'New phase context must match the authored window'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.phase_origin_context IS NOT DISTINCT FROM OLD.phase_origin_context THEN RETURN NEW; END IF;
  IF NEW.phase_family_id IS NOT NULL OR NEW.phase_origin_context IS NULL
  THEN RAISE EXCEPTION 'Captured phase context cannot be cleared or rewritten on a continuation'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.medication_course_revisions r
    WHERE r.user_id=OLD.user_id AND r.course_id=OLD.course_id AND r.phase_family_id=OLD.id)
    INTO has_continuation;
  SELECT EXISTS(
    SELECT 1 FROM public.medication_entries e WHERE e.user_id=OLD.user_id AND e.status IN ('taken','prn_taken')
      AND (e.phase_family_id=OLD.id OR EXISTS(SELECT 1 FROM public.medication_course_revisions r
        WHERE r.id=e.course_revision_id AND r.user_id=OLD.user_id AND r.course_id=OLD.course_id AND COALESCE(r.phase_family_id,r.id)=OLD.id))
    UNION ALL
    SELECT 1 FROM public.injection_entries e WHERE e.user_id=OLD.user_id
      AND (e.phase_family_id=OLD.id OR EXISTS(SELECT 1 FROM public.medication_course_revisions r
        WHERE r.id=e.course_revision_id AND r.user_id=OLD.user_id AND r.course_id=OLD.course_id AND COALESCE(r.phase_family_id,r.id)=OLD.id))
  ) INTO has_facts;
  old_window:=jsonb_build_object('start_date',OLD.start_date::text,'end_date',OLD.end_date::text);
  new_window:=jsonb_build_object('start_date',NEW.start_date::text,'end_date',NEW.end_date::text);
  IF OLD.phase_origin_context IS NULL THEN
    IF (has_facts OR has_continuation) AND NEW.phase_origin_context IS DISTINCT FROM old_window
    THEN RAISE EXCEPTION 'Existing phase context must capture its known original window'; END IF;
    IF NOT (has_facts OR has_continuation) AND NEW.phase_origin_context IS DISTINCT FROM old_window AND NEW.phase_origin_context IS DISTINCT FROM new_window
    THEN RAISE EXCEPTION 'Phase context must match a known authored window'; END IF;
  ELSE
    IF has_facts OR has_continuation OR NEW.phase_origin_context IS DISTINCT FROM new_window
    THEN RAISE EXCEPTION 'Phase history requires an explicit new-family revision'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_course_phase_definition ON public.medication_course_revisions;
CREATE TRIGGER medication_course_phase_definition BEFORE INSERT OR UPDATE ON public.medication_course_revisions
  FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_phase_definition();

CREATE OR REPLACE FUNCTION public.check_medication_course_log_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_family UUID;
  old_family UUID;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('medication_entries','injection_entries')
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid course attribution guard binding'; END IF;
  -- Capture only already-known explicit phase provenance before genuine FK cleanup can return.
  IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    AND NEW.phase_family_id IS NOT DISTINCT FROM OLD.phase_family_id THEN
    IF OLD.phase_family_id IS NULL AND OLD.course_revision_id IS NOT NULL THEN
      SELECT COALESCE(r.phase_family_id,r.id) INTO old_family FROM public.medication_course_revisions r
        WHERE r.id=OLD.course_revision_id AND r.user_id=OLD.user_id;
      NEW.phase_family_id:=old_family;
    END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.course_origin IS TRUE AND NEW.course_origin IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Recorded course origin cannot be cleared';
    END IF;
    IF TG_TABLE_NAME='injection_entries' THEN
      IF NEW.medication_name_snapshot IS DISTINCT FROM OLD.medication_name_snapshot THEN
        RAISE EXCEPTION 'Recorded injection medication name is immutable';
      END IF;
    END IF;
  END IF;
  IF NEW.course_revision_id IS NOT NULL THEN
    -- This is an explicit FK assignment, never a medication/date-based inference.
    NEW.course_origin:=TRUE;
  ELSIF NEW.course_origin IS TRUE AND (TG_OP='INSERT' OR OLD.course_origin IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Initial course origin requires explicit revision attribution';
  END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id
    AND (NEW.course_revision_id IS NOT NULL OR OLD.course_revision_id IS NOT NULL
      OR NEW.course_origin IS TRUE OR OLD.course_origin IS TRUE
      OR NEW.phase_family_id IS NOT NULL OR OLD.phase_family_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Course-attributed dose ownership is immutable'; END IF;
  -- Permit only genuine parent-FK cleanup, including intermediate cascade order.
  -- Physical existence checks run with fixed-path definer visibility, never RLS visibility.
  IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    IF OLD.course_revision_id IS NOT NULL AND NEW.course_revision_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.medication_course_revisions r WHERE r.id=OLD.course_revision_id)
    THEN
      NEW.course_rule_id:=NULL; NEW.course_step_id:=NULL; NEW.course_slot_key:=NULL;
      RETURN NEW;
    END IF;
    IF OLD.course_rule_id IS NOT NULL AND NEW.course_rule_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.medication_course_rules r WHERE r.id=OLD.course_rule_id)
    THEN NEW.course_slot_key:=NULL; END IF;
    IF OLD.medication_id IS NOT NULL AND NEW.medication_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id)
      AND NEW.course_revision_id IS NOT DISTINCT FROM OLD.course_revision_id
      AND NEW.course_rule_id IS NOT DISTINCT FROM OLD.course_rule_id
      AND NEW.course_step_id IS NOT DISTINCT FROM OLD.course_step_id
    THEN RETURN NEW; END IF;
  END IF;
  -- Phase identity is derived only from explicit attribution, independently of slot matching.
  IF NEW.course_revision_id IS NOT NULL THEN
    SELECT COALESCE(r.phase_family_id,r.id) INTO target_family
      FROM public.medication_course_revisions r JOIN public.medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id
      WHERE r.id=NEW.course_revision_id AND r.user_id=NEW.user_id;
    IF target_family IS NULL THEN RAISE EXCEPTION 'Phase attribution does not belong to owner'; END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.phase_family_id IS NOT NULL AND NEW.phase_family_id IS DISTINCT FROM target_family
      THEN RAISE EXCEPTION 'Phase provenance is server derived'; END IF;
    ELSIF NEW.phase_family_id IS DISTINCT FROM OLD.phase_family_id AND NEW.phase_family_id IS DISTINCT FROM target_family
    THEN RAISE EXCEPTION 'Phase provenance must follow explicit attribution'; END IF;
    NEW.phase_family_id:=target_family;
  ELSIF TG_OP='INSERT' THEN
    IF NEW.phase_family_id IS NOT NULL THEN RAISE EXCEPTION 'Initial phase provenance requires explicit attribution'; END IF;
  ELSE
    old_family:=OLD.phase_family_id;
    IF old_family IS NULL AND OLD.course_revision_id IS NOT NULL THEN
      SELECT COALESCE(r.phase_family_id,r.id) INTO old_family FROM public.medication_course_revisions r
        WHERE r.id=OLD.course_revision_id AND r.user_id=OLD.user_id;
    END IF;
    IF NEW.medication_id IS NOT NULL AND NEW.medication_id IS DISTINCT FROM OLD.medication_id THEN
      target_family:=NULL;
    ELSE target_family:=old_family; END IF;
    IF NEW.phase_family_id IS DISTINCT FROM OLD.phase_family_id AND NEW.phase_family_id IS DISTINCT FROM target_family
    THEN RAISE EXCEPTION 'Retained phase provenance is server managed'; END IF;
    NEW.phase_family_id:=target_family;
  END IF;
  IF NEW.course_revision_id IS NULL THEN
    IF NEW.course_rule_id IS NOT NULL OR NEW.course_step_id IS NOT NULL OR NEW.course_slot_key IS NOT NULL THEN
      RAISE EXCEPTION 'Course attribution requires a revision';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medication_course_revisions r JOIN public.medication_courses c
      ON c.id=r.course_id AND c.user_id=r.user_id
    WHERE r.id=NEW.course_revision_id AND r.user_id=NEW.user_id
      AND c.medication_id IS NOT DISTINCT FROM NEW.medication_id
      AND (NEW.course_rule_id IS NULL OR EXISTS(SELECT 1 FROM public.medication_course_rules q
        WHERE q.id=NEW.course_rule_id AND q.revision_id=r.id AND q.user_id=NEW.user_id))
      AND (NEW.course_step_id IS NULL OR EXISTS(SELECT 1 FROM public.medication_course_steps s
        WHERE s.id=NEW.course_step_id AND s.revision_id=r.id AND s.user_id=NEW.user_id))
  ) THEN RAISE EXCEPTION 'Course attribution does not match owner, medication and revision'; END IF;
  IF NEW.course_slot_key IS NOT NULL AND NEW.course_rule_id IS NULL THEN
    RAISE EXCEPTION 'Scheduled course slot requires an authored rule';
  END IF;
  RETURN NEW;
END;
$$;
