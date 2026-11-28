-- Audit log of vial, invoice and prescription changes. AFTER row triggers on five
-- tables write one row per create, edit or delete, in the same transaction as the
-- save, so no application code changes. Rows written before this migration do not
-- exist. Owner-only: invoices and prescriptions hold money and private text.
-- Kill switch (no deploy needed):
--   ALTER TABLE public.medication_pens DISABLE TRIGGER medication_change_audit_vial_write;
--   ALTER TABLE public.medication_pens DISABLE TRIGGER medication_change_audit_vial_edit;
--   ALTER TABLE public.medication_purchases DISABLE TRIGGER medication_change_audit_purchase;
--   ALTER TABLE public.medication_purchase_items DISABLE TRIGGER medication_change_audit_purchase_item;
--   ALTER TABLE public.medication_prescriptions DISABLE TRIGGER medication_change_audit_prescription;
--   ALTER TABLE public.medication_prescription_medications DISABLE TRIGGER medication_change_audit_prescription_medicine;

CREATE TABLE IF NOT EXISTS public.medication_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  -- NULL: the owner pool or a system job. No foreign key on purpose, so the row
  -- stays unchanged when a caregiver's account is deleted.
  actor_user_id UUID,
  entity_kind TEXT NOT NULL,
  -- No foreign keys on the next three: the history survives the row, the parent and the medicine.
  entity_id UUID NOT NULL,
  -- The invoice of a line, the prescription of a coverage row. NULL for the rest.
  parent_id UUID,
  medication_id UUID,
  action TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  old_values JSONB,
  new_values JSONB,
  -- Rows written by one transaction (one save) share this, so they can be grouped.
  tx_id BIGINT NOT NULL DEFAULT txid_current()
);
ALTER TABLE public.medication_change_audit DROP CONSTRAINT IF EXISTS medication_change_audit_shape;
ALTER TABLE public.medication_change_audit ADD CONSTRAINT medication_change_audit_shape CHECK (
  entity_kind IN ('vial','purchase','purchase_item','prescription','prescription_medicine')
  AND action IN ('create','edit','delete')
  AND (action <> 'create' OR (old_values IS NULL AND new_values IS NOT NULL))
  AND (action <> 'edit' OR (old_values IS NOT NULL AND new_values IS NOT NULL))
  AND (action <> 'delete' OR (old_values IS NOT NULL AND new_values IS NULL))
);
CREATE INDEX IF NOT EXISTS medication_change_audit_entity
  ON public.medication_change_audit (user_id, entity_kind, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS medication_change_audit_recent
  ON public.medication_change_audit (user_id, changed_at DESC);

-- The row as JSON minus that table's bookkeeping columns. A blocklist, so a column
-- added to one of the five tables later is audited without a change here.
-- Vials leave out the counters and status that dose saves move; invoices and
-- prescriptions leave out their save counters, line and coverage order, and the
-- prescription's primary-medicine mirror.
CREATE OR REPLACE FUNCTION public.medication_change_audit_snapshot(tbl text, r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT r - (CASE tbl
    WHEN 'medication_pens' THEN
      ARRAY['id','user_id','created_at','updated_at','custom_fields','doses_used','status','opened_at','reorder_flag','finished_at']
    WHEN 'medication_purchases' THEN
      ARRAY['id','user_id','created_at','revision']
    WHEN 'medication_purchase_items' THEN
      ARRAY['id','user_id','sort_index']
    WHEN 'medication_prescriptions' THEN
      ARRAY['id','user_id','created_at','updated_at','version','medication_id']
    WHEN 'medication_prescription_medications' THEN
      ARRAY['id','user_id','created_at','position']
    ELSE ARRAY['id','user_id']
  END)::text[]
$$;

-- Numbers become strings, so a reader in JavaScript cannot round a decimal.
CREATE OR REPLACE FUNCTION public.medication_change_audit_text(r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(e.key,
           CASE WHEN jsonb_typeof(e.value) = 'number' THEN to_jsonb(e.value #>> '{}') ELSE e.value END),
         '{}'::jsonb)
    FROM jsonb_each(r) AS e
$$;

CREATE OR REPLACE FUNCTION public.record_medication_change_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
-- to_jsonb renders timestamptz in the session time zone; pin it so rows are alike.
SET timezone = 'UTC' AS $$
DECLARE
  v_kind text; v_row jsonb; v_old jsonb; v_new jsonb; v_user uuid; v_id uuid; v_med uuid; v_parent uuid;
BEGIN
  IF TG_LEVEL <> 'ROW' OR TG_WHEN <> 'AFTER' OR TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME NOT IN ('medication_pens','medication_purchases','medication_purchase_items',
                              'medication_prescriptions','medication_prescription_medications') THEN
    RAISE EXCEPTION 'Invalid trigger context for medication change audit';
  END IF;
  v_kind := CASE TG_TABLE_NAME
    WHEN 'medication_pens' THEN 'vial'
    WHEN 'medication_purchases' THEN 'purchase'
    WHEN 'medication_purchase_items' THEN 'purchase_item'
    WHEN 'medication_prescriptions' THEN 'prescription'
    ELSE 'prescription_medicine' END;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_user := (v_row ->> 'user_id')::uuid;
  v_id := (v_row ->> 'id')::uuid;
  -- Purchases have no medicine and no parent. A line has the invoice as parent, a coverage
  -- row the prescription. The prescription's own medicine column is the primary-medicine mirror.
  v_med := CASE WHEN TG_TABLE_NAME = 'medication_purchases' THEN NULL ELSE (v_row ->> 'medication_id')::uuid END;
  v_parent := CASE TG_TABLE_NAME
    WHEN 'medication_purchase_items' THEN (v_row ->> 'purchase_id')::uuid
    WHEN 'medication_prescription_medications' THEN (v_row ->> 'prescription_id')::uuid
    ELSE NULL END;
  -- Account deletion cascades these rows after the owner row is gone: nobody to record for.
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = v_user) THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.medication_change_audit (user_id, actor_user_id, entity_kind, entity_id, parent_id, medication_id, action, new_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_parent, v_med, 'create',
            public.medication_change_audit_text(public.medication_change_audit_snapshot(TG_TABLE_NAME, v_row)));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.medication_change_audit (user_id, actor_user_id, entity_kind, entity_id, parent_id, medication_id, action, old_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_parent, v_med, 'delete',
            public.medication_change_audit_text(public.medication_change_audit_snapshot(TG_TABLE_NAME, v_row)));
  ELSE
    v_old := public.medication_change_audit_snapshot(TG_TABLE_NAME, to_jsonb(OLD));
    v_new := public.medication_change_audit_snapshot(TG_TABLE_NAME, v_row);
    IF v_old = v_new THEN RETURN NULL; END IF; -- bookkeeping-only change: no row
    -- Only the keys whose value changed.
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_old, v_new
      FROM jsonb_object_keys(v_new) AS k
     WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
    IF v_new IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.medication_change_audit (user_id, actor_user_id, entity_kind, entity_id, parent_id, medication_id, action, old_values, new_values)
    VALUES (v_user, public.authenticated_user_id(), v_kind, v_id, v_parent, v_med, 'edit',
            public.medication_change_audit_text(v_old), public.medication_change_audit_text(v_new));
  END IF;
  RETURN NULL;
END;
$$;

-- Vials: create and delete share one trigger. The edit is its own trigger, fired only
-- when an UPDATE names an audited column. Dose saves update only doses_used, status,
-- opened_at, reorder_flag, finished_at and updated_at, so they never run it.
-- A column added to medication_pens later must be added here (or to the bookkeeping
-- list in the snapshot function); the integration test fails until it is.
DROP TRIGGER IF EXISTS medication_change_audit_vial_write ON public.medication_pens;
CREATE TRIGGER medication_change_audit_vial_write AFTER INSERT OR DELETE ON public.medication_pens
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();
DROP TRIGGER IF EXISTS medication_change_audit_vial_edit ON public.medication_pens;
CREATE TRIGGER medication_change_audit_vial_edit AFTER UPDATE OF
    medication_id, kind, label, dose_mg, concentration_mg_ml, volume_ml, doses_total,
    expiry_date, bud_date, bud_mode, bud_interval_days, bud_base_date, bud_source,
    reorder_threshold, notes, source, lot_number, storage_location, label_mass_mg, prescription_id
  ON public.medication_pens
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();

DROP TRIGGER IF EXISTS medication_change_audit_purchase ON public.medication_purchases;
CREATE TRIGGER medication_change_audit_purchase AFTER INSERT OR UPDATE OR DELETE ON public.medication_purchases
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();
DROP TRIGGER IF EXISTS medication_change_audit_purchase_item ON public.medication_purchase_items;
CREATE TRIGGER medication_change_audit_purchase_item AFTER INSERT OR UPDATE OR DELETE ON public.medication_purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();
DROP TRIGGER IF EXISTS medication_change_audit_prescription ON public.medication_prescriptions;
CREATE TRIGGER medication_change_audit_prescription AFTER INSERT OR UPDATE OR DELETE ON public.medication_prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();
DROP TRIGGER IF EXISTS medication_change_audit_prescription_medicine ON public.medication_prescription_medications;
CREATE TRIGGER medication_change_audit_prescription_medicine AFTER INSERT OR UPDATE OR DELETE ON public.medication_prescription_medications
  FOR EACH ROW EXECUTE FUNCTION public.record_medication_change_audit();

-- Append-only guards on the audit table.
CREATE OR REPLACE FUNCTION public.protect_medication_change_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_RELID <> 'public.medication_change_audit'::regclass OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' THEN
    RAISE EXCEPTION 'Invalid trigger context for medication change audit retention';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only the audit trigger writes (depth 2 or more); a direct application insert is depth 1.
    IF pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Medication change audit rows are written by the database only'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public."user" WHERE id = OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Medication change audit history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS medication_change_audit_insert_guard ON public.medication_change_audit;
CREATE TRIGGER medication_change_audit_insert_guard BEFORE INSERT ON public.medication_change_audit
  FOR EACH ROW EXECUTE FUNCTION public.protect_medication_change_audit();
DROP TRIGGER IF EXISTS medication_change_audit_immutable ON public.medication_change_audit;
CREATE TRIGGER medication_change_audit_immutable BEFORE UPDATE OR DELETE ON public.medication_change_audit
  FOR EACH ROW EXECUTE FUNCTION public.protect_medication_change_audit();
