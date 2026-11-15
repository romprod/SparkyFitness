-- Independent printed vial amount. Existing stock remains unknown; never infer it.
ALTER TABLE public.medication_pens ADD COLUMN IF NOT EXISTS label_mass_mg NUMERIC;
ALTER TABLE public.medication_pens DROP CONSTRAINT IF EXISTS medication_pens_vial_label_mass_check;
ALTER TABLE public.medication_pens ADD CONSTRAINT medication_pens_vial_label_mass_check CHECK (
  label_mass_mg IS NULL OR (
    kind = 'vial' AND label_mass_mg > 0
    AND label_mass_mg NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  )
);
