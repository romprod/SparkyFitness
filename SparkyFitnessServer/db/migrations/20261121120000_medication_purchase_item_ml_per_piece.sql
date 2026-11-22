-- Millilitres in one bottle of bacteriostatic water on an invoice line, so the water a vial was
-- mixed with can be costed into that vial. Optional; existing lines stay without it.
ALTER TABLE public.medication_purchase_items ADD COLUMN IF NOT EXISTS ml_per_piece NUMERIC;
ALTER TABLE public.medication_purchase_items DROP CONSTRAINT IF EXISTS medication_purchase_items_ml_per_piece_check;
ALTER TABLE public.medication_purchase_items ADD CONSTRAINT medication_purchase_items_ml_per_piece_check
 CHECK(ml_per_piece IS NULL OR (ml_per_piece>0 AND category='bac_water'));
