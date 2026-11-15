-- Stable current projection, with immutable correction history surviving entity deletion.
ALTER TABLE public.medication_preparations
 ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 ADD COLUMN IF NOT EXISTS current_correction_id UUID,
 ADD COLUMN IF NOT EXISTS label_concentration_value NUMERIC CHECK (label_concentration_value > 0),
 ADD COLUMN IF NOT EXISTS label_concentration_unit TEXT CHECK (label_concentration_unit = 'mg/ml');
CREATE TABLE IF NOT EXISTS public.medication_preparation_corrections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 preparation_id UUID NOT NULL,
 pen_id UUID NOT NULL,
 medication_id UUID NOT NULL,
 from_revision INTEGER NOT NULL CHECK (from_revision >= 0),
 to_revision INTEGER NOT NULL CHECK (to_revision = from_revision + 1),
 operation_id UUID NOT NULL,
 request_hash TEXT NOT NULL,
 before_snapshot JSONB NOT NULL,
 after_snapshot JSONB NOT NULL,
 before_bud JSONB NOT NULL,
 after_bud JSONB NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (user_id, operation_id),
 UNIQUE (preparation_id, to_revision)
);
CREATE TABLE IF NOT EXISTS public.medication_preparation_dose_corrections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 correction_id UUID NOT NULL,
 injection_id UUID NOT NULL,
 before_dose_mg NUMERIC,
 after_dose_mg NUMERIC NOT NULL CHECK (after_dose_mg >= 0),
 volume_ml NUMERIC NOT NULL CHECK (volume_ml >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (correction_id, injection_id)
);
CREATE INDEX IF NOT EXISTS medication_preparation_corrections_owner_idx ON public.medication_preparation_corrections(user_id, preparation_id);
CREATE INDEX IF NOT EXISTS medication_preparation_dose_corrections_owner_idx ON public.medication_preparation_dose_corrections(user_id, correction_id);

CREATE OR REPLACE FUNCTION public.medication_preparation_snapshot(p public.medication_preparations)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'pen_id',p.pen_id,'user_id',p.user_id,'medication_id',p.medication_id,
 'mode',p.mode,'mass_value',p.mass_value::text,'mass_unit',p.mass_unit,'final_volume_ml',p.final_volume_ml::text,
 'mass_mg',p.mass_mg::text,'concentration_mg_ml',p.concentration_mg_ml::text,'prepared_date',p.prepared_date::text,
 'diluent',p.diluent,'created_at',p.created_at::text,'revision',p.revision,'current_correction_id',p.current_correction_id,
 'label_concentration_value',p.label_concentration_value::text,'label_concentration_unit',p.label_concentration_unit);
$$;
CREATE OR REPLACE FUNCTION public.check_preparation_correction_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE p public.medication_preparations;
BEGIN
 IF TG_RELID <> 'public.medication_preparation_corrections'::regclass OR TG_OP <> 'INSERT'
   OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' THEN RAISE EXCEPTION 'Invalid trigger context for preparation correction'; END IF;
 SELECT * INTO p FROM public.medication_preparations WHERE id=NEW.preparation_id;
 IF p.id IS NULL OR p.user_id<>NEW.user_id OR p.pen_id<>NEW.pen_id OR p.medication_id<>NEW.medication_id
   OR p.revision<>NEW.from_revision OR NEW.before_snapshot IS DISTINCT FROM public.medication_preparation_snapshot(p)
 THEN RAISE EXCEPTION 'Preparation correction does not match its owner and current revision'; END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.check_preparation_dose_correction_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_RELID <> 'public.medication_preparation_dose_corrections'::regclass OR TG_OP <> 'INSERT'
   OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' THEN RAISE EXCEPTION 'Invalid trigger context for preparation dose correction'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.medication_preparation_corrections c JOIN public.injection_entries i
   ON i.id=NEW.injection_id AND i.user_id=c.user_id AND i.preparation_id=c.preparation_id AND i.pen_id=c.pen_id AND i.medication_id=c.medication_id
   WHERE c.id=NEW.correction_id AND c.user_id=NEW.user_id AND i.volume_ml=NEW.volume_ml AND i.dose_mg IS NOT DISTINCT FROM NEW.before_dose_mg)
 THEN RAISE EXCEPTION 'Dose correction does not match preparation history'; END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.protect_preparation_correction_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_RELID NOT IN ('public.medication_preparation_corrections'::regclass,'public.medication_preparation_dose_corrections'::regclass)
   OR TG_OP NOT IN ('UPDATE','DELETE') OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE'
 THEN RAISE EXCEPTION 'Invalid trigger context for preparation audit retention'; END IF;
 IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public."user" WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Preparation correction history is immutable';
END;
$$;
CREATE OR REPLACE FUNCTION public.protect_medication_preparation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_RELID <> 'public.medication_preparations'::regclass OR TG_OP <> 'UPDATE'
   OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE' THEN RAISE EXCEPTION 'Invalid trigger context for preparation projection'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.pen_id IS DISTINCT FROM OLD.pen_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
   OR NEW.medication_id IS DISTINCT FROM OLD.medication_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.revision<>OLD.revision+1 OR NOT EXISTS (
     SELECT 1 FROM public.medication_preparation_corrections c WHERE c.id=NEW.current_correction_id
       AND c.user_id=NEW.user_id AND c.preparation_id=NEW.id AND c.pen_id=NEW.pen_id AND c.medication_id=NEW.medication_id
       AND c.from_revision=OLD.revision AND c.to_revision=NEW.revision
       AND c.before_snapshot=public.medication_preparation_snapshot(OLD)
       AND c.after_snapshot=public.medication_preparation_snapshot(NEW))
 THEN RAISE EXCEPTION 'Saved preparation inputs are immutable without a reviewed correction'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preparation_correction_scope ON public.medication_preparation_corrections;
CREATE TRIGGER preparation_correction_scope BEFORE INSERT ON public.medication_preparation_corrections FOR EACH ROW EXECUTE FUNCTION public.check_preparation_correction_scope();
DROP TRIGGER IF EXISTS preparation_dose_correction_scope ON public.medication_preparation_dose_corrections;
CREATE TRIGGER preparation_dose_correction_scope BEFORE INSERT ON public.medication_preparation_dose_corrections FOR EACH ROW EXECUTE FUNCTION public.check_preparation_dose_correction_scope();
DROP TRIGGER IF EXISTS immutable_preparation_correction ON public.medication_preparation_corrections;
CREATE TRIGGER immutable_preparation_correction BEFORE UPDATE OR DELETE ON public.medication_preparation_corrections FOR EACH ROW EXECUTE FUNCTION public.protect_preparation_correction_history();
DROP TRIGGER IF EXISTS immutable_preparation_dose_correction ON public.medication_preparation_dose_corrections;
CREATE TRIGGER immutable_preparation_dose_correction BEFORE UPDATE OR DELETE ON public.medication_preparation_dose_corrections FOR EACH ROW EXECUTE FUNCTION public.protect_preparation_correction_history();
