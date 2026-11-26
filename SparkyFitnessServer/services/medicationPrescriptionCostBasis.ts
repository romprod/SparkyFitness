import { normalizePurchaseDecimal } from '@workspace/shared';
export type PrescriptionCostBasis = 'per_vial' | 'per_prescription' | null;
interface CostState {
  cost: string | null;
  currency: string;
  cost_basis?: PrescriptionCostBasis;
}
interface CostIntent {
  cost?: string | null;
  currency?: string | null;
  cost_basis?: PrescriptionCostBasis;
}
const invalid = (basis: 'per_vial' | 'per_prescription') =>
  Object.assign(
    new Error(
      basis === 'per_vial'
        ? 'Confirm a supplied cost per vial before selecting its basis.'
        : 'Confirm a supplied total cost before selecting its basis.'
    ),
    { statusCode: 422, status: 422 }
  );
/** Authored intent only; an unrelated save never confirms ambiguous historical cost. */
export function prescriptionCostBasis(
  intent: CostIntent,
  previous?: CostState
): PrescriptionCostBasis {
  if (
    intent.cost_basis === 'per_vial' ||
    intent.cost_basis === 'per_prescription'
  ) {
    if (
      intent.cost === undefined ||
      intent.cost === null ||
      normalizePurchaseDecimal(intent.cost) === null
    )
      throw invalid(intent.cost_basis);
    return intent.cost_basis;
  }
  if (intent.cost_basis === null) return null;
  if (!previous) return null;
  const cost = intent.cost === undefined ? previous.cost : intent.cost;
  const currency =
    intent.currency === undefined ? previous.currency : intent.currency;
  const canonical = (value: string | null) =>
    value === null ? null : normalizePurchaseDecimal(value);
  return canonical(cost) === canonical(previous.cost) &&
    currency === previous.currency
    ? (previous.cost_basis ?? null)
    : null;
}
