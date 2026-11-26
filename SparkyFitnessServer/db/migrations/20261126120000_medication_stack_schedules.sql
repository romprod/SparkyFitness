-- One schedule per stack. A stack may carry a single shared timing (daily, specific days, every
-- N days, or on/off days). Each medicine that follows it keeps an ordinary course whose rules are
-- generated from this row; the row is the source of truth and the binding says who follows it.
-- This migration only creates empty tables: no stack or plan is changed until the owner saves a
-- schedule. Dropping both tables returns every stack to "no stack schedule" and loses no plan data.
CREATE TABLE IF NOT EXISTS public.medication_stack_schedules (
  stack_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  schedule_type_id VARCHAR(50) NOT NULL REFERENCES public.medication_schedule_types(id),
  time_of_day TIME,
  days_of_week INTEGER[],
  interval_days INTEGER,
  cycle_on_days INTEGER,
  cycle_off_days INTEGER,
  start_date DATE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stack_id, user_id),
  FOREIGN KEY (stack_id, user_id) REFERENCES public.medication_stacks(id, user_id) ON DELETE CASCADE
);
ALTER TABLE public.medication_stack_schedules DROP CONSTRAINT IF EXISTS medication_stack_schedule_shape;
ALTER TABLE public.medication_stack_schedules ADD CONSTRAINT medication_stack_schedule_shape CHECK (
  schedule_type_id IN ('daily', 'specific_days', 'every_n_days', 'cyclic')
  AND (schedule_type_id <> 'specific_days' OR cardinality(days_of_week) >= 1)
  AND (schedule_type_id <> 'every_n_days' OR (interval_days >= 2 AND start_date IS NOT NULL))
  AND (schedule_type_id <> 'cyclic' OR (cycle_on_days >= 1 AND cycle_off_days >= 1 AND start_date IS NOT NULL))
  AND (days_of_week IS NULL OR days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6])
);
DROP TRIGGER IF EXISTS set_timestamp ON public.medication_stack_schedules;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.medication_stack_schedules
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- A medicine follows at most one stack schedule (the primary key), and only while it is a member
-- of that stack: removing the member, the schedule or the stack removes the binding with it.
-- applied_version is the schedule version last applied to the medicine; below the schedule's
-- version the medicine is waiting (no plan yet, a finished plan, or left out of the last save).
CREATE TABLE IF NOT EXISTS public.medication_stack_schedule_bindings (
  medication_id UUID PRIMARY KEY REFERENCES public.medications(id) ON DELETE CASCADE,
  stack_id UUID NOT NULL,
  user_id UUID NOT NULL,
  applied_version INTEGER NOT NULL DEFAULT 0 CHECK (applied_version >= 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (stack_id, user_id) REFERENCES public.medication_stack_schedules(stack_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (stack_id, medication_id) REFERENCES public.medication_stack_members(stack_id, medication_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medication_stack_schedule_bindings_stack
  ON public.medication_stack_schedule_bindings (stack_id);

CREATE OR REPLACE FUNCTION public.check_medication_stack_binding_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.medications m WHERE m.id = NEW.medication_id AND m.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'A schedule binding must be one of the owner''s medications'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medication_stack_binding_owner ON public.medication_stack_schedule_bindings;
CREATE TRIGGER medication_stack_binding_owner BEFORE INSERT OR UPDATE ON public.medication_stack_schedule_bindings
  FOR EACH ROW EXECUTE FUNCTION public.check_medication_stack_binding_owner();
