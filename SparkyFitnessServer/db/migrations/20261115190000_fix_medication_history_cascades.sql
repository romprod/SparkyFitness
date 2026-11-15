-- Preserve nullable injection history during genuine parent FK cleanup without
-- permitting application updates to detach or forge preparation provenance.
-- Physical existence checks must not mistake RLS-hidden rows for deleted rows.
CREATE OR REPLACE FUNCTION public.check_injection_preparation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  cleanup boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.preparation_id IS NOT NULL THEN
    cleanup := pg_trigger_depth() > 1
      AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
      AND (NEW.preparation_id IS NULL OR NEW.preparation_id = OLD.preparation_id)
      AND (NEW.pen_id IS NULL OR NEW.pen_id IS NOT DISTINCT FROM OLD.pen_id)
      AND (NEW.medication_id IS NULL OR NEW.medication_id IS NOT DISTINCT FROM OLD.medication_id)
      AND (
        (NEW.pen_id IS NULL AND OLD.pen_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.medication_pens v WHERE v.id = OLD.pen_id))
        OR (NEW.medication_id IS NULL AND OLD.medication_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.medications m WHERE m.id = OLD.medication_id))
        OR (NEW.preparation_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.medication_preparations p WHERE p.id = OLD.preparation_id))
      );

    IF cleanup THEN
      NEW.preparation_id := NULL;
    ELSIF NEW.preparation_id IS NULL OR NEW.pen_id IS NULL OR NEW.medication_id IS NULL THEN
      RAISE EXCEPTION 'Preparation history cannot be detached while its stock exists';
    END IF;
  END IF;

  IF NEW.preparation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medication_preparations p
    WHERE p.id = NEW.preparation_id AND p.pen_id = NEW.pen_id
      AND p.user_id = NEW.user_id AND p.medication_id = NEW.medication_id
  ) THEN
    RAISE EXCEPTION 'Preparation does not belong to injection stock';
  END IF;
  RETURN NEW;
END;
$$;

-- The repository already protects used vials. Enforce the same protection for
-- direct table deletes while allowing medication/account deletion to clean FKs.
CREATE OR REPLACE FUNCTION public.protect_used_medication_vial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.medications m WHERE m.id = OLD.medication_id)
    AND EXISTS (SELECT 1 FROM public."user" u WHERE u.id = OLD.user_id)
    AND (OLD.doses_used > 0 OR EXISTS (
      SELECT 1 FROM public.injection_entries i WHERE i.pen_id = OLD.id
    )) THEN
    RAISE EXCEPTION 'Stock with recorded use cannot be removed; retain it for injection history';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS retain_used_medication_vial ON public.medication_pens;
CREATE TRIGGER retain_used_medication_vial BEFORE DELETE ON public.medication_pens
FOR EACH ROW EXECUTE FUNCTION public.protect_used_medication_vial();
