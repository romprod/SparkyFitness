import type { BodyCompScan } from '@workspace/shared';

/**
 * The scale (bioimpedance) background for the DEXA series, after Pitstop's body-comp-core: the
 * scale's body fat is offset to the latest DEXA, and its weight is cleaned of outliers. A
 * background is never a measurement. Pure: no React, no clock.
 */

const DAY_MS = 86_400_000;
/** How many days of scale readings are read. */
export const SCALE_DAYS = 180;
/** A scale reading this far (kg) from its neighbours' median, or from the offset's anchor, is left out. */
export const SCALE_OUTLIER_KG = 3;

export interface ScaleReading {
  day: string;
  bodyFatPct: number | null;
  weightKg: number | null;
}

/** The check-in fields the scale background reads. */
export interface ScaleRow {
  entry_date: string;
  weight?: number | null;
  body_fat_percentage?: number | null;
}

const dayDiff = (a: string, b: string): number =>
  Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS
  );

/** One reading per day, oldest first; of two rows on one day the one with a body fat wins. */
export function scaleReadings(rows: readonly ScaleRow[]): ScaleReading[] {
  const byDay = new Map<string, ScaleReading>();
  for (const row of rows) {
    const day = row.entry_date.slice(0, 10);
    const reading: ScaleReading = {
      day,
      weightKg: row.weight ?? null,
      bodyFatPct: row.body_fat_percentage ?? null,
    };
    if (reading.weightKg === null && reading.bodyFatPct === null) continue;
    const current = byDay.get(day);
    if (current && current.bodyFatPct !== null && reading.bodyFatPct === null)
      continue;
    byDay.set(day, reading);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The scale reading with a body fat nearest the scan's day, within one day, and the points the scan
 * reads above it. The anchor weight is that reading's weight.
 */
export function biaOffset(
  scanPctFat: number,
  scale: readonly ScaleReading[],
  scanDay: string
): {
  offsetPts: number;
  scaleDay: string;
  anchorWeightKg: number | null;
} | null {
  const nearest = scale
    .filter(
      (s) => s.bodyFatPct !== null && Math.abs(dayDiff(s.day, scanDay)) <= 1
    )
    .sort(
      (x, y) =>
        Math.abs(dayDiff(x.day, scanDay)) - Math.abs(dayDiff(y.day, scanDay))
    )[0];
  if (!nearest || nearest.bodyFatPct === null) return null;
  return {
    offsetPts: Math.round((scanPctFat - nearest.bodyFatPct) * 10) / 10,
    scaleDay: nearest.day,
    anchorWeightKg: nearest.weightKg,
  };
}

/** Scale body fat plus the offset; null where the reading's weight is over 3 kg from the anchor's. */
export function calibrateBia(
  series: readonly ScaleReading[],
  offsetPts: number,
  anchorWeightKg: number | null
): { day: string; calibratedPct: number | null }[] {
  return series.map((s) => ({
    day: s.day,
    calibratedPct:
      s.bodyFatPct === null ||
      (anchorWeightKg !== null &&
        s.weightKg !== null &&
        Math.abs(s.weightKg - anchorWeightKg) > SCALE_OUTLIER_KG)
        ? null
        : s.bodyFatPct + offsetPts,
  }));
}

/** Each reading against the median of up to three neighbours each side; over 3 kg from it is excluded. */
export function cleanWeightSeries(
  rows: readonly { day: string; weightKg: number | null }[]
): {
  kept: { day: string; weightKg: number }[];
  excluded: { day: string; weightKg: number }[];
} {
  const sorted = rows
    .filter((r): r is { day: string; weightKg: number } => r.weightKg !== null)
    .sort((a, b) => a.day.localeCompare(b.day));
  const kept: typeof sorted = [];
  const excluded: typeof sorted = [];
  sorted.forEach((row, i) => {
    const lo = Math.max(0, i - 3);
    const hi = Math.min(sorted.length, i + 4);
    const window = sorted
      .slice(lo, hi)
      .filter((_, j) => lo + j !== i)
      .map((x) => x.weightKg)
      .sort((a, b) => a - b);
    const median = window.length
      ? window[Math.floor(window.length / 2)]!
      : row.weightKg;
    (Math.abs(row.weightKg - median) > SCALE_OUTLIER_KG ? excluded : kept).push(
      row
    );
  });
  return { kept, excluded };
}

export interface ScaleBackground {
  /** Points the latest DEXA reads above the scale, with the day of the reading it was taken from. */
  offsetPts: number | null;
  scaleDay: string | null;
  weight: ReturnType<typeof cleanWeightSeries>;
  /** Scale body fat plus the offset; empty without an offset. */
  calibrated: { day: string; calibratedPct: number | null }[];
  /** The scale's own body fat readings. */
  raw: { day: string; bodyFatPct: number }[];
}

/** The background from the scale readings and the scans; null when there are no readings. */
export function buildScaleBackground(
  readings: readonly ScaleReading[],
  scans: readonly Pick<BodyCompScan, 'scanned_day' | 'pct_fat'>[]
): ScaleBackground | null {
  if (readings.length === 0) return null;
  const latest = [...scans].sort((a, b) =>
    a.scanned_day.localeCompare(b.scanned_day)
  )[scans.length - 1];
  const offset = latest
    ? biaOffset(latest.pct_fat, readings, latest.scanned_day)
    : null;
  return {
    offsetPts: offset?.offsetPts ?? null,
    scaleDay: offset?.scaleDay ?? null,
    weight: cleanWeightSeries(readings),
    calibrated: offset
      ? calibrateBia(readings, offset.offsetPts, offset.anchorWeightKg)
      : [],
    raw: readings.flatMap((r) =>
      r.bodyFatPct === null ? [] : [{ day: r.day, bodyFatPct: r.bodyFatPct }]
    ),
  };
}
