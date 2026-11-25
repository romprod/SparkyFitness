-- "Keep as is" pins for the Smooth your week suggestions: a medication the person has pinned is left
-- alone when weekly injections are suggested a new weekday. One row per pinned medication; no row
-- means not pinned. Removing the medication or the user removes the pin.
CREATE TABLE IF NOT EXISTS public.medication_smooth_week_pins (
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, medication_id)
);
CREATE INDEX IF NOT EXISTS medication_smooth_week_pins_medication ON public.medication_smooth_week_pins (medication_id);
