-- An explicit per-vial price basis is optional; existing generic prices remain unconfirmed.
ALTER TABLE public.medication_prescriptions ADD COLUMN IF NOT EXISTS cost_basis TEXT;
ALTER TABLE public.medication_prescriptions DROP CONSTRAINT IF EXISTS medication_prescription_cost_basis_check;
ALTER TABLE public.medication_prescriptions ADD CONSTRAINT medication_prescription_cost_basis_check
 CHECK(cost_basis IS NULL OR (cost_basis='per_vial' AND cost IS NOT NULL));
