-- Illness, travel and other windows: dated spans (both days included) that are shown shaded on
-- the medication report charts and counted, so a dip in weight during a flu is not read as the
-- medication at work. A window is context, never an explanation. At most 120 days long.
CREATE TABLE IF NOT EXISTS public.life_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('illness', 'travel', 'other')),
  start_day DATE NOT NULL,
  end_day DATE NOT NULL,
  label TEXT CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT life_events_span CHECK (end_day >= start_day AND end_day - start_day <= 119)
);
CREATE INDEX IF NOT EXISTS life_events_user_start ON public.life_events (user_id, start_day);
DROP TRIGGER IF EXISTS set_timestamp ON public.life_events;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.life_events
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
