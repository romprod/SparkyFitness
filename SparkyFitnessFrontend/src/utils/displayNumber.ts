/**
 * Rounds an exact decimal for display only, so a review screen reads "3.33 mg/mL" rather than
 * "3.3333333333333333". The stored and calculated values stay exact; callers pass the exact
 * value on to the server unchanged.
 */
export function displayQuantity(
  value: string | number | null | undefined,
  maxDecimals = 2
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const rounded = n.toFixed(maxDecimals);
  // A value that rounds to zero keeps one more digit so a small amount is not shown as 0.
  const text = Number(rounded) === 0 && n !== 0 ? n.toPrecision(2) : rounded;
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** A dose count: whole doses only, rounded down, since a part dose cannot be drawn. */
export function displayWholeDoses(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.floor(n + 1e-9)) : String(value);
}
