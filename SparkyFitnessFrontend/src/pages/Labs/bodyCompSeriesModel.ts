import {
  DEFAULT_BODY_COMP_PRECISION,
  LSC_K,
  bodyCompIndices,
  rmrNoiseBand,
  type BodyCompBand,
  type BodyCompPrecision,
  type BodyCompScan,
  type LifeEvent,
  type MetabolicTest,
} from '@workspace/shared';

/**
 * The DEXA scan series as small multiples, after Pitstop's ScanSeries: one point per scan with a
 * technical band (the smallest change the scanner can tell from re-measuring) and a practical band
 * (wider, for a change over days) running to the next scan, or 112 days forward for the latest.
 * Pure: no React, no clock. Bands are the device-class default, not this clinic's own precision.
 */

export const DAY_MS = 86_400_000;
/** How far the latest scan's band runs forward. */
export const FORWARD_DAYS = 112;
/** Hologic Horizon A site precision for bone density, per cent, used when a report prints none. */
export const DEFAULT_BMD_CV_PCT = 1.0;

export type SeriesPanelKey =
  'fat' | 'lean' | 'pctFat' | 'alm' | 'vat' | 'bmd' | 'rmr' | 'weight';

export interface SeriesPoint {
  /** Midnight UTC of the scan or test day, in ms. */
  t: number;
  day: string;
  v: number;
  /** Null when no noise band is defined (clinic weight). */
  band: BodyCompBand | null;
}
export interface SeriesPanel {
  key: SeriesPanelKey;
  /** English default; the component translates by key. */
  title: string;
  unit: string;
  digits: number;
  /** Oldest first. */
  points: SeriesPoint[];
}

export const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
/** The day string of a millisecond time, in UTC. */
export const msDay = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

const lscAbs = (value: number, cvPct: number) =>
  ((value * cvPct) / 100) * LSC_K;

/** Bone density noise from the report's own site CV when it printed one, else the default. */
export function bmdNoiseBand(
  bmdGcm2: number,
  cvPct: number | null | undefined
): BodyCompBand {
  const cv = cvPct !== null && cvPct !== undefined && cvPct > 0 ? cvPct : null;
  return {
    technical: lscAbs(bmdGcm2, cv ?? DEFAULT_BMD_CV_PCT),
    practical: null,
  };
}

/** The scans oldest first, whichever way they arrive. */
export const scansOldestFirst = <T extends Pick<BodyCompScan, 'scanned_day'>>(
  scans: readonly T[]
): T[] => [...scans].sort((a, b) => a.scanned_day.localeCompare(b.scanned_day));

/**
 * The panels, in Pitstop's order, each with only the points that exist. A panel with no point is
 * left out. Weight is the clinic's scale weight at each scan and has no band.
 */
