import {
  LAB_MARKER_PRESETS,
  labPresetRange,
  labRangeStatus,
  type LabRangeStatus,
  type LabSex,
} from '../constants/labMarkers.ts';
import type {
  LabComparisonPanel,
  LabComparisonResult,
  LabMarkerResponse,
} from '../schemas/api/LabResults.api.zod.ts';
import {
  builtinMarkerId,
  customMarkerId,
  effectiveLabRange,
  labPresetName,
  parseLabValue,
  sameLabUnit,
  type LabMarkerLabels,
} from './labResults.ts';

type Range = { low: number | null; high: number | null };
export interface LabComparisonCell {
  result: LabComparisonResult | null;
  unit: string;
  range: Range;
  status: LabRangeStatus;
  improved: 'up' | 'down' | null;
}
export interface LabComparisonRow {
  id: string;
  name: string;
  unit: string;
  range: Range;
  cells: LabComparisonCell[];
}
const rowId = (r: LabComparisonResult) =>
  r.marker_key
    ? builtinMarkerId(r.marker_key)
    : r.custom_marker_id
      ? customMarkerId(r.custom_marker_id)
      : null;
/** A qualified/text result remains text, never a fabricated exact measurement. */
function exactNumber(result: LabComparisonResult): number | null {
  if (result.value_numeric === null || !Number.isFinite(result.value_numeric))
    return null;
  if (
    result.value_text?.trim() &&
    parseLabValue(result.value_text) !== result.value_numeric
  )
    return null;
  return result.value_numeric;
}
function validRange(range: Range) {
  return (
    [range.low, range.high].every(
      (bound) => bound === null || Number.isFinite(bound)
    ) &&
    (range.low === null || range.high === null || range.low <= range.high)
  );
}
function distance(value: number, range: Range) {
  if (range.low !== null && value < range.low) return range.low - value;
  if (range.high !== null && value > range.high) return value - range.high;
  return 0;
}
/** Presentation state only: no unit conversion, inferred report grouping or assay merging. */
export function buildLabComparison(
  input: LabComparisonPanel[],
  customMarkers: LabMarkerResponse[],
  labels: LabMarkerLabels = {},
  sex: LabSex | null = null
): { panels: LabComparisonPanel[]; rows: LabComparisonRow[] } {
  const panels = [...input]
    .sort((a, b) => {
      if (a.collected_on === null && b.collected_on !== null) return 1;
      if (b.collected_on === null && a.collected_on !== null) return -1;
      return (
        (b.collected_on ?? '').localeCompare(a.collected_on ?? '') ||
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id)
      );
    })
    .slice(0, 3);
  const byPanel = panels.map((panel) => {
    const map = new Map<string, LabComparisonResult>();
    for (const result of panel.results) {
      const id = rowId(result);
      if (id && !map.has(id)) map.set(id, result);
    }
    return map;
  });
  const ids = new Set(byPanel.flatMap((panel) => [...panel.keys()]));
  const rows: LabComparisonRow[] = [];
  for (const id of ids) {
    const latest = byPanel
      .map((panel) => panel.get(id))
      .find((r): r is LabComparisonResult => r !== undefined);
    if (!latest) continue;
    const preset = latest.marker_key
      ? LAB_MARKER_PRESETS.find((p) => p.key === latest.marker_key)
      : undefined;
    const custom = customMarkers.find((m) => m.id === latest.custom_marker_id);
    const presetRange = preset
      ? labPresetRange(preset, sex)
      : { low: null, high: null };
    const fallback = {
      ref_range_low: custom?.ref_range_low ?? presetRange.low,
      ref_range_high: custom?.ref_range_high ?? presetRange.high,
      ref_range_unit: custom?.unit ?? preset?.unit ?? '',
      markerKey: latest.marker_key,
    };
    const cells: LabComparisonCell[] = byPanel.map((panel) => {
      const result = panel.get(id) ?? null;
      if (!result)
        return {
          result: null,
          unit: '',
          range: { low: null, high: null },
          status: 'unknown',
          improved: null,
        };
      const range = effectiveLabRange(result, fallback);
      const value = exactNumber(result);
      return {
        result,
        unit:
          result.unit ||
          (result.ref_range_low === null && result.ref_range_high === null
            ? fallback.ref_range_unit
            : ''),
        range,
        status:
          value === null || !validRange(range)
            ? 'unknown'
            : labRangeStatus(value, range.low, range.high),
        improved: null,
      };
    });
    const now = cells[0],
      prior = cells[1];
    if (
      now?.result &&
      prior?.result &&
      now.unit.trim() !== '' &&
      prior.unit.trim() !== '' &&
      sameLabUnit(now.unit, prior.unit, latest.marker_key)
    ) {
      const current = exactNumber(now.result),
        previous = exactNumber(prior.result);
      const range =
        now.range.low !== null || now.range.high !== null
          ? now.range
          : prior.range;
      if (
        current !== null &&
        previous !== null &&
        validRange(range) &&
        distance(current, range) < distance(previous, range)
      )
        now.improved = current >= previous ? 'up' : 'down';
    }
    rows.push({
      id,
      name: preset ? labPresetName(preset, labels) : (custom?.name ?? id),
      unit: cells.find((c) => c.result !== null)?.unit ?? '',
      range: effectiveLabRange(latest, fallback),
      cells,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { panels, rows };
}
