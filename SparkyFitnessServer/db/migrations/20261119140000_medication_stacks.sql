-- Stacks: a named group of the owner's medications and supplements that are taken
-- together (for example "Morning stack"). A stack changes nothing about its members:
-- each keeps its own schedule, dose, stock and history, and deleting a stack never
-- touches them. Deleting a medication removes it from every stack.
CREATE TABLE IF NOT EXISTS public.medication_stacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS medication_stacks_user_name
  ON public.medication_stacks (user_id, lower(btrim(name)));
DROP TRIGGER IF EXISTS set_timestamp ON public.medication_stacks;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.medication_stacks
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS public.medication_stack_members (
  stack_id UUID NOT NULL,
  user_id UUID NOT NULL,
  medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (stack_id, medication_id),
  FOREIGN KEY (stack_id, user_id) REFERENCES public.medication_stacks(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medication_stack_members_medication
  ON public.medication_stack_members (medication_id);

CREATE OR REPLACE FUNCTION public.check_medication_stack_member_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.medications m WHERE m.id = NEW.medication_id AND m.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'Stack member must be one of the owner''s medications'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_stack_member_owner ON public.medication_stack_members;
CREATE TRIGGER medication_stack_member_owner BEFORE INSERT OR UPDATE ON public.medication_stack_members
  FOR EACH ROW EXECUTE FUNCTION public.check_medication_stack_member_owner();
