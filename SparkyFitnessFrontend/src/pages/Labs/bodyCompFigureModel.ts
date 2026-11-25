import {
  DEFAULT_BODY_COMP_PRECISION,
  bodyCompComparability,
  bodyCompIndices,
  deltaFlag,
  distributionRatios,
  limbAsymmetry,
  type BodyCompBand,
  type BodyCompPrecision,
  type BodyCompRegion,
  type BodyCompRegionValues,
  type BodyCompScan,
  type ChangeTier,
} from '@workspace/shared';

/**
 * The model behind the regional distribution figure, after Pitstop's body-figure-core: a cell per
 * printed region, the whole-body totals, the distribution ratios and limb asymmetry, and each
 * region's % fat change against the previous scan, tiered with the whole-body % fat noise band.
 * Pure. Nothing here judges a value or attributes a change to anything.
 */

export const FIGURE_REGIONS = [
  'head',
  'l_arm',
  'r_arm',
  'trunk',
  'l_leg',
  'r_leg',
] as const satisfies readonly BodyCompRegion[];
export type FigureRegion = (typeof FIGURE_REGIONS)[number];
export const BAND_REGIONS = [
  'android',
  'gynoid',
] as const satisfies readonly BodyCompRegion[];

export const REGION_LABEL: Record<BodyCompRegion, string> = {
  head: 'Head',
  l_arm: 'Left arm',
  r_arm: 'Right arm',
  trunk: 'Trunk',
  l_leg: 'Left leg',
  r_leg: 'Right leg',
  android: 'Android',
  gynoid: 'Gynoid',
};

/** Regional % fat over which the fill slides from cool to warm. */
export const FAT_HUE_DOMAIN = [12, 28] as const;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** 0 is the cool end of the fat fill, 1 the warm end. */
export function fatHueT(pctFat: number): number {
  const [lo, hi] = FAT_HUE_DOMAIN;
  return clamp01((pctFat - lo) / (hi - lo));
}

/** The region's fill in levels view: blue-teal at 12 % fat, orange at 28 %, steady in between. */
export function fatFillColor(pctFat: number): string {
  const t = fatHueT(pctFat);
  const hue = Math.round(200 - 175 * t);
  return `hsl(${hue} 65% 50%)`;
}

export interface FigureDelta {
  /** Percentage points of fat, this scan minus the previous. */
  fatPts: number;
  leanPts: number;
  fatKg: number;
  tier: ChangeTier;
  /** The tier the numbers alone give. */
  rawTier: ChangeTier;
  demoted: boolean;
  multipleOfTechnical: number;
}

export interface FigureCell {
  region: BodyCompRegion;
  label: string;
  /** As printed on the report. */
  pctFat: number;
  /** Lean over fat, lean and bone mineral, in per cent. */
  pctLean: number;
  /** Bone mineral over the same total; null where the report prints none for the region. */
  pctBone: number | null;
  fatKg: number;
  leanKg: number;
  totalKg: number;
  bmcG: number | null;
  bmdGcm2: number | null;
  /** Null at one scan, when the pair is not comparable, or when the previous report lacks the region. */
  delta: FigureDelta | null;
}

export interface WholeBody {
  /** The scan's total mass, kg; not the clinic scale weight. */
  massKg: number;
  clinicWeightKg: number | null;
  fatKg: number;
  leanKg: number;
  bmcKg: number;
  pctFat: number;
  ffmi: number;
  almi: number | null;
  totalBmdGcm2: number | null;
}

export interface FigureChange {
  prevScanId: string;
  prevDay: string;
  /** The % fat noise band applied to every region; the scanner prints no regional precision. */
  band: BodyCompBand;
  /** The tiers were lowered a step because the scans were not taken alike. */
  demoted: boolean;
  reasons: string[];
}

export interface BodyFigureModel {
  scanId: string;
  scannedDay: string;
  /** Drawn regions the report printed, in `FIGURE_REGIONS` order. */
  regions: FigureCell[];
  /** Android and gynoid, when printed. Listed in the table, not drawn. */
  bands: FigureCell[];
  /** Regions the report did not print: left unlit and listed. */
  missing: BodyCompRegion[];
  wholeBody: WholeBody;
  ratios: ReturnType<typeof distributionRatios>;
  asymmetry: ReturnType<typeof limbAsymmetry>;
  /** Present only when a previous scan exists and the pair is not hidden as incomparable. */
  change: FigureChange | null;
}

