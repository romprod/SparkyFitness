-- Vendor blends: one vial of blended powder (for example 50 mg GHK-Cu with 10 mg each of three
-- other peptides) is one medication whose doses are logged as the whole blend. This table says
-- which of the owner's medications make up a blend and how many mg of each one labelled vial
-- holds. It is reference data: no dose is ever written for a component, and every figure worked
-- out from it is shown as derived, with the source of the ratio (label, certificate of analysis
-- or assumed).
--
-- Deleting a blend removes its rows. A medication that is a component of a blend cannot be
-- deleted until it is taken out of the blend, because dropping it would silently change every
-- share. The component key is NO ACTION, not RESTRICT, so deleting a user (which removes the
-- blend, the components and the rows together) still works.
CREATE TABLE IF NOT EXISTS public.medication_blend_components (
  blend_medication_id UUID NOT NULL,
  component_medication_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  mass_mg NUMERIC(14, 6) NOT NULL CHECK (mass_mg > 0),
  source TEXT NOT NULL DEFAULT 'label' CHECK (source IN ('label', 'coa', 'assumed')),
  sort_index INTEGER NOT NULL DEFAULT 0 CHECK (sort_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blend_medication_id, component_medication_id),
  CONSTRAINT medication_blend_components_blend_fk
    FOREIGN KEY (blend_medication_id) REFERENCES public.medications(id) ON DELETE CASCADE,
  CONSTRAINT medication_blend_components_component_fk
    FOREIGN KEY (component_medication_id) REFERENCES public.medications(id),
  CONSTRAINT medication_blend_components_not_self
    CHECK (blend_medication_id <> component_medication_id)
);
CREATE INDEX IF NOT EXISTS medication_blend_components_component
  ON public.medication_blend_components (component_medication_id);
CREATE INDEX IF NOT EXISTS medication_blend_components_user
  ON public.medication_blend_components (user_id);

DROP TRIGGER IF EXISTS set_timestamp ON public.medication_blend_components;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.medication_blend_components
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Both sides belong to the row's owner, and blends do not nest: nested ratios would multiply
-- through with nothing on screen to show it.
CREATE OR REPLACE FUNCTION public.check_medication_blend_component() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.blend_medication_id = NEW.component_medication_id THEN
    RAISE EXCEPTION 'A blend cannot contain itself';
  END IF;
  IF (
    SELECT count(*) FROM public.medications m
    WHERE m.user_id = NEW.user_id
      AND m.id IN (NEW.blend_medication_id, NEW.component_medication_id)
  ) <> 2 THEN
    RAISE EXCEPTION 'A blend and its components must be the owner''s medications';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.medication_blend_components c
    WHERE c.blend_medication_id = NEW.component_medication_id
  ) THEN
    RAISE EXCEPTION 'A component cannot itself be a blend';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.medication_blend_components c
    WHERE c.component_medication_id = NEW.blend_medication_id
  ) THEN
    RAISE EXCEPTION 'A blend cannot be a component of another blend';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_blend_component_check ON public.medication_blend_components;
CREATE TRIGGER medication_blend_component_check BEFORE INSERT OR UPDATE ON public.medication_blend_components
  FOR EACH ROW EXECUTE FUNCTION public.check_medication_blend_component();
