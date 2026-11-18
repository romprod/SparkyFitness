-- Pack stock for tablets, capsules, softgels, scoops and similar. Remaining units are always
-- derived (units_total - units_used); nothing is inferred, backfilled or defaulted from history.
CREATE TABLE IF NOT EXISTS public.medication_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  label TEXT,
  unit_label TEXT NOT NULL,
  units_total NUMERIC(12,3) NOT NULL,
  units_used NUMERIC(12,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sealed',
  opened_at DATE,
  finished_at TIMESTAMPTZ,
  expiry_date DATE,
  lot_number TEXT,
  storage_location TEXT,
  reorder_threshold_units NUMERIC(12,3),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.medication_packs DROP CONSTRAINT IF EXISTS medication_packs_units_check;
ALTER TABLE public.medication_packs ADD CONSTRAINT medication_packs_units_check CHECK (
  units_total > 0 AND units_used >= 0
  AND (reorder_threshold_units IS NULL OR reorder_threshold_units >= 0)
  AND length(btrim(unit_label)) > 0
);
ALTER TABLE public.medication_packs DROP CONSTRAINT IF EXISTS medication_packs_status_check;
ALTER TABLE public.medication_packs ADD CONSTRAINT medication_packs_status_check
  CHECK (status IN ('sealed', 'in_use', 'finished', 'discarded'));
CREATE INDEX IF NOT EXISTS idx_medication_packs_user_medication
  ON public.medication_packs(user_id, medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_packs_user_status
  ON public.medication_packs(user_id, status);
DROP TRIGGER IF EXISTS set_timestamp ON public.medication_packs;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.medication_packs
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- The exact amount a logged dose took from a pack, so an edit or delete restores it precisely.
ALTER TABLE public.medication_entries
  ADD COLUMN IF NOT EXISTS pack_id UUID REFERENCES public.medication_packs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pack_units_deducted NUMERIC(12,3);
ALTER TABLE public.medication_entries DROP CONSTRAINT IF EXISTS medication_entries_pack_units_check;
ALTER TABLE public.medication_entries ADD CONSTRAINT medication_entries_pack_units_check
  CHECK (pack_units_deducted IS NULL OR pack_units_deducted >= 0);
CREATE INDEX IF NOT EXISTS idx_medication_entries_pack
  ON public.medication_entries(pack_id) WHERE pack_id IS NOT NULL;
