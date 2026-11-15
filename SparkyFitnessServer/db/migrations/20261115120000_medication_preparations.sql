-- Additive only: legacy stock receives no inferred preparation or date provenance.
ALTER TABLE medication_pens
  ADD COLUMN IF NOT EXISTS lot_number TEXT,
  ADD COLUMN IF NOT EXISTS storage_location TEXT,
  ADD COLUMN IF NOT EXISTS bud_mode TEXT CHECK (bud_mode IN ('date', 'interval')),
  ADD COLUMN IF NOT EXISTS bud_interval_days INTEGER CHECK (bud_interval_days BETWEEN 0 AND 36500),
  ADD COLUMN IF NOT EXISTS bud_base_date DATE,
  ADD COLUMN IF NOT EXISTS bud_source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS medication_pens_owner_medication_key ON medication_pens(id, user_id, medication_id);
CREATE TABLE IF NOT EXISTS medication_preparations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pen_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('reconstituted', 'premixed')),
  mass_value NUMERIC NOT NULL CHECK (mass_value > 0),
  mass_unit TEXT NOT NULL CHECK (mass_unit IN ('mg', 'mcg')),
  final_volume_ml NUMERIC NOT NULL CHECK (final_volume_ml > 0),
  mass_mg NUMERIC NOT NULL CHECK (mass_mg > 0),
  concentration_mg_ml NUMERIC NOT NULL CHECK (concentration_mg_ml > 0),
  prepared_date DATE NOT NULL,
  diluent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (pen_id, user_id, medication_id) REFERENCES medication_pens(id, user_id, medication_id) ON DELETE CASCADE
);
ALTER TABLE injection_entries ADD COLUMN IF NOT EXISTS preparation_id UUID REFERENCES medication_preparations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS injection_entries_preparation_idx ON injection_entries(preparation_id);
CREATE OR REPLACE FUNCTION protect_medication_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saved preparation inputs are immutable';
END;
$$;
DROP TRIGGER IF EXISTS immutable_medication_preparation ON medication_preparations;
CREATE TRIGGER immutable_medication_preparation BEFORE UPDATE ON medication_preparations
FOR EACH ROW EXECUTE FUNCTION protect_medication_preparation();
CREATE OR REPLACE FUNCTION check_injection_preparation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.preparation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM medication_preparations p WHERE p.id = NEW.preparation_id
      AND p.pen_id = NEW.pen_id AND p.user_id = NEW.user_id AND p.medication_id = NEW.medication_id
  ) THEN RAISE EXCEPTION 'Preparation does not belong to injection stock'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS injection_preparation_scope ON injection_entries;
CREATE TRIGGER injection_preparation_scope BEFORE INSERT OR UPDATE OF preparation_id, pen_id, user_id, medication_id ON injection_entries
FOR EACH ROW EXECUTE FUNCTION check_injection_preparation_scope();

-- Retain snapshots used by recorded injections; unused stock remains removable.
CREATE OR REPLACE FUNCTION protect_used_medication_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM medication_pens v WHERE v.id=OLD.pen_id
      AND (v.doses_used > 0 OR EXISTS (SELECT 1 FROM injection_entries i WHERE i.pen_id=v.id))) THEN
    RAISE EXCEPTION 'Preparation with recorded use cannot be removed';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS retain_used_medication_preparation ON medication_preparations;
CREATE TRIGGER retain_used_medication_preparation BEFORE DELETE ON medication_preparations
FOR EACH ROW EXECUTE FUNCTION protect_used_medication_preparation();
