-- One prescription may cover several medicines (and a medicine may sit on several prescriptions).
-- Additive and re-runnable. medication_prescriptions.medication_id stays as a deprecated "primary
-- medicine" mirror that triggers keep equal to the first live coverage row, so an older server keeps
-- working on this schema. Nothing in medication_prescriptions or in the stock/plan links is rewritten.

-- Fingerprint what must survive untouched; the self-check at the end compares against it.
SELECT set_config('sparky.rx_fp',
 (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.medication_prescriptions p)
 || ':' || (SELECT md5(COALESCE(string_agg(p.id::text || '=' || COALESCE(p.prescription_id::text, ''), '|' ORDER BY p.id), '')) FROM public.medication_pens p)
 || ':' || (SELECT md5(COALESCE(string_agg(r.id::text || '=' || COALESCE(r.prescription_id::text, ''), '|' ORDER BY r.id), '')) FROM public.medication_course_revisions r),
 true);

-- Re-runs: take the coverage triggers off first so the backfill below is never blocked by them.
DROP TRIGGER IF EXISTS medication_prescription_ensure_coverage ON public.medication_prescriptions;
DROP TRIGGER IF EXISTS medication_prescription_coverage_guard ON public.medication_prescription_medications;
DROP TRIGGER IF EXISTS medication_prescription_coverage_sync ON public.medication_prescription_medications;
DROP TRIGGER IF EXISTS medication_prescription_coverage_cap ON public.medication_prescription_medications;

-- The composite foreign key below needs a unique key on the parent.
CREATE UNIQUE INDEX IF NOT EXISTS medication_prescriptions_id_user ON public.medication_prescriptions(id, user_id);

CREATE TABLE IF NOT EXISTS public.medication_prescription_medications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 prescription_id UUID NOT NULL,
 user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 -- NULL is a permanent tombstone: the medicine was deleted, its remembered name stays.
 medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
 medication_name_snapshot TEXT NOT NULL,
 position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (prescription_id, user_id) REFERENCES public.medication_prescriptions(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS medication_prescription_medications_live ON public.medication_prescription_medications(prescription_id, medication_id) WHERE medication_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_prescription_medications_by_medicine ON public.medication_prescription_medications(user_id, medication_id, prescription_id) WHERE medication_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_prescription_medications_by_rx ON public.medication_prescription_medications(prescription_id, position, created_at, id);

ALTER TABLE public.medication_prescription_medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_policy ON public.medication_prescription_medications;
CREATE POLICY owner_policy ON public.medication_prescription_medications FOR ALL TO PUBLIC USING(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=NULLIF(current_setting('app.authenticated_user_id',true),'')::uuid AND user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);

-- Backfill: one coverage row per prescription that has none. An orphan (medicine already deleted)
-- becomes a tombstone, so no remembered name is lost. Idempotent.
INSERT INTO public.medication_prescription_medications(prescription_id, user_id, medication_id, medication_name_snapshot, position, created_at)
SELECT p.id, p.user_id, p.medication_id, p.medication_name_snapshot, 0, p.created_at
FROM public.medication_prescriptions p
WHERE NOT EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=p.id);

-- First live covered medicine, the value the deprecated column mirrors.
CREATE OR REPLACE FUNCTION public.medication_prescription_first_live(rx UUID) RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
 SELECT j.medication_id FROM public.medication_prescription_medications j
 WHERE j.prescription_id=rx AND j.medication_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.medications m WHERE m.id=j.medication_id)
 ORDER BY j.position, j.created_at, j.id LIMIT 1
$f$;

-- Identity: the primary may move only through the coverage triggers (nested), never by a direct write.
CREATE OR REPLACE FUNCTION public.guard_medication_prescription_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_prescriptions' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN RAISE EXCEPTION 'Invalid prescription identity trigger'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.medication_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=NEW.medication_id AND m.user_id=NEW.user_id) THEN RAISE EXCEPTION 'Prescription requires an owned medication'; END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.medication_name_snapshot IS DISTINCT FROM OLD.medication_name_snapshot THEN RAISE EXCEPTION 'Prescription identity is immutable'; END IF;
  IF NEW.medication_id IS DISTINCT FROM OLD.medication_id AND NOT (pg_trigger_depth()>1 AND (
    (NEW.medication_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id))
    OR NEW.medication_id IS NOT DISTINCT FROM public.medication_prescription_first_live(NEW.id)
  )) THEN RAISE EXCEPTION 'Prescription medication is immutable'; END IF;
 END IF;
 RETURN NEW;
