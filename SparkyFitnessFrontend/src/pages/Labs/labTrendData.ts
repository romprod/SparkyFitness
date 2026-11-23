import {
  buildLabComparison,
  exactLabResultValue,
  sameLabUnit,
  type LabComparisonPanel,
  type LabMarkerLabels,
  type LabMarkerResponse,
  type LabRangeStatus,
  type LabSex,
} from '@workspace/shared';

/** How the newest panel's exact numbers sit against their reference ranges. */
export interface LabSummary {
  /** Results with an exact number and a usable range, inside it. */
  inRange: number;
  /** Results with an exact number and a usable range, below or above it. */
  outOfRange: number;
  /** Exact numbers with no range to judge them by; never counted as in range. */
  noRange: number;
  /** inRange + outOfRange: the figure "N of M in range" is out of. */
  judged: number;
  /** Markers whose newest reading is closer to its range than the prior panel's. */
  improving: number;
}

/**
 * The newest panel against the one before it. Read from the same comparison the
 * table shows, so the card and the table can never disagree. Qualified or text
 * results (">90", "<1") carry no exact number and are left out of every count.
 */
export const summariseLatestPanel = (
  rows: ReturnType<typeof buildLabComparison>['rows']
): LabSummary => {
  const summary: LabSummary = {
    inRange: 0,
    outOfRange: 0,
    noRange: 0,
    judged: 0,
    improving: 0,
  };
  for (const row of rows) {
    const cell = row.cells[0];
    if (!cell?.result || exactLabResultValue(cell.result) === null) continue;
    if (cell.status === 'in_range') summary.inRange += 1;
    else if (cell.status === 'low' || cell.status === 'high')
      summary.outOfRange += 1;
    else summary.noRange += 1;
    if (cell.improved) summary.improving += 1;
  }
  summary.judged = summary.inRange + summary.outOfRange;
  return summary;
};

export interface LabTrendPoint {
  day: string;
  value: number;
  status: LabRangeStatus;
}

/** One marker's exact readings across every saved panel, oldest first. */
export interface LabTrend {
  id: string;
  name: string;
  unit: string;
  low: number | null;
  high: number | null;
  points: LabTrendPoint[];
  latest: LabTrendPoint;
}

const markerKeyOf = (id: string) =>
  id.startsWith('builtin:') ? id.slice('builtin:'.length) : null;

/**
 * Per-marker series for the trend cards. Each panel is read through the same
 * comparison as the table (its unit, range and status rules), one reading per
 * marker per panel. Readings in another unit than the newest one are left out,
 * as the single-marker chart does, and only markers with two or more readings
 * are returned: a single dot is not a trend.
 */
export const buildLabTrends = (
  panels: LabComparisonPanel[],
  customMarkers: LabMarkerResponse[],
  labels: LabMarkerLabels,
  sex: LabSex | null
): LabTrend[] => {
  type Reading = LabTrendPoint & {
    unit: string;
    low: number | null;
    high: number | null;
  };
  const byMarker = new Map<string, { name: string; readings: Reading[] }>();
  for (const panel of panels) {
    const { rows } = buildLabComparison([panel], customMarkers, labels, sex);
    for (const row of rows) {
      const cell = row.cells[0];
      if (!cell?.result) continue;
      const value = exactLabResultValue(cell.result);
      if (value === null) continue;
      const entry = byMarker.get(row.id) ?? { name: row.name, readings: [] };
      entry.readings.push({
        day: panel.collected_on ?? cell.result.entry_date,
        value,
        status: cell.status,
        unit: cell.unit,
        low: cell.range.low,
        high: cell.range.high,
      });
      byMarker.set(row.id, entry);
    }
  }
  const trends: LabTrend[] = [];
  for (const [id, { name, readings }] of byMarker) {
    readings.sort((a, b) => a.day.localeCompare(b.day));
    const newest = readings[readings.length - 1];
    if (!newest) continue;
    const key = markerKeyOf(id);
    const same = readings.filter((r) => sameLabUnit(r.unit, newest.unit, key));
    if (same.length < 2) continue;
    trends.push({
      id,
      name,
      unit: newest.unit,
      low: newest.low,
      high: newest.high,
      points: same.map(({ day, value, status }) => ({ day, value, status })),
      latest: { day: newest.day, value: newest.value, status: newest.status },
    });
  }
  // Markers that need a look come first, then the rest by name.
  const needsLook = (t: LabTrend) =>
    t.latest.status === 'low' || t.latest.status === 'high' ? 0 : 1;
  return trends.sort(
    (a, b) => needsLook(a) - needsLook(b) || a.name.localeCompare(b.name)
  );
};
