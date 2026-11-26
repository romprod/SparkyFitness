-- Audit log of dose changes. A trigger on the two dose tables writes one row per
-- create, edit or delete, in the same transaction as the dose write, so no
-- application code changes. Doses logged before this migration have no rows.
-- Kill switch (no deploy needed):
--   ALTER TABLE public.injection_entries DISABLE TRIGGER medication_dose_audit_injection;
--   ALTER TABLE public.medication_entries DISABLE TRIGGER medication_dose_audit_entry;

CREATE TABLE IF NOT EXISTS public.medication_dose_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  -- NULL: the owner pool or a system job. No foreign key on purpose, so the row
  -- stays unchanged when a caregiver's account is deleted.
  actor_user_id UUID,
  entity_kind TEXT NOT NULL,
  -- No foreign keys on the next two: the history survives the dose and the medicine.
  entity_id UUID NOT NULL,
  medication_id UUID,
  action TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  old_values JSONB,
  new_values JSONB
);
ALTER TABLE public.medication_dose_audit DROP CONSTRAINT IF EXISTS medication_dose_audit_shape;
ALTER TABLE public.medication_dose_audit ADD CONSTRAINT medication_dose_audit_shape CHECK (
  entity_kind IN ('injection','entry')
  AND action IN ('create','edit','delete')
  AND (action <> 'create' OR (old_values IS NULL AND new_values IS NOT NULL))
  AND (action <> 'edit' OR (old_values IS NOT NULL AND new_values IS NOT NULL))
  AND (action <> 'delete' OR (old_values IS NOT NULL AND new_values IS NULL))
);
CREATE INDEX IF NOT EXISTS medication_dose_audit_entity
  ON public.medication_dose_audit (user_id, entity_kind, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS medication_dose_audit_recent
  ON public.medication_dose_audit (user_id, changed_at DESC);

-- The dose row as JSON minus bookkeeping columns. A blocklist, so a column added
-- to a dose table later is audited without a change here.
CREATE OR REPLACE FUNCTION public.medication_dose_audit_snapshot(r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r - ARRAY['id','user_id','created_at','updated_at','custom_fields','nutrients_snapshot',
                   'pack_id','pack_units_deducted','course_revision_id','course_rule_id','course_step_id',
                   'course_slot_key','course_origin','scheduled_day','phase_family_id']::text[]
$$;

-- Numbers become strings, so a reader in JavaScript cannot round a decimal.
CREATE OR REPLACE FUNCTION public.medication_dose_audit_text(r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(e.key,
           CASE WHEN jsonb_typeof(e.value) = 'number' THEN to_jsonb(e.value #>> '{}') ELSE e.value END),
         '{}'::jsonb)
    FROM jsonb_each(r) AS e
$$;

CREATE OR REPLACE FUNCTION public.record_medication_dose_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
-- to_jsonb renders timestamptz in the session time zone; pin it so rows are alike.
SET timezone = 'UTC' AS $$
DECLARE
  v_kind text; v_old jsonb; v_new jsonb; v_user uuid; v_id uuid; v_med uuid;
BEGIN
  IF TG_LEVEL <> 'ROW' OR TG_WHEN <> 'AFTER' OR TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME NOT IN ('injection_entries','medication_entries') THEN
    RAISE EXCEPTION 'Invalid trigger context for dose audit';
  END IF;
  v_kind := CASE TG_TABLE_NAME WHEN 'injection_entries' THEN 'injection' ELSE 'entry' END;

  IF TG_OP = 'DELETE' THEN
    v_user := OLD.user_id; v_id := OLD.id; v_med := OLD.medication_id;
  ELSE
    v_user := NEW.user_id; v_id := NEW.id; v_med := NEW.medication_id;
  END IF;
  -- Account deletion cascades dose rows after the owner row is gone: nobody to record for.
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = v_user) THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.medication_dose_audit (user_id, actor_user_id, entity_kind, entity_id, medication_id, action, new_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_med, 'create',
            public.medication_dose_audit_text(public.medication_dose_audit_snapshot(to_jsonb(NEW))));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.medication_dose_audit (user_id, actor_user_id, entity_kind, entity_id, medication_id, action, old_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_med, 'delete',
            public.medication_dose_audit_text(public.medication_dose_audit_snapshot(to_jsonb(OLD))));
  ELSE
    v_old := public.medication_dose_audit_snapshot(to_jsonb(OLD));
    v_new := public.medication_dose_audit_snapshot(to_jsonb(NEW));
    IF v_old = v_new THEN RETURN NULL; END IF; -- bookkeeping-only change: no row
    -- Only the keys whose value changed.
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_old, v_new
      FROM jsonb_object_keys(v_new) AS k
     WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
    IF v_new IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.medication_dose_audit (user_id, actor_user_id, entity_kind, entity_id, medication_id, action, old_values, new_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_med, 'edit',
            public.medication_dose_audit_text(v_old), public.medication_dose_audit_text(v_new));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS medication_dose_audit_injection ON public.injection_entries;
CREATE TRIGGER medication_dose_audit_injection AFTER INSERT OR UPDATE OR DELETE ON public.injection_entries
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_dose_audit();
DROP TRIGGER IF EXISTS medication_dose_audit_entry ON public.medication_entries;
CREATE TRIGGER medication_dose_audit_entry AFTER INSERT OR UPDATE OR DELETE ON public.medication_entries
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_dose_audit();

-- Append-only guards on the audit table.
CREATE OR REPLACE FUNCTION public.protect_medication_dose_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_RELID <> 'public.medication_dose_audit'::regclass OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' THEN
    RAISE EXCEPTION 'Invalid trigger context for dose audit retention';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only the audit trigger writes (depth 2); a direct application insert is depth 1.
    IF pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Dose audit rows are written by the database only'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public."user" WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dose audit history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS medication_dose_audit_insert_guard ON public.medication_dose_audit;
CREATE TRIGGER medication_dose_audit_insert_guard BEFORE INSERT ON public.medication_dose_audit
  FOR EACH ROW EXECUTE FUNCTION public.protect_medication_dose_audit();
DROP TRIGGER IF EXISTS medication_dose_audit_immutable ON public.medication_dose_audit;
CREATE TRIGGER medication_dose_audit_immutable BEFORE UPDATE OR DELETE ON public.medication_dose_audit
  FOR EACH ROW EXECUTE FUNCTION public.protect_medication_dose_audit();