END $guard$;

-- Coverage guard. Live rows are added/removed by the owner; tombstones are permanent and only leave
-- with their prescription (or account); a medicine cannot leave while stock or a plan still links it.
CREATE OR REPLACE FUNCTION public.guard_medication_prescription_coverage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
DECLARE linked INTEGER;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'medication_prescription_medications' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN RAISE EXCEPTION 'Invalid prescription coverage trigger'; END IF;
 IF TG_OP='INSERT' THEN
  IF pg_trigger_depth()=1 AND public.authenticated_user_id() IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Prescription coverage is private to the owner'; END IF;
  IF length(btrim(NEW.medication_name_snapshot))=0 THEN RAISE EXCEPTION 'Prescription coverage needs a medication name'; END IF;
  IF NEW.medication_id IS NULL THEN
   -- Only the deferred coverage-repair trigger may leave a tombstone; applications never insert one.
   IF pg_trigger_depth()=1 THEN RAISE EXCEPTION 'Prescription coverage requires an owned medication'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=NEW.medication_id AND m.user_id=NEW.user_id) THEN RAISE EXCEPTION 'Prescription coverage requires an owned medication'; END IF;
  END IF;
  RETURN NEW;
 ELSIF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.medication_name_snapshot IS DISTINCT FROM OLD.medication_name_snapshot OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Prescription coverage identity is immutable'; END IF;
  IF NEW.medication_id IS DISTINCT FROM OLD.medication_id THEN
   -- Only the foreign-key action for a deleted medicine may turn a live row into a tombstone.
   IF NOT (NEW.medication_id IS NULL AND OLD.medication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medications m WHERE m.id=OLD.medication_id)) THEN RAISE EXCEPTION 'Prescription coverage medication is immutable'; END IF;
  ELSIF NEW.position IS DISTINCT FROM OLD.position AND public.authenticated_user_id() IS DISTINCT FROM NEW.user_id THEN
   RAISE EXCEPTION 'Prescription coverage is private to the owner';
  END IF;
  RETURN NEW;
 END IF;
 -- DELETE: allowed when the prescription or the account is already gone (cascade).
 IF NOT EXISTS(SELECT 1 FROM public.medication_prescriptions p WHERE p.id=OLD.prescription_id) OR NOT EXISTS(SELECT 1 FROM public."user" u WHERE u.id=OLD.user_id) THEN RETURN OLD; END IF;
 IF public.authenticated_user_id() IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Prescription coverage is private to the owner'; END IF;
 IF OLD.medication_id IS NULL THEN RAISE EXCEPTION 'A deleted medication stays on the prescription'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=OLD.prescription_id AND j.id<>OLD.id AND j.medication_id IS NOT NULL) THEN RAISE EXCEPTION 'A prescription must keep at least one medication'; END IF;
 SELECT (SELECT count(*) FROM public.medication_pens p WHERE p.prescription_id=OLD.prescription_id AND p.medication_id=OLD.medication_id)
  + (SELECT count(*) FROM public.medication_course_revisions r JOIN public.medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id WHERE r.prescription_id=OLD.prescription_id AND c.medication_id=OLD.medication_id) INTO linked;
 IF linked>0 THEN RAISE EXCEPTION 'Prescription medicine is still linked to stock or a plan'; END IF;
 RETURN OLD;
END $guard$;

-- Keeps the deprecated primary-medicine column equal to the first live coverage row.
CREATE OR REPLACE FUNCTION public.sync_medication_prescription_primary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $sync$
DECLARE rx UUID; first_live UUID;
BEGIN
 rx:=CASE WHEN TG_OP='DELETE' THEN OLD.prescription_id ELSE NEW.prescription_id END;
 first_live:=public.medication_prescription_first_live(rx);
 UPDATE public.medication_prescriptions SET medication_id=first_live WHERE id=rx AND medication_id IS DISTINCT FROM first_live;
 RETURN NULL;
END $sync$;

