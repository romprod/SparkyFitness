import type { MedicationDeviceType } from './draw.ts';

export type PreparedMedicationRoute = 'injection' | 'nasal';

/** Stored medication identity, never the selected device, determines the route. */
export function resolvePreparedMedicationRoute(medication: {
  type_id?: string | null;
  route_id?: string | null;
}): PreparedMedicationRoute | null {
  if (medication.route_id === 'nasal') return 'nasal';
  if (medication.route_id === 'oral') return null;
  if (!medication.route_id && medication.type_id === 'nasal_spray')
    return 'nasal';
  if (
    medication.type_id === 'injection' &&
    (!medication.route_id ||
      medication.route_id === 'subcutaneous' ||
      medication.route_id === 'intramuscular')
  )
    return 'injection';
  return null;
}

export function isDeviceEligibleForRoute(
  deviceType: MedicationDeviceType | undefined,
  route: PreparedMedicationRoute | null
) {
  return route === 'nasal'
    ? deviceType === 'pump'
    : route === 'injection' && deviceType !== 'pump';
}

/** Explicit BUD versus the viewer's current local calendar day; never blocks logging. */
export function preparationBudNotice(
  budDate: string | null | undefined,
  todayLocal: string
): { state: 'approaching' | 'passed'; daysRemaining: number } | null {
  const dayMs = (day: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const [year, month, date] = day.split('-').map(Number);
    const ms = Date.UTC(year!, month! - 1, date!);
    const parsed = new Date(ms);
    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === date
      ? ms
      : null;
  };
  const bud = budDate ? dayMs(budDate) : null;
  const today = dayMs(todayLocal);
  if (bud === null || today === null) return null;
  const daysRemaining = Math.round((bud - today) / 86_400_000);
  if (daysRemaining < 0) return { state: 'passed', daysRemaining };
  return daysRemaining <= 3 ? { state: 'approaching', daysRemaining } : null;
}
