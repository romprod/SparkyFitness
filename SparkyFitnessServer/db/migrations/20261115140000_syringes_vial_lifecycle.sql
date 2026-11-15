CREATE TABLE IF NOT EXISTS medication_syringes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  graduation_type TEXT NOT NULL CHECK (graduation_type IN ('units','ml')),
  units_per_ml INTEGER NOT NULL CHECK (units_per_ml>0),
  capacity_ml NUMERIC NOT NULL CHECK (capacity_ml>0),
  capacity_units INTEGER NOT NULL CHECK (capacity_units>0),
  increment NUMERIC NOT NULL CHECK (increment>0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS medication_syringes_one_default ON medication_syringes(user_id) WHERE is_default;
ALTER TABLE medication_pens ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE injection_entries
 ADD COLUMN IF NOT EXISTS volume_ml NUMERIC CHECK (volume_ml>=0),
 ADD COLUMN IF NOT EXISTS syringe_units NUMERIC CHECK (syringe_units>=0),
 ADD COLUMN IF NOT EXISTS dose_input_unit TEXT CHECK (dose_input_unit IN ('mcg','mg','ml','units')),
 ADD COLUMN IF NOT EXISTS syringe_id UUID REFERENCES medication_syringes(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS medication_stock_status_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 pen_id UUID NOT NULL,
 old_status TEXT NOT NULL,
 new_status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION check_injection_syringe_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.syringe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM medication_syringes s WHERE s.id=NEW.syringe_id AND s.user_id=NEW.user_id)
 THEN RAISE EXCEPTION 'Syringe does not belong to injection owner'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS injection_syringe_scope ON injection_entries;
CREATE TRIGGER injection_syringe_scope BEFORE INSERT OR UPDATE OF syringe_id,user_id ON injection_entries
FOR EACH ROW EXECUTE FUNCTION check_injection_syringe_scope();

-- Audit entity IDs intentionally survive stock deletion; only account deletion cascades.
ALTER TABLE medication_stock_status_audit DROP CONSTRAINT IF EXISTS medication_stock_status_audit_pen_id_user_id_fkey;
CREATE OR REPLACE FUNCTION check_medication_stock_audit_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pen_id IS DISTINCT FROM OLD.pen_id)
 THEN RAISE EXCEPTION 'Audit stock identity is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM medication_pens v WHERE v.id=NEW.pen_id AND v.user_id=NEW.user_id)
 THEN RAISE EXCEPTION 'Audit stock does not belong to the recorded owner'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_stock_audit_scope ON medication_stock_status_audit;
CREATE TRIGGER medication_stock_audit_scope BEFORE INSERT OR UPDATE ON medication_stock_status_audit
FOR EACH ROW EXECUTE FUNCTION check_medication_stock_audit_scope();