-- An older server inserts a prescription with only medication_id; this adds its coverage row at commit.
CREATE OR REPLACE FUNCTION public.ensure_medication_prescription_coverage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $ensure$
DECLARE rx public.medication_prescriptions%ROWTYPE;
BEGIN
 SELECT * INTO rx FROM public.medication_prescriptions p WHERE p.id=NEW.id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=rx.id) THEN RETURN NULL; END IF;
 INSERT INTO public.medication_prescription_medications(prescription_id, user_id, medication_id, medication_name_snapshot, position, created_at)
 VALUES(rx.id, rx.user_id, rx.medication_id, rx.medication_name_snapshot, 0, rx.created_at);
 RETURN NULL;
END $ensure$;

-- At most 20 live medicines per prescription, checked at commit so one save may swap the whole set.
CREATE OR REPLACE FUNCTION public.check_medication_prescription_coverage_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $cap$
BEGIN
 IF (SELECT count(*) FROM public.medication_prescription_medications j WHERE j.prescription_id=NEW.prescription_id AND j.medication_id IS NOT NULL)>20 THEN RAISE EXCEPTION 'A prescription can cover at most 20 medications'; END IF;
 RETURN NULL;
END $cap$;
CREATE CONSTRAINT TRIGGER medication_prescription_coverage_cap AFTER INSERT ON public.medication_prescription_medications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_medication_prescription_coverage_cap();
CREATE TRIGGER medication_prescription_coverage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medication_prescription_medications FOR EACH ROW EXECUTE FUNCTION public.guard_medication_prescription_coverage();
CREATE TRIGGER medication_prescription_coverage_sync AFTER INSERT OR UPDATE OR DELETE ON public.medication_prescription_medications FOR EACH ROW EXECUTE FUNCTION public.sync_medication_prescription_primary();
CREATE CONSTRAINT TRIGGER medication_prescription_ensure_coverage AFTER INSERT ON public.medication_prescriptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ensure_medication_prescription_coverage();

-- Stock and plan links: the prescription must cover the medicine (replaces rx.medication_id = medicine).
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
 IF NOT FOUND OR rx.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Prescription link must match the owned medication'; END IF;
 IF med IS NULL THEN
  -- A tombstoned plan may only inherit a link, and only to a prescription that kept a deleted-medication row.
  IF NOT(inherited AND EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=rx.id AND j.user_id=rx.user_id AND j.medication_id IS NULL)) THEN RAISE EXCEPTION 'Prescription link must match the owned medication'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=rx.id AND j.user_id=NEW.user_id AND j.medication_id=med) THEN
  RAISE EXCEPTION 'Prescription link must match the owned medication';
 END IF;
 RETURN NEW;
END $guard$;

-- Self-check: abort the whole migration transaction if anything was lost or does not line up.
DO $check$
DECLARE before_fp TEXT:=current_setting('sparky.rx_fp', true); after_fp TEXT;
BEGIN
 after_fp:=(SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.medication_prescriptions p)
  || ':' || (SELECT md5(COALESCE(string_agg(p.id::text || '=' || COALESCE(p.prescription_id::text, ''), '|' ORDER BY p.id), '')) FROM public.medication_pens p)
  || ':' || (SELECT md5(COALESCE(string_agg(r.id::text || '=' || COALESCE(r.prescription_id::text, ''), '|' ORDER BY r.id), '')) FROM public.medication_course_revisions r);
 IF before_fp IS NULL OR before_fp<>after_fp THEN RAISE EXCEPTION 'Prescription migration changed existing prescription or link data'; END IF;
 IF EXISTS(SELECT 1 FROM public.medication_prescriptions p WHERE NOT EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=p.id)) THEN RAISE EXCEPTION 'Prescription coverage backfill incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.medication_prescriptions p WHERE p.medication_id IS DISTINCT FROM public.medication_prescription_first_live(p.id)) THEN RAISE EXCEPTION 'Prescription primary medicine mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.medication_pens x WHERE x.prescription_id IS NOT NULL AND x.medication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medication_prescription_medications j WHERE j.prescription_id=x.prescription_id AND j.medication_id=x.medication_id)) THEN RAISE EXCEPTION 'A stock link lost its prescription coverage'; END IF;
END $check$;
