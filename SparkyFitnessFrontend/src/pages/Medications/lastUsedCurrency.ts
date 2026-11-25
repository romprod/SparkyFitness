/** A list row that carries a currency and the instant it was created. */
type CurrencyRow = { currency: string | null; created_at: string };

/**
 * The currency of the most recently created prescription or invoice, or
 * undefined when there is none. Both list rows carry `created_at`, so the two
 * lists compare on the same clock. A row whose timestamp cannot be parsed
 * still counts, but loses to any row with a valid one.
 */
export function latestMedicationCurrency(
  ...lists: (readonly CurrencyRow[] | undefined)[]
): string | undefined {
  let best: { currency: string; at: number } | undefined;
  for (const list of lists)
    for (const row of list ?? []) {
      const currency = row.currency?.trim();
      if (!currency) continue;
      const parsed = Date.parse(row.created_at);
      const at = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
      if (!best || at > best.at) best = { currency, at };
    }
  return best?.currency;
}
