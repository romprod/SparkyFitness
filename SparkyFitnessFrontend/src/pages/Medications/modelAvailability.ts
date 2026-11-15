import {
  resolveGlp1Profile,
  type SerumCurveResponse,
  type SerumModelAvailability,
} from '@workspace/shared';
import type { Medication } from '@/types/medications';

/** Conservative compatibility for servers predating the additive diagnostic. */
export function legacyModelAvailability(
  med: Medication,
  response: SerumCurveResponse,
  historyCount: number | undefined
): SerumModelAvailability {
  // An actual curve or a server-resolved profile must not be rejected because
  // this client does not know a newer server's catalogue entry.
  if (response.curve.length) return { status: 'available', reason: null };
  const drug = med.custom_fields?.['glp1_drug'];
  const known =
    resolveGlp1Profile(med.name) ??
    (typeof drug === 'string' ? resolveGlp1Profile(drug) : undefined);
  const custom =
    !known &&
    drug === 'custom' &&
    (!response.drugId || response.drugId === 'custom');
  const customValid =
    !custom ||
    [
      Number(med.custom_fields?.['custom_half_life_days']) || 7,
      Number(med.custom_fields?.['custom_t_max_days']) || 1.5,
    ].every((value) => Number.isFinite(value) && value > 0);
  if (!response.drugId && !known && !custom)
    return { status: 'unavailable', reason: 'unresolved_profile' };
  if (customValid && historyCount === 0 && response.doseDays.length === 0)
    return { status: 'no_logged_history', reason: null };
  // Empty data with a resolved model is insufficient to name a missing/invalid
  // parameter. Only authoritative metadata identifies invalid fields.
  return { status: 'unavailable', reason: null };
}
