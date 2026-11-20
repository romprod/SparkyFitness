/**
 * An invoice line imported without a medication cannot match any vial. When the line's
 * description names exactly one of the person's medications, that one is the likely answer, so the
 * form can start from it. It is only a starting point: the person checks it and saves.
 */
export function suggestMedicationForLine<
  M extends { id: string; name: string },
>(description: string, medications: readonly M[]): M | null {
  const text = description.toLowerCase();
  const found = medications.filter((med) => {
    const name = med.name.trim().toLowerCase();
    return name.length >= 3 && text.includes(name);
  });
  if (found.length === 0) return null;
  // A longer name that contains a shorter one is the better match.
  const longest = Math.max(...found.map((med) => med.name.trim().length));
  const best = found.filter((med) => med.name.trim().length === longest);
  return best.length === 1 ? best[0]! : null;
}
