import { LAB_MARKER_PRESETS } from '../constants/labMarkers.ts';
import type { LabMarkerResponse } from '../schemas/api/LabResults.api.zod.ts';
import type { LabMarkerLabels } from './labResults.ts';
import type { CreateManualLabPanelBody } from '../schemas/api/LabResults.api.zod.ts';
import { createManualLabPanelBodySchema } from '../schemas/api/LabResults.api.zod.ts';
import {
  labMarkerQueryFromId,
  parseRangeBound,
  labPresetName,
} from './labResults.ts';
import { isDayString } from './timezone.ts';

export interface LabPanelDraftRow {
  key: string;
  marker: string;
  value: string;
  unit: string;
  low: string;
  high: string;
}
export interface LabPanelDraft {
  date: string;
  labName: string;
  notes: string;
  rows: LabPanelDraftRow[];
}
export type LabPanelDraftError =
  'date' | 'future' | 'empty' | 'marker' | 'range' | 'duplicate' | 'invalid';

/** The same reviewed manual panel payload on web and native; no date buckets. */
export function buildManualLabPanel(
  draft: LabPanelDraft,
  today: string
):
  | { ok: true; body: CreateManualLabPanelBody }
  | { ok: false; error: LabPanelDraftError } {
  if (!isDayString(draft.date)) return { ok: false, error: 'date' };
  if (draft.date > today) return { ok: false, error: 'future' };
  const selected = draft.rows.filter((row) => row.value.trim());
  if (selected.length === 0) return { ok: false, error: 'empty' };
  const seen = new Set<string>();
  const results: CreateManualLabPanelBody['results'] = [];
  for (const row of selected) {
    const marker = labMarkerQueryFromId(row.marker);
    if (!marker) return { ok: false, error: 'marker' };
    if (seen.has(row.marker)) return { ok: false, error: 'duplicate' };
    seen.add(row.marker);
    const low = parseRangeBound(row.low),
      high = parseRangeBound(row.high);
    if (
      !low.ok ||
      !high.ok ||
      (low.value !== null && high.value !== null && low.value > high.value)
    )
      return { ok: false, error: 'range' };
    results.push({
      ...('markerKey' in marker
        ? { marker_key: marker.markerKey }
        : { custom_marker_id: marker.markerId }),
      value_text: row.value.trim(),
      unit: row.unit.trim(),
      ref_range_low: low.value,
      ref_range_high: high.value,
    });
  }
  const parsed = createManualLabPanelBodySchema.safeParse({
    entry_date: draft.date,
    lab_name: draft.labName.trim() || null,
    notes: draft.notes.trim() || null,
    results,
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, error: 'invalid' };
}

/** Catalog order supplies the same first-row default on both clients. */
export function labPanelMarkerOptions(
  custom: Pick<LabMarkerResponse, 'id' | 'name' | 'unit'>[],
  labels: LabMarkerLabels
) {
  return [
    ...LAB_MARKER_PRESETS.map((preset) => ({
      id: `builtin:${preset.key}`,
      name: labPresetName(preset, labels),
      unit: preset.unit,
    })),
    ...custom.map((marker) => ({
      id: `custom:${marker.id}`,
      name: marker.name,
      unit: marker.unit,
    })),
  ];
}
