-- Links a pack of tablets, capsules or similar to an invoice line, mirroring medication_purchase_vials.
-- A pack belongs to at most one line. Deleting an invoice or unlinking never touches the pack itself.
CREATE TABLE IF NOT EXISTS public.medication_purchase_packs (
  pack_id UUID PRIMARY KEY REFERENCES public.medication_packs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  purchase_item_id UUID NOT NULL,
  FOREIGN KEY(purchase_item_id,user_id) REFERENCES public.medication_purchase_items(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medication_purchase_packs_item ON public.medication_purchase_packs(purchase_item_id);
CREATE OR REPLACE FUNCTION public.check_medication_purchase_pack_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_purchase_packs'
    OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_OP NOT IN ('INSERT','UPDATE')
  THEN RAISE EXCEPTION 'Invalid purchase pack guard binding'; END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pack_id IS DISTINCT FROM OLD.pack_id)
  THEN RAISE EXCEPTION 'Purchase pack identity is immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.medication_purchase_items i
    JOIN public.medication_packs p ON p.id=NEW.pack_id AND p.user_id=i.user_id
    WHERE i.id=NEW.purchase_item_id AND i.user_id=NEW.user_id AND i.kind='medication'
      AND p.medication_id=i.medication_id
  ) THEN RAISE EXCEPTION 'Purchase pack does not match its owner and medication line'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_purchase_pack_scope ON public.medication_purchase_packs;
CREATE TRIGGER medication_purchase_pack_scope BEFORE INSERT OR UPDATE ON public.medication_purchase_packs
FOR EACH ROW EXECUTE FUNCTION public.check_medication_purchase_pack_scope();