export function buildSeriesPanels(
  scans: readonly BodyCompScan[],
  tests: readonly Pick<MetabolicTest, 'tested_day' | 'measured_rmr_kcal'>[],
  precision: BodyCompPrecision = DEFAULT_BODY_COMP_PRECISION
): SeriesPanel[] {
  const ordered = scansOldestFirst(scans);
  const scanPanel = (
    key: SeriesPanelKey,
    title: string,
    unit: string,
    digits: number,
    get: (scan: BodyCompScan) => { v: number | null; band: BodyCompBand | null }
  ): SeriesPanel => ({
    key,
    title,
    unit,
    digits,
    points: ordered.flatMap((scan) => {
      const { v, band } = get(scan);
      return v === null
        ? []
        : [{ t: dayMs(scan.scanned_day), day: scan.scanned_day, v, band }];
    }),
  });
  const fatBand = (kg: number): BodyCompBand => {
    const technical = lscAbs(kg, precision.fat_cv_pct);
    return {
      technical,
      practical: technical * precision.practical_fat_multiplier,
    };
  };
  const leanBand = (kg: number): BodyCompBand => {
    const technical = lscAbs(kg, precision.lean_cv_pct);
    return {
      technical,
      practical: technical * precision.practical_lean_multiplier,
    };
  };
  const rmrTests = [...tests].sort((a, b) =>
    a.tested_day.localeCompare(b.tested_day)
  );
  const panels: SeriesPanel[] = [
    scanPanel('fat', 'Fat mass', 'kg', 2, (s) => ({
      v: s.total_fat_g / 1000,
      band: fatBand(s.total_fat_g / 1000),
    })),
    scanPanel('lean', 'Lean mass', 'kg', 2, (s) => ({
      v: s.total_lean_g / 1000,
      band: leanBand(s.total_lean_g / 1000),
    })),
    scanPanel('pctFat', 'Body fat', '%', 1, (s) => ({
      v: s.pct_fat,
      band: {
        technical: precision.pct_fat_lsc_abs,
        practical:
          precision.pct_fat_lsc_abs * precision.practical_lean_multiplier,
      },
    })),
    scanPanel('alm', 'Appendicular lean (ALM)', 'kg', 2, (s) => {
      const alm = bodyCompIndices(s).alm_kg;
      return {
        v: alm,
        band:
          alm === null
            ? null
            : { technical: lscAbs(alm, precision.alm_cv_pct), practical: null },
      };
    }),
    scanPanel('vat', 'Visceral fat (VAT)', 'g', 0, (s) => {
      const technical =
        s.vat_mass_g === null
          ? null
          : lscAbs(s.vat_mass_g, precision.vat_cv_pct);
      return {
        v: s.vat_mass_g,
        band:
          technical === null ? null : { technical, practical: technical * 2 },
      };
    }),
    scanPanel('bmd', 'Total BMD', 'g/cm²', 3, (s) => ({
      v: s.total_bmd_gcm2,
      band:
        s.total_bmd_gcm2 === null
          ? null
          : bmdNoiseBand(s.total_bmd_gcm2, s.bmd_cv_pct),
    })),
    {
      key: 'rmr',
      title: 'Resting metabolic rate',
      unit: 'kcal/d',
      digits: 0,
      points: rmrTests.map((test) => ({
        t: dayMs(test.tested_day),
        day: test.tested_day,
        v: test.measured_rmr_kcal,
        band: {
          technical: rmrNoiseBand(test.measured_rmr_kcal),
          practical: null,
        },
      })),
    },
    scanPanel('weight', 'Weight', 'kg', 1, (s) => ({
      v: s.clinic_weight_kg,
      band: null,
    })),
  ];
  return panels.filter((panel) => panel.points.length > 0);
}

/**
 * The shared time axis: from the first point of any panel to 112 days past the latest scan.
 * Life-event windows never size it.
 */
export function seriesTimeRange(
  panels: readonly SeriesPanel[],
  scans: readonly Pick<BodyCompScan, 'scanned_day'>[]
): { tMin: number; tMax: number } {
  const times = panels.flatMap((panel) => panel.points.map((p) => p.t));
  const latest = Math.max(...scans.map((s) => dayMs(s.scanned_day)));
  return {
    tMin: Math.min(...times),
    tMax: Math.max(latest + FORWARD_DAYS * DAY_MS, ...times),
  };
}

/** The value axis of one panel: its points and bands, padded; a single flat value is opened out. */
export function panelValueRange(points: readonly SeriesPoint[]): {
  lo: number;
  hi: number;
} {
  const ys: number[] = [];
  for (const point of points) {
    ys.push(point.v);
    if (point.band) {
      const width = point.band.practical ?? point.band.technical;
      ys.push(point.v + width, point.v - width);
    }
  }
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  return { lo: lo - span * 0.15, hi: hi + span * 0.15 };
}

/** Where a point's band stops: the next point, or 112 days forward for the last. */
export const bandEndTime = (
  points: readonly SeriesPoint[],
  index: number
): number => {
  const next = points[index + 1];
  if (next) return next.t;
  return (points[index]?.t ?? 0) + FORWARD_DAYS * DAY_MS;
};

/** No line joins the points until there are three scans and three points, so two never read as a slope. */
export const showSeriesLine = (
  scanCount: number,
  pointCount: number
): boolean => scanCount >= 3 && pointCount >= 3;

export interface SeriesShade {
  key: string;
  kind: LifeEvent['kind'];
  /** Start of the first day, ms. */
  t0: number;
  /** End of the last day (start of the day after), ms. */
  t1: number;
  title: string;
}

/** Windows that overlap the plotted range, as time spans; the end day is inclusive. */
export function lifeEventShades(
  events: readonly LifeEvent[],
  tMin: number,
  tMax: number
): SeriesShade[] {
  return events
    .map((event) => ({
      key: event.id,
      kind: event.kind,
      t0: dayMs(event.start_day),
      t1: dayMs(event.end_day) + DAY_MS,
      title: `${event.kind}${event.label ? `: ${event.label}` : ''} ${event.start_day} → ${event.end_day}`,
    }))
    .filter((shade) => shade.t1 > tMin && shade.t0 < tMax);
}
