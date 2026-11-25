/** Small number formatters for the DEXA card's extra panels; a true minus sign, an em dash for none. */
export const one = (n: number) => n.toFixed(1);

export const num = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toFixed(digits);

export const signed = (n: number, digits = 1): string => {
  const text = Math.abs(n).toFixed(digits);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
};

export const signedNum = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : signed(n, digits);
