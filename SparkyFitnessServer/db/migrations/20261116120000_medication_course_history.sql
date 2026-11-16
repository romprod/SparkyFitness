-- Opt-in authored courses only. No legacy plans or actual doses are inferred/backfilled.
CREATE TABLE IF NOT EXISTS public.medication_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
  medication_name_snapshot TEXT NOT NULL,
  current_revision_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capture_day DATE NOT NULL,
  timezone TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.medication_course_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  course_id UUID NOT NULL,
  predecessor_id UUID,
  revision_no INTEGER NOT NULL CHECK(revision_no>0),
  name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
  start_date DATE NOT NULL,
  end_date DATE,
  closed_date DATE,
  cycle_anchor_date DATE,
  target_dose NUMERIC CHECK(target_dose>0 AND target_dose::text NOT IN ('NaN','Infinity','-Infinity')),
  dose_unit TEXT NOT NULL,
  dose_basis TEXT NOT NULL DEFAULT 'per_injection' CHECK(dose_basis IN ('per_injection','per_week')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(id,user_id),
  UNIQUE(id,course_id,user_id),
  UNIQUE(course_id,revision_no),
  FOREIGN KEY(course_id,user_id) REFERENCES public.medication_courses(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(predecessor_id,course_id,user_id) REFERENCES public.medication_course_revisions(id,course_id,user_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX IF NOT EXISTS medication_course_one_successor ON public.medication_course_revisions(predecessor_id) WHERE predecessor_id IS NOT NULL;
ALTER TABLE public.medication_courses DROP CONSTRAINT IF EXISTS medication_course_tip_scope;
ALTER TABLE public.medication_courses ADD CONSTRAINT medication_course_tip_scope
  FOREIGN KEY(current_revision_id,id,user_id) REFERENCES public.medication_course_revisions(id,course_id,user_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS medication_courses_owner_medication ON public.medication_courses(user_id,medication_id);
CREATE INDEX IF NOT EXISTS medication_course_revisions_parent ON public.medication_course_revisions(course_id,revision_no);

CREATE TABLE IF NOT EXISTS public.medication_course_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL,
  rule_index INTEGER NOT NULL CHECK(rule_index>=0),
  schedule_type_id VARCHAR(50) NOT NULL REFERENCES public.medication_schedule_types(id),
  time_of_day TIME,
  dose_amount NUMERIC CHECK(dose_amount>0 AND dose_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  days_of_week INTEGER[],
  interval_days INTEGER CHECK(interval_days>0),
  day_of_month INTEGER CHECK(day_of_month BETWEEN 1 AND 31),
  cycle_on_days INTEGER CHECK(cycle_on_days>0),
  cycle_off_days INTEGER CHECK(cycle_off_days>=0),
  with_meal TEXT CHECK(with_meal IN ('before','with','after','away_from_meals')),
  prn_reason TEXT,
  prn_max_per_day INTEGER CHECK(prn_max_per_day>0),
  start_date DATE,
  end_date DATE,
  anchor_date DATE,
  UNIQUE(id,user_id),
  UNIQUE(id,revision_id,user_id),
  UNIQUE(revision_id,rule_index),
  FOREIGN KEY(revision_id,user_id) REFERENCES public.medication_course_revisions(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.medication_course_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index>=0),
  dose NUMERIC NOT NULL CHECK(dose>0 AND dose::text NOT IN ('NaN','Infinity','-Infinity')),
  dose_unit TEXT NOT NULL,
  duration_days INTEGER CHECK(duration_days>=0),
  notes TEXT,
  UNIQUE(id,user_id),
  UNIQUE(id,revision_id,user_id),
  UNIQUE(revision_id,step_index),
  FOREIGN KEY(revision_id,user_id) REFERENCES public.medication_course_revisions(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.medication_course_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  revision_id UUID NOT NULL,
  from_at TIMESTAMPTZ NOT NULL,
  until_at TIMESTAMPTZ,
  CHECK(until_at IS NULL OR until_at>=from_at),
  UNIQUE(id,user_id),
  FOREIGN KEY(revision_id,user_id) REFERENCES public.medication_course_revisions(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS medication_course_one_open_activity ON public.medication_course_activity(revision_id) WHERE until_at IS NULL;
CREATE INDEX IF NOT EXISTS medication_course_activity_window ON public.medication_course_activity(revision_id,from_at,until_at);
CREATE TABLE IF NOT EXISTS public.medication_course_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  course_id UUID NOT NULL,
  revision_id UUID NOT NULL,
  schedule_id UUID REFERENCES public.medication_schedules(id) ON DELETE SET NULL,
  original_schedule_id UUID NOT NULL,
  original_rule JSONB NOT NULL CHECK(jsonb_typeof(original_rule)='object'),
  original_fingerprint TEXT NOT NULL,
  cutover_day DATE NOT NULL,
  capped_end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,user_id),
  UNIQUE(user_id,original_schedule_id),
  FOREIGN KEY(course_id,user_id) REFERENCES public.medication_courses(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id,course_id,user_id) REFERENCES public.medication_course_revisions(id,course_id,user_id) ON DELETE CASCADE,
  CHECK(capped_end_date<cutover_day)
);
CREATE TABLE IF NOT EXISTS public.medication_course_operations (
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  course_id UUID NOT NULL,
  action TEXT NOT NULL,
  result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,operation_id)
);
-- Receipts deliberately outlive deleted/tombstoned courses, preventing resurrection on retry.
CREATE INDEX IF NOT EXISTS medication_course_operation_course ON public.medication_course_operations(user_id,course_id);

-- Forward-only provenance: NULL legacy rows stay unknown; never infer old course links.
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS course_origin BOOLEAN;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS course_origin BOOLEAN;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS medication_name_snapshot TEXT;
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS course_revision_id UUID REFERENCES public.medication_course_revisions(id) ON DELETE SET NULL;
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS course_rule_id UUID REFERENCES public.medication_course_rules(id) ON DELETE SET NULL;
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS course_step_id UUID REFERENCES public.medication_course_steps(id) ON DELETE SET NULL;
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS scheduled_day DATE;
ALTER TABLE public.medication_entries ADD COLUMN IF NOT EXISTS course_slot_key TEXT;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS course_revision_id UUID REFERENCES public.medication_course_revisions(id) ON DELETE SET NULL;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS course_rule_id UUID REFERENCES public.medication_course_rules(id) ON DELETE SET NULL;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS course_step_id UUID REFERENCES public.medication_course_steps(id) ON DELETE SET NULL;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS scheduled_day DATE;
ALTER TABLE public.injection_entries ADD COLUMN IF NOT EXISTS course_slot_key TEXT;
CREATE INDEX IF NOT EXISTS medication_entries_course_revision ON public.medication_entries(user_id,course_revision_id,entry_date);
CREATE INDEX IF NOT EXISTS injection_entries_course_revision ON public.injection_entries(user_id,course_revision_id,entry_date);
-- No uniqueness constraint across actual doses: multiple authored slots and explicit off-schedule logs remain valid.

CREATE OR REPLACE FUNCTION public.check_medication_course_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW'
    OR TG_OP NOT IN ('INSERT','UPDATE') OR TG_TABLE_NAME NOT IN ('medication_courses','medication_course_handoffs')
  THEN RAISE EXCEPTION 'Invalid medication course scope binding'; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Course ownership is immutable';
  END IF;
  IF TG_TABLE_NAME='medication_courses' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.capture_day IS DISTINCT FROM OLD.capture_day
        OR NEW.timezone IS DISTINCT FROM OLD.timezone
      THEN RAISE EXCEPTION 'Course capture baseline is immutable'; END IF;
      IF NEW.medication_id IS DISTINCT FROM OLD.medication_id AND NOT (
        pg_trigger_depth()>1 AND NEW.medication_id IS NULL AND OLD.medication_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id)
      ) THEN RAISE EXCEPTION 'Course medication identity is immutable'; END IF;
    END IF;
    IF NEW.medication_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.medications m WHERE m.id=NEW.medication_id AND m.user_id=NEW.user_id
    ) THEN RAISE EXCEPTION 'Course medication does not belong to owner'; END IF;
  ELSE
    IF TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-'schedule_id') IS DISTINCT FROM (to_jsonb(OLD)-'schedule_id')
        OR (NEW.schedule_id IS DISTINCT FROM OLD.schedule_id AND NOT (
          pg_trigger_depth()>1 AND NEW.schedule_id IS NULL AND OLD.schedule_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM public.medication_schedules s WHERE s.id=OLD.schedule_id)
        ))
      THEN RAISE EXCEPTION 'Course handoff provenance is immutable'; END IF;
    END IF;
    IF NEW.schedule_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.medication_schedules s JOIN public.medication_courses c
        ON c.id=NEW.course_id AND c.user_id=s.user_id AND c.medication_id=s.medication_id
      WHERE s.id=NEW.schedule_id AND s.user_id=NEW.user_id AND s.id=NEW.original_schedule_id
    ) THEN RAISE EXCEPTION 'Course handoff schedule does not match owner and medication'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_course_scope ON public.medication_courses;
