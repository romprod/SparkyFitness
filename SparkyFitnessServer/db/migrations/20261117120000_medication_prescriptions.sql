-- Owner-private manual prescription facts. No legacy backfill or physical changes.
CREATE TABLE IF NOT EXISTS public.medication_prescriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
 medication_name_snapshot TEXT NOT NULL,
 source_encrypted JSONB, prescriber_encrypted JSONB, pharmacy_encrypted JSONB, dose_instructions_encrypted JSONB,
 cost NUMERIC CHECK(cost>=0 AND cost::text NOT IN ('NaN','Infinity','-Infinity')),
 currency TEXT NOT NULL DEFAULT 'AUD',
 quantity INTEGER CHECK(quantity>=0), refills_authorized INTEGER CHECK(refills_authorized>=0), refills_remaining INTEGER CHECK(refills_remaining>=0),
 date_written DATE, next_refill DATE, expiration DATE, lead_time_days INTEGER CHECK(lead_time_days>=0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS medication_prescriptions_owner ON public.medication_prescriptions(user_id,status,expiration,id);
CREATE TABLE IF NOT EXISTS public.medication_prescription_operations (
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 operation_id UUID NOT NULL, request_hash TEXT NOT NULL, result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE public.medication_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_prescription_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_policy ON public.medication_prescriptions;
CREATE POLICY owner_policy ON public.medication_prescriptions FOR ALL TO PUBLIC USING(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
DROP POLICY IF EXISTS owner_select_policy ON public.medication_prescription_operations;
DROP POLICY IF EXISTS owner_insert_policy ON public.medication_prescription_operations;
CREATE POLICY owner_select_policy ON public.medication_prescription_operations FOR SELECT TO PUBLIC USING(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY owner_insert_policy ON public.medication_prescription_operations FOR INSERT TO PUBLIC WITH CHECK(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
ALTER TABLE public.medication_pens ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES public.medication_prescriptions(id) ON DELETE SET NULL;
ALTER TABLE public.medication_course_revisions ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES public.medication_prescriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS medication_pens_prescription ON public.medication_pens(prescription_id) WHERE prescription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_course_revisions_prescription ON public.medication_course_revisions(prescription_id) WHERE prescription_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.guard_medication_prescription_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_prescriptions' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN RAISE EXCEPTION 'Invalid prescription identity trigger'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.medication_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=NEW.medication_id AND m.user_id=NEW.user_id) THEN RAISE EXCEPTION 'Prescription requires an owned medication'; END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.medication_name_snapshot IS DISTINCT FROM OLD.medication_name_snapshot THEN RAISE EXCEPTION 'Prescription identity is immutable'; END IF;
  IF NEW.medication_id IS DISTINCT FROM OLD.medication_id AND NOT (pg_trigger_depth()>1 AND NEW.medication_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id)) THEN RAISE EXCEPTION 'Prescription medication is immutable'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
DROP TRIGGER IF EXISTS medication_prescription_identity ON public.medication_prescriptions;
CREATE TRIGGER medication_prescription_identity BEFORE INSERT OR UPDATE ON public.medication_prescriptions FOR EACH ROW EXECUTE FUNCTION public.guard_medication_prescription_identity();
CREATE OR REPLACE FUNCTION public.guard_medication_prescription_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
DECLARE med UUID; rx public.medication_prescriptions%ROWTYPE; inherited BOOLEAN:=false;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('medication_pens','medication_course_revisions') OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN RAISE EXCEPTION 'Invalid prescription link trigger'; END IF;
 IF TG_OP='UPDATE' AND NEW.prescription_id IS NOT DISTINCT FROM OLD.prescription_id THEN
  IF TG_TABLE_NAME='medication_course_revisions' THEN RETURN NEW; END IF;
  IF NEW.medication_id IS NOT DISTINCT FROM OLD.medication_id AND (NEW.prescription_id IS NULL OR NEW.user_id IS NOT DISTINCT FROM OLD.user_id) THEN RETURN NEW; END IF;
 END IF;
 -- A genuine FK deletion cleans up only the optional relationship, even on old revisions.
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.prescription_id IS NULL AND OLD.prescription_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medication_prescriptions p WHERE p.id=OLD.prescription_id) THEN
  IF (to_jsonb(NEW)-'prescription_id'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'prescription_id'-'updated_at') THEN RAISE EXCEPTION 'Prescription cleanup cannot change history'; END IF;
  IF TG_TABLE_NAME='medication_pens' THEN NEW.updated_at:=OLD.updated_at; END IF;
  RETURN NEW;
 END IF;
 IF NEW.prescription_id IS NULL AND TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='medication_course_revisions' THEN
  inherited:=NEW.predecessor_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.medication_course_revisions r WHERE r.id=NEW.predecessor_id AND r.user_id=NEW.user_id AND r.course_id=NEW.course_id AND r.prescription_id=NEW.prescription_id);
 END IF;
 IF public.authenticated_user_id() IS DISTINCT FROM NEW.user_id AND NOT inherited THEN RAISE EXCEPTION 'Prescription links are private to the owner'; END IF;
 IF NEW.prescription_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='medication_pens' THEN med:=NEW.medication_id;
 ELSE SELECT c.medication_id INTO med FROM public.medication_courses c WHERE c.id=NEW.course_id AND c.user_id=NEW.user_id; END IF;
 SELECT * INTO rx FROM public.medication_prescriptions p WHERE p.id=NEW.prescription_id;
 IF NOT FOUND OR rx.user_id IS DISTINCT FROM NEW.user_id OR (med IS NULL AND NOT(inherited AND rx.medication_id IS NULL)) OR rx.medication_id IS DISTINCT FROM med THEN RAISE EXCEPTION 'Prescription link must match the owned medication'; END IF;
 RETURN NEW;
END $guard$;
DROP TRIGGER IF EXISTS zz_medication_prescription_link ON public.medication_pens;
CREATE TRIGGER zz_medication_prescription_link BEFORE INSERT OR UPDATE ON public.medication_pens FOR EACH ROW EXECUTE FUNCTION public.guard_medication_prescription_link();
DROP TRIGGER IF EXISTS zz_medication_prescription_link ON public.medication_course_revisions;
CREATE TRIGGER zz_medication_prescription_link BEFORE INSERT OR UPDATE ON public.medication_course_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_medication_prescription_link();

CREATE OR REPLACE FUNCTION public.guard_medication_prescription_receipt() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN RAISE EXCEPTION 'Prescription operation receipts are immutable'; END $guard$;
DROP TRIGGER IF EXISTS medication_prescription_receipt_immutable ON public.medication_prescription_operations;
CREATE TRIGGER medication_prescription_receipt_immutable BEFORE UPDATE ON public.medication_prescription_operations FOR EACH ROW EXECUTE FUNCTION public.guard_medication_prescription_receipt();
