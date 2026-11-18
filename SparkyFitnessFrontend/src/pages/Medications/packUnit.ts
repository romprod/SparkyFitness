import type { Medication } from '@/types/medications';

/** The unit a new pack starts with: the medication's own dose unit, as a plural word. */
export function defaultPackUnit(medication: Medication | undefined): string {
  const word = (medication?.dose_unit ?? '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase();
  if (!word) return '';
  return word.endsWith('s') ? word : `${word}s`;
}