CREATE TRIGGER medication_course_scope BEFORE INSERT OR UPDATE ON public.medication_courses FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_scope();
DROP TRIGGER IF EXISTS medication_course_handoff_scope ON public.medication_course_handoffs;
CREATE TRIGGER medication_course_handoff_scope BEFORE INSERT OR UPDATE ON public.medication_course_handoffs FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_scope();

CREATE OR REPLACE FUNCTION public.check_medication_course_log_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('medication_entries','injection_entries')
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid course attribution guard binding'; END IF;
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
      OR NEW.course_origin IS TRUE OR OLD.course_origin IS TRUE)
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
DROP TRIGGER IF EXISTS medication_entry_course_scope ON public.medication_entries;
CREATE TRIGGER medication_entry_course_scope BEFORE INSERT OR UPDATE ON public.medication_entries FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_log_scope();
DROP TRIGGER IF EXISTS injection_course_scope ON public.injection_entries;
CREATE TRIGGER injection_course_scope BEFORE INSERT OR UPDATE ON public.injection_entries FOR EACH ROW EXECUTE FUNCTION public.check_medication_course_log_scope();

CREATE OR REPLACE FUNCTION public.protect_medication_course_handoff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_schedules' OR TG_WHEN<>'BEFORE'
    OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('UPDATE','DELETE')
  THEN RAISE EXCEPTION 'Invalid course handoff guard binding'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.medication_course_handoffs h WHERE h.schedule_id=OLD.id AND h.user_id=OLD.user_id)
      AND EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id)
      AND EXISTS(SELECT 1 FROM public."user" u WHERE u.id=OLD.user_id)
    THEN RAISE EXCEPTION 'This handed-off legacy rule is retained for course history'; END IF;
    RETURN OLD;
  END IF;
  IF EXISTS(SELECT 1 FROM public.medication_course_handoffs h WHERE h.schedule_id=OLD.id AND h.user_id=OLD.user_id) THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.medication_id IS DISTINCT FROM OLD.medication_id
      OR NEW.schedule_type_id IS DISTINCT FROM OLD.schedule_type_id OR NEW.time_of_day IS DISTINCT FROM OLD.time_of_day
      OR NEW.dose_amount IS DISTINCT FROM OLD.dose_amount OR NEW.days_of_week IS DISTINCT FROM OLD.days_of_week
      OR NEW.interval_days IS DISTINCT FROM OLD.interval_days OR NEW.day_of_month IS DISTINCT FROM OLD.day_of_month
      OR NEW.cycle_on_days IS DISTINCT FROM OLD.cycle_on_days OR NEW.cycle_off_days IS DISTINCT FROM OLD.cycle_off_days
      OR NEW.with_meal IS DISTINCT FROM OLD.with_meal OR NEW.prn_reason IS DISTINCT FROM OLD.prn_reason
      OR NEW.prn_max_per_day IS DISTINCT FROM OLD.prn_max_per_day OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.active IS DISTINCT FROM OLD.active
      OR EXISTS(SELECT 1 FROM public.medication_course_handoffs h WHERE h.schedule_id=OLD.id
        AND (NEW.end_date IS NULL OR NEW.end_date>h.capped_end_date))
    THEN RAISE EXCEPTION 'This legacy rule was handed over to a course; its authored history and end cap are retained'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_schedule_handoff_cap ON public.medication_schedules;
