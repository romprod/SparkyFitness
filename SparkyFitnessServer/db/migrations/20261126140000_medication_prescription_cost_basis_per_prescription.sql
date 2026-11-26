-- A prescription's price may be the whole fill's (split evenly across its linked vials) instead of one vial's.
-- Widens only the allowed basis values; no row, cost or link is touched, and adding the constraint re-checks
-- every existing row, so the migration aborts rather than leave one that no longer fits.
ALTER TABLE public.medication_prescriptions DROP CONSTRAINT IF EXISTS medication_prescription_cost_basis_check;
ALTER TABLE public.medication_prescriptions ADD CONSTRAINT medication_prescription_cost_basis_check
 CHECK(cost_basis IS NULL OR (cost_basis IN ('per_vial','per_prescription') AND cost IS NOT NULL));
