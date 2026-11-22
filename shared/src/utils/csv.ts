/**
 * Minimal RFC 4180 CSV writer, as Pitstop's export uses: a field is quoted only when it holds a
 * comma, a quote or a line break; quotes are doubled; null and undefined are empty; records end
 * with CRLF, including the last, which spreadsheets read cleanly.
 *
 * One addition: text that begins with = + - @ or a control character is prefixed with an
 * apostrophe, so a spreadsheet shows it as text instead of running it as a formula. Free text such
 * as notes can hold anything. A real number, or text that is only a plain number, is left alone.
 */
export type CsvCell = string | number | boolean | null | undefined;

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (
    typeof value === 'string' &&
    FORMULA_START.test(text) &&
    !PLAIN_NUMBER.test(text)
  )
    text = `'${text}`;
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[]
): string {
  return (
    [headers, ...rows]
      .map((row) => row.map((cell) => csvField(cell)).join(','))
      .join('\r\n') + '\r\n'
  );
}
