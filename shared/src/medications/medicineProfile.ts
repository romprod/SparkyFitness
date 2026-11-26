/**
 * Pitstop's medicine profile labels, kept in the medication's custom fields: other names it goes
 * by, free-text storage notes, and whether amounts are labelled in mass or IU. The substance
 * class is a label only; no amount is ever converted between mass and IU.
 */

export type SubstanceClass = 'mass' | 'IU';

export const SUBSTANCE_CLASSES: readonly SubstanceClass[] = ['mass', 'IU'];
export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 100;
export const MAX_STORAGE_NOTES_LENGTH = 500;

function fieldsOf(customFields: unknown): Record<string, unknown> {
  return customFields && typeof customFields === 'object'
    ? (customFields as Record<string, unknown>)
    : {};
}

/** Trim, drop blanks, de-duplicate case-insensitively, and cap the count and length. */
export function normalizeAliases(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const alias = value.trim().slice(0, MAX_ALIAS_LENGTH).trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

/** Split a comma-separated input into aliases. */
export function parseAliases(text: string): string[] {
  return normalizeAliases(text.split(','));
}

export function readAliases(customFields: unknown): string[] {
  const raw = fieldsOf(customFields)['aliases'];
  return Array.isArray(raw) ? normalizeAliases(raw) : [];
}

export function normalizeStorageNotes(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_STORAGE_NOTES_LENGTH).trim();
  return trimmed || null;
}

export function readStorageNotes(customFields: unknown): string | null {
  return normalizeStorageNotes(fieldsOf(customFields)['storage_notes']);
}

/** Absent or unrecognised means mass. */
export function readSubstanceClass(customFields: unknown): SubstanceClass {
  return fieldsOf(customFields)['substance_class'] === 'IU' ? 'IU' : 'mass';
}

/**
 * Return `fields` with the profile keys set from the given values. A key is removed when its
 * value is empty (no aliases, blank notes, mass), and every other key is kept as it was.
 */
export function withMedicineProfile(
  fields: Record<string, unknown>,
  profile: {
    aliases?: readonly string[];
    storageNotes?: string | null;
    substanceClass?: SubstanceClass | null;
  }
): Record<string, unknown> {
  const next = { ...fields };
  delete next['aliases'];
  delete next['storage_notes'];
  delete next['substance_class'];
  const aliases = normalizeAliases(profile.aliases ?? []);
  if (aliases.length > 0) next['aliases'] = aliases;
  const notes = normalizeStorageNotes(profile.storageNotes);
  if (notes) next['storage_notes'] = notes;
  if (profile.substanceClass === 'IU') next['substance_class'] = 'IU';
  return next;
}

/** Whole-string, case-insensitive match on name, display name or any alias. */
export function medicationMatchesName(
  med: {
    name?: string | null;
    display_name?: string | null;
    custom_fields?: unknown;
  },
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return [med.name, med.display_name, ...readAliases(med.custom_fields)].some(
    (candidate) =>
      typeof candidate === 'string' && candidate.trim().toLowerCase() === needle
  );
}