function baseCell(r: BodyCompRegionValues): Omit<FigureCell, 'delta'> {
  const bmc = r.bmc_g ?? 0;
  const total = r.fat_g + r.lean_g + bmc;
  const share = (g: number) => (total > 0 ? (g / total) * 100 : 0);
  return {
    region: r.region,
    label: REGION_LABEL[r.region],
    pctFat: r.pct_fat,
    pctLean: share(r.lean_g),
    pctBone: r.bmc_g == null ? null : share(bmc),
    fatKg: r.fat_g / 1000,
    leanKg: r.lean_g / 1000,
    totalKg: r.total_g / 1000,
    bmcG: r.bmc_g ?? null,
    bmdGcm2: r.bmd_gcm2 ?? null,
  };
}

const demoteTier = (tier: ChangeTier): ChangeTier =>
  tier === 'exceeds_lsc' ? 'indeterminate' : 'within_noise';

/** The % fat noise band: the technical limit, and the practical limit over days rather than minutes. */
export const pctFatBand = (
  precision: BodyCompPrecision = DEFAULT_BODY_COMP_PRECISION
): BodyCompBand => ({
  technical: precision.pct_fat_lsc_abs,
  practical: precision.pct_fat_lsc_abs * precision.practical_lean_multiplier,
});

export function buildBodyFigureModel(
  scan: BodyCompScan,
  options: {
    /** The scan before this one, if any. */
    prev?: BodyCompScan | null;
    precision?: BodyCompPrecision;
  } = {}
): BodyFigureModel {
  const precision = options.precision ?? DEFAULT_BODY_COMP_PRECISION;
  const prev = options.prev ?? null;
  const comparability = prev ? bodyCompComparability(prev, scan) : null;
  const band =
    prev && comparability && !comparability.hidden
      ? pctFatBand(precision)
      : null;
  const demote = band !== null && (comparability?.demote ?? false);
  const byRegion = new Map(scan.regions.map((r) => [r.region, r]));
  const prevBy = new Map((prev?.regions ?? []).map((r) => [r.region, r]));

  const withDelta = (r: BodyCompRegionValues): FigureCell => {
    const base = baseCell(r);
    const p = band ? prevBy.get(r.region) : undefined;
    if (!band || !p) return { ...base, delta: null };
    const prior = baseCell(p);
    const flag = deltaFlag(p.pct_fat, r.pct_fat, band);
    const tier = demote ? demoteTier(flag.tier) : flag.tier;
    return {
      ...base,
      delta: {
        fatPts: flag.delta,
        leanPts: base.pctLean - prior.pctLean,
        fatKg: base.fatKg - prior.fatKg,
        tier,
        rawTier: flag.tier,
        demoted: demote,
        multipleOfTechnical:
          band.technical > 0 ? Math.abs(flag.delta) / band.technical : 0,
      },
    };
  };
  const pick = (keys: readonly BodyCompRegion[]) =>
    keys.flatMap((key) => {
      const r = byRegion.get(key);
      return r ? [withDelta(r)] : [];
    });
  const indices = bodyCompIndices(scan);
  return {
    scanId: scan.id,
    scannedDay: scan.scanned_day,
    regions: pick(FIGURE_REGIONS),
    bands: pick(BAND_REGIONS),
    missing: [...FIGURE_REGIONS, ...BAND_REGIONS].filter(
      (key) => !byRegion.has(key)
    ),
    wholeBody: {
      massKg: scan.total_mass_g / 1000,
      clinicWeightKg: scan.clinic_weight_kg,
      fatKg: scan.total_fat_g / 1000,
      leanKg: scan.total_lean_g / 1000,
      bmcKg: scan.total_bmc_g / 1000,
      pctFat: scan.pct_fat,
      ffmi: indices.ffmi,
      almi: indices.almi,
      totalBmdGcm2: scan.total_bmd_gcm2,
    },
    ratios: distributionRatios(scan),
    asymmetry: limbAsymmetry(scan),
    change:
      band && prev && comparability
        ? {
            prevScanId: prev.id,
            prevDay: prev.scanned_day,
            band,
            demoted: demote,
            reasons: comparability.reasons,
          }
        : null,
  };
}
