ALTER TABLE medication_syringes
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'syringe'
    CHECK (device_type IN ('syringe','pen','pump')),
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE medication_syringes DROP CONSTRAINT IF EXISTS medication_syringes_capacity_units_check;
ALTER TABLE medication_syringes ADD CONSTRAINT medication_syringes_capacity_units_check
  CHECK (capacity_units >= 0 AND (device_type='pump' OR capacity_units>0));
-- Only future writes record a known administration route. Legacy history stays
-- unknown; changing a medication's current route must not relabel old doses.
ALTER TABLE injection_entries ADD COLUMN IF NOT EXISTS administration_route TEXT
  CHECK (administration_route IN ('injection','nasal'));

CREATE TABLE IF NOT EXISTS medication_device_preferences (
  user_id UUID PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  default_syringe_id UUID REFERENCES medication_syringes(id) ON DELETE SET NULL
);
-- A preference row is also the one-time legacy migration marker. Cleared rows
-- remain present, so reapplying this migration cannot resurrect a preference.
INSERT INTO medication_device_preferences(user_id,default_syringe_id)
SELECT user_id,id FROM medication_syringes WHERE is_default AND user_id IS NOT NULL
ON CONFLICT(user_id) DO NOTHING;
UPDATE medication_syringes SET is_default=false WHERE is_default;

CREATE OR REPLACE FUNCTION check_medication_device_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'medication_syringes'
    OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' OR TG_OP <> 'UPDATE'
  THEN RAISE EXCEPTION 'Invalid medication device owner guard binding'; END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN RAISE EXCEPTION 'Device ownership is immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_device_owner ON medication_syringes;
CREATE TRIGGER medication_device_owner BEFORE UPDATE ON medication_syringes
FOR EACH ROW EXECUTE FUNCTION check_medication_device_owner();

CREATE OR REPLACE FUNCTION check_medication_device_preference_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'medication_device_preferences'
    OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid medication device preference guard binding'; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN RAISE EXCEPTION 'Device preference ownership is immutable'; END IF;
  IF NEW.default_syringe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medication_syringes s WHERE s.id=NEW.default_syringe_id
      AND (s.user_id=NEW.user_id OR s.user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Device is not available to preference owner'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_device_preference_scope ON medication_device_preferences;
CREATE TRIGGER medication_device_preference_scope BEFORE INSERT OR UPDATE ON medication_device_preferences
FOR EACH ROW EXECUTE FUNCTION check_medication_device_preference_scope();

CREATE OR REPLACE FUNCTION check_injection_syringe_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'injection_entries'
    OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid injection syringe guard binding'; END IF;
  IF NEW.syringe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medication_syringes s WHERE s.id=NEW.syringe_id
      AND (s.user_id=NEW.user_id OR s.user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Syringe does not belong to injection owner'; END IF;
  RETURN NEW;
END;
$$;
