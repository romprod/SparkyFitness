import {
  daysBetween,
  type LabComparisonPanel,
  type LabComparisonResult,
  type LabMarkerResponse,
} from '@workspace/shared';
import { labNumber } from './labFormat';
import { labResultFlag, type LabResultFlag } from './labOptimal';

/**
 * The bloodwork panel nearest the latest scan, after Pitstop's bodycomp-labs and nearestLabs step:
 * a fixed subset in a fixed order, each row matched first by Sparky's own marker key and, for a
 * custom-named result, by Pitstop's token-boundary name aliases. Pure.
 */

/** A panel drawn weeks from the scan is not a scan-day panel, so the distance is always printed. */
export const LAB_WINDOW_DAYS = 30;

export interface LabSubsetDef {
  label: string;
  /** The built-in marker key Sparky stores for this marker. */
  markerKey: string;
  /** Names a custom-named result may carry, most specific first. */
  aliases: string[];
  /** A name holding one of these tokens is never this row. */
  exclude?: string[];
}

export const LAB_SUBSET: LabSubsetDef[] = [
  {
    label: 'IGF-1',
    markerKey: 'igf_1',
    aliases: ['igf-1', 'igf1', 'igf 1'],
  },
  {
    label: 'Total testosterone',
    markerKey: 'testosterone',
    aliases: ['testosterone'],
    exclude: ['free'],
  },
  {
    label: 'Free testosterone',
    markerKey: 'free_testosterone',
    aliases: ['free testosterone', 'free t'],
    exclude: ['t3', 't4'],
  },
  { label: 'SHBG', markerKey: 'shbg', aliases: ['shbg'] },
  { label: 'TSH', markerKey: 'tsh', aliases: ['tsh'] },
  {
    label: 'Free T4',
    markerKey: 'free_t4',
    aliases: ['free t4', 'ft4'],
  },
  {
    label: 'Free T3',
    markerKey: 'free_t3',
    aliases: ['free t3', 'ft3'],
  },
  { label: 'ALT', markerKey: 'alt', aliases: ['alt'] },
  {
    label: 'AST',
    markerKey: 'ast',
    aliases: ['ast'],
    exclude: ['fasting', 'glucose'],
  },
  { label: 'HbA1c', markerKey: 'hba1c', aliases: ['hba1c'] },
  { label: 'Insulin', markerKey: 'fasting_insulin', aliases: ['insulin'] },
  {
    label: 'hsCRP',
    markerKey: 'crp',
    // Most specific first: the lowest index wins when a panel holds both "CRP" and an hs variant.
    aliases: ['hscrp', 'hs-crp', 'hs crp', 'crp hs', 'crp'],
  },
  { label: 'Ferritin', markerKey: 'ferritin', aliases: ['ferritin'] },
  {
    label: 'Vitamin D',
    markerKey: 'vitamin_d',
    aliases: ['vitamin d', 'vitamin d3', '25-oh', '25 oh'],
  },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-case, every non-alphanumeric run collapsed to one space, trimmed. */
export function normaliseLabName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `token` appears in the normalised name on word boundaries, so "free t" cannot hit "Free T4". */
function hasToken(normalised: string, token: string): boolean {
  const t = normaliseLabName(token);
  if (!t) return false;
  return new RegExp(`(^| )${escapeRe(t)}( |$)`).test(normalised);
}

/**
 * The index of the first alias of `def` that `name` matches (aliases are listed most specific
 * first), or null when it matches none or holds an excluded token. Lower is more specific.
 */
export function labAliasRank(name: string, def: LabSubsetDef): number | null {
  const normalised = normaliseLabName(name);
  if (def.exclude?.some((x) => hasToken(normalised, x))) return null;
  const index = def.aliases.findIndex((alias) => hasToken(normalised, alias));
  return index < 0 ? null : index;
}

export interface NearestLabRow {
  label: string;
  status: 'present' | 'not_in_panel' | 'never_measured';
  /** The numeric value as stored, or null for a text result. */
  value: number | null;
  valueText: string | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  /** From the lab range and the optimal band; null unless present. */
  flag: LabResultFlag | null;
}
export interface NearestLabs {
  panelId: string;
  panelDay: string;
  /** Signed: negative means drawn before the scan. */
  daysFromScan: number;
  labName: string | null;
  notes: string | null;
  rows: NearestLabRow[];
}

/**
 * The panel whose collection day is closest to the scan day, within the window either side. On a
 * tie the earlier panel wins. A panel with no collection day is never nearest.
 */
export function findNearestPanel<
  P extends Pick<LabComparisonPanel, 'id' | 'collected_on'>,
>(
  panels: readonly P[],
  scanDay: string,
  windowDays: number = LAB_WINDOW_DAYS
): P | null {
  let best: { panel: P; dist: number; day: string } | null = null;
  for (const panel of panels) {
    if (!panel.collected_on) continue;
    const dist = Math.abs(daysBetween(scanDay, panel.collected_on));
    if (dist > windowDays) continue;
    if (
      !best ||
      dist < best.dist ||
      (dist === best.dist && panel.collected_on < best.day)
    )
      best = { panel, dist, day: panel.collected_on };
  }
  return best?.panel ?? null;
}

const markerName = (
  result: Pick<LabComparisonResult, 'marker_key' | 'custom_marker_id'>,
  custom: ReadonlyMap<string, string>
): string | null =>
  result.marker_key
    ? null
    : (custom.get(result.custom_marker_id ?? '') ?? null);

/**
 * The result in `results` that belongs to the row: one stored under the row's own marker key, else
 * the custom-named result whose name matches the most specific alias.
 */
export function matchLabResult<
  R extends Pick<LabComparisonResult, 'marker_key' | 'custom_marker_id'>,
>(
  results: readonly R[],
  def: LabSubsetDef,
  custom: ReadonlyMap<string, string>
): R | null {
  const byKey = results.find((r) => r.marker_key === def.markerKey);
  if (byKey) return byKey;
  let hit: R | null = null;
  let hitRank = Infinity;
  for (const result of results) {
    const name = markerName(result, custom);
    if (name === null) continue;
    const rank = labAliasRank(name, def);
    if (rank !== null && rank < hitRank) {
      hit = result;
      hitRank = rank;
    }
  }
  return hit;
}

/**
 * The nearest panel to the scan with the fixed subset's rows, or null when no panel is within the
 * window. A row is "not measured in this panel" when the marker appears in some other panel and
 * "never measured" when it appears in none.
 */
export function buildNearestLabs(
  panels: readonly LabComparisonPanel[],
  customMarkers: readonly Pick<LabMarkerResponse, 'id' | 'name'>[],
  scanDay: string
): NearestLabs | null {
  const panel = findNearestPanel(panels, scanDay);
  if (!panel || !panel.collected_on) return null;
  const custom = new Map(customMarkers.map((m) => [m.id, m.name]));
  const everResults = panels.flatMap((p) => p.results);
  const rows: NearestLabRow[] = LAB_SUBSET.map((def) => {
    const hit = matchLabResult(panel.results, def, custom);
    if (hit) {
      return {
        label: def.label,
        status: 'present',
        value: hit.value_numeric,
        valueText: hit.value_text,
        unit: hit.unit,
        referenceLow: hit.ref_range_low,
        referenceHigh: hit.ref_range_high,
        flag: labResultFlag(hit, { ref_range_low: null, ref_range_high: null }),
      };
    }
    const ever = matchLabResult(everResults, def, custom) !== null;
    return {
      label: def.label,
      status: ever ? 'not_in_panel' : 'never_measured',
      value: null,
      valueText: null,
      unit: null,
      referenceLow: null,
      referenceHigh: null,
      flag: null,
    };
  });
  return {
    panelId: panel.id,
    panelDay: panel.collected_on,
    daysFromScan: daysBetween(scanDay, panel.collected_on),
    labName: panel.lab_name,
    notes: panel.notes?.trim() ? panel.notes : null,
    rows,
  };
}

/** "4–5.6", "≥ 49" or "≤ 4"; a one-sided range never prints a dangling dash. */
export const referenceText = (
  low: number | null,
  high: number | null
): string | null =>
  low !== null && high !== null
    ? `${labNumber(low)}–${labNumber(high)}`
    : low !== null
      ? `≥ ${labNumber(low)}`
      : high !== null
        ? `≤ ${labNumber(high)}`
        : null;