CREATE TRIGGER medication_schedule_handoff_cap BEFORE UPDATE OR DELETE ON public.medication_schedules FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_handoff();

CREATE OR REPLACE FUNCTION public.protect_medication_course_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_course_operations' OR TG_WHEN<>'BEFORE'
    OR TG_LEVEL<>'ROW' OR TG_OP<>'UPDATE'
  THEN RAISE EXCEPTION 'Invalid course operation guard binding'; END IF;
  RAISE EXCEPTION 'Course operation receipts are immutable';
END;
$$;
DROP TRIGGER IF EXISTS medication_course_operation_immutable ON public.medication_course_operations;
CREATE TRIGGER medication_course_operation_immutable BEFORE UPDATE ON public.medication_course_operations FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_receipt();

CREATE OR REPLACE FUNCTION public.protect_medication_course_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP<>'UPDATE'
    OR TG_TABLE_NAME NOT IN ('medication_course_revisions','medication_course_rules','medication_course_steps','medication_course_activity')
  THEN RAISE EXCEPTION 'Invalid course identity guard binding'; END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Course child ownership is immutable'; END IF;
  IF TG_TABLE_NAME='medication_course_revisions' THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.predecessor_id IS DISTINCT FROM OLD.predecessor_id
      OR NEW.revision_no IS DISTINCT FROM OLD.revision_no
    THEN RAISE EXCEPTION 'Course revision lineage is immutable'; END IF;
  ELSIF NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    RAISE EXCEPTION 'Authored rule, step and activity revision ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_course_revision_identity ON public.medication_course_revisions;
CREATE TRIGGER medication_course_revision_identity BEFORE UPDATE ON public.medication_course_revisions FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_identity();
DROP TRIGGER IF EXISTS medication_course_rule_identity ON public.medication_course_rules;
CREATE TRIGGER medication_course_rule_identity BEFORE UPDATE ON public.medication_course_rules FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_identity();
DROP TRIGGER IF EXISTS medication_course_step_identity ON public.medication_course_steps;
CREATE TRIGGER medication_course_step_identity BEFORE UPDATE ON public.medication_course_steps FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_identity();
DROP TRIGGER IF EXISTS medication_course_activity_identity ON public.medication_course_activity;
CREATE TRIGGER medication_course_activity_identity BEFORE UPDATE ON public.medication_course_activity FOR EACH ROW EXECUTE FUNCTION public.protect_medication_course_identity();
