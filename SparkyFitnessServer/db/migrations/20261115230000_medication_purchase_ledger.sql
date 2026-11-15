CREATE TABLE IF NOT EXISTS public.medication_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  vendor TEXT,
  reference_encrypted JSONB,
  ordered_date DATE NOT NULL,
  received_date DATE CHECK(received_date IS NULL OR received_date>=ordered_date),
  currency TEXT NOT NULL DEFAULT 'AUD',
  shipping_cost NUMERIC NOT NULL DEFAULT 0 CHECK(shipping_cost>=0),
  tax_cost NUMERIC NOT NULL DEFAULT 0 CHECK(tax_cost>=0),
  other_fees NUMERIC NOT NULL DEFAULT 0 CHECK(other_fees>=0),
  discount NUMERIC NOT NULL DEFAULT 0 CHECK(discount>=0),
  allocation_method TEXT NOT NULL DEFAULT 'value' CHECK(allocation_method IN ('value','quantity','none')),
  notes_encrypted JSONB,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id,user_id)
);
CREATE INDEX IF NOT EXISTS medication_purchases_owner_order ON public.medication_purchases(user_id,ordered_date DESC,created_at DESC);
CREATE TABLE IF NOT EXISTS public.medication_purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('medication','consumable')),
  medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
  category TEXT CHECK(category IS NULL OR category IN ('needle','syringe','swab','sharps_container','pen_tip','bac_water','other')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  unit_cost NUMERIC NOT NULL CHECK(unit_cost>=0),
  units_per_pack INTEGER CHECK(units_per_pack>0),
  units_per_dose NUMERIC CHECK(units_per_dose>=0),
  sort_index INTEGER NOT NULL,
  UNIQUE(id,user_id),
  FOREIGN KEY(purchase_id,user_id) REFERENCES public.medication_purchases(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medication_purchase_items_parent ON public.medication_purchase_items(purchase_id,sort_index);
CREATE TABLE IF NOT EXISTS public.medication_purchase_vials (
  pen_id UUID PRIMARY KEY REFERENCES public.medication_pens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  purchase_item_id UUID NOT NULL,
  FOREIGN KEY(purchase_item_id,user_id) REFERENCES public.medication_purchase_items(id,user_id) ON DELETE CASCADE
);
-- A successful create receipt intentionally outlives its invoice. Retrying an old
-- operation after deletion must not resurrect the purchase or its associations.
CREATE TABLE IF NOT EXISTS public.medication_purchase_operations (
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  purchase_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,operation_id)
);
CREATE OR REPLACE FUNCTION public.check_medication_purchase_item_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_purchase_items'
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid purchase item guard binding'; END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id)
  THEN RAISE EXCEPTION 'Purchase item ownership is immutable'; END IF;
  IF NEW.medication_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.medications m WHERE m.id=NEW.medication_id AND m.user_id=NEW.user_id
  ) THEN RAISE EXCEPTION 'Purchase medication does not belong to owner'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_purchase_item_scope ON public.medication_purchase_items;
CREATE TRIGGER medication_purchase_item_scope BEFORE INSERT OR UPDATE ON public.medication_purchase_items
FOR EACH ROW EXECUTE FUNCTION public.check_medication_purchase_item_scope();
CREATE OR REPLACE FUNCTION public.check_medication_purchase_vial_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_purchase_vials'
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid purchase vial guard binding'; END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pen_id IS DISTINCT FROM OLD.pen_id)
  THEN RAISE EXCEPTION 'Purchase vial identity is immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medication_purchase_items i
    JOIN public.medication_pens p ON p.id=NEW.pen_id AND p.user_id=i.user_id
    WHERE i.id=NEW.purchase_item_id AND i.user_id=NEW.user_id AND i.kind='medication'
      AND p.kind='vial' AND p.medication_id=i.medication_id
  ) THEN RAISE EXCEPTION 'Purchase vial does not match its owner and medication line'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_purchase_vial_scope ON public.medication_purchase_vials;
CREATE TRIGGER medication_purchase_vial_scope BEFORE INSERT OR UPDATE ON public.medication_purchase_vials
FOR EACH ROW EXECUTE FUNCTION public.check_medication_purchase_vial_scope();
CREATE OR REPLACE FUNCTION public.check_medication_purchase_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('medication_purchases','medication_purchase_operations')
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP<>'UPDATE'
  THEN RAISE EXCEPTION 'Invalid purchase owner guard binding'; END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Purchase ownership is immutable'; END IF;
  IF TG_TABLE_NAME='medication_purchase_operations' THEN RAISE EXCEPTION 'Purchase operation receipt is immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_purchase_owner ON public.medication_purchases;
CREATE TRIGGER medication_purchase_owner BEFORE UPDATE ON public.medication_purchases FOR EACH ROW EXECUTE FUNCTION public.check_medication_purchase_owner();
DROP TRIGGER IF EXISTS medication_purchase_operation_immutable ON public.medication_purchase_operations;
CREATE TRIGGER medication_purchase_operation_immutable BEFORE UPDATE ON public.medication_purchase_operations FOR EACH ROW EXECUTE FUNCTION public.check_medication_purchase_owner();
