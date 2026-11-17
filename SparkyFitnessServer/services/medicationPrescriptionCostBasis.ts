import { normalizePurchaseDecimal } from '@workspace/shared';
export type PrescriptionCostBasis = 'per_vial' | null;
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
const invalid = () =>
  Object.assign(
    new Error('Confirm a supplied cost per vial before selecting its basis.'),
    { statusCode: 422, status: 422 }
  );
/** Authored intent only; an unrelated save never confirms ambiguous historical cost. */
export function prescriptionCostBasis(
  intent: CostIntent,
  previous?: CostState
): PrescriptionCostBasis {
  if (intent.cost_basis === 'per_vial') {
    if (
      intent.cost === undefined ||
      intent.cost === null ||
      normalizePurchaseDecimal(intent.cost) === null
    )
      throw invalid();
    return 'per_vial';
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
