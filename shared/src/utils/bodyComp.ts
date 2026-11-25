import { addDays, daysBetween } from './timezone.ts';
import {
  cumulativeExposure,
  type BlendCompositionRef,
  type DoseHistoryEntry,
  type ExposureRow,
} from '../medications/doseHistory.ts';
import type { CsvCell } from './csv.ts';
import {
  BODY_COMP_REGIONS,
  type BodyCompRegion,
  type BodyCompScan,
} from '../schemas/api/BodyCompScans.api.zod.ts';

/**
 * Whole-body DEXA maths, as Pitstop's body composition page has it. Pure. A scan is a report's
 * printed figures in grams; everything here is recomputed from them, nothing is estimated from
 * anything else, and a change between two scans is only called a change when it clears the
 * scanner's own measurement noise.
 */

const LIMBS: readonly BodyCompRegion[] = ['l_arm', 'r_arm', 'l_leg', 'r_leg'];
/** The regions that add up to the whole body. */
const BODY: readonly BodyCompRegion[] = [
  'l_arm',
  'r_arm',
  'trunk',
  'l_leg',
  'r_leg',
  'head',
];

type Scan = Pick<
  BodyCompScan,
  | 'height_cm'
  | 'total_fat_g'
  | 'total_lean_g'
  | 'total_bmc_g'
  | 'total_mass_g'
  | 'pct_fat'
  | 'regions'
>;

const region = (scan: Scan, name: BodyCompRegion) =>
  scan.regions.find((r) => r.region === name);
const heightM2 = (heightCm: number) => (heightCm / 100) ** 2;

export interface BodyCompIndices {
  /** Fat-free mass: lean soft tissue plus bone mineral, in kg. */
  ffm_kg: number;
  ffmi: number;
  /** Lean soft tissue (without bone) per square metre. */
  lmi: number;
  fmi: number;
  /** Appendicular lean mass: the lean mass of both arms and both legs, in kg; null without all four. */
  alm_kg: number | null;
  almi: number | null;
  pct_fat_recomputed: number;
}

export function bodyCompIndices(scan: Scan): BodyCompIndices {
  const h2 = heightM2(scan.height_cm);
  const ffm = (scan.total_lean_g + scan.total_bmc_g) / 1000;
  const limbs = LIMBS.map((name) => region(scan, name));
  const alm = limbs.every(Boolean)
    ? limbs.reduce((sum, r) => sum + r!.lean_g, 0) / 1000
    : null;
  return {
    ffm_kg: ffm,
    ffmi: ffm / h2,
    lmi: scan.total_lean_g / 1000 / h2,
    fmi: scan.total_fat_g / 1000 / h2,
    alm_kg: alm,
    almi: alm === null ? null : alm / h2,
    pct_fat_recomputed: (scan.total_fat_g / scan.total_mass_g) * 100,
  };
}

export interface BodyCompCheck {
  name: 'fat_sum' | 'lean_sum' | 'bmc_sum' | 'mass_sum' | 'pct_fat';
  pass: boolean;
  /** Whether it could be checked at all: the region sums need all six body regions. */
  evaluated: boolean;
  /** What the regions add up to, or the percentage worked out, and what the report printed. */
  computed: number;
  printed: number;
}

/**
 * Does the report agree with itself? The six body regions should add up to the whole body to
 * within a gram's rounding, and the printed percentage fat should match fat over total mass. A
 * failed check is for the person to look at, not a reason to refuse the scan.
 */
export function bodyCompChecks(scan: Scan): BodyCompCheck[] {
  const rows = BODY.map((name) => region(scan, name));
  const full = rows.every(Boolean);
  const sum = (
    pick: (r: NonNullable<(typeof rows)[number]>) => number | null
  ) => {
    let total = 0;
    for (const r of rows) {
      const v = r ? pick(r) : null;
      if (v === null) return null;
      total += v;
    }
    return total;
  };
  const regionCheck = (
    name: BodyCompCheck['name'],
    computed: number | null,
    printed: number
  ): BodyCompCheck => ({
    name,
    evaluated: full && computed !== null,
    pass: !full || computed === null || Math.abs(computed - printed) <= 1,
    computed: computed ?? 0,
    printed,
  });
  const pct = bodyCompIndices(scan).pct_fat_recomputed;
  return [
    regionCheck(
      'fat_sum',
      sum((r) => r.fat_g),
      scan.total_fat_g
    ),
    regionCheck(
      'lean_sum',
      sum((r) => r.lean_g),
      scan.total_lean_g
    ),
    regionCheck(
      'bmc_sum',
      sum((r) => r.bmc_g),
      scan.total_bmc_g
    ),
    regionCheck(
      'mass_sum',
      sum((r) => r.total_g),
      scan.total_mass_g
    ),
    {
      name: 'pct_fat',
      evaluated: true,
      pass: Math.abs(pct - scan.pct_fat) <= 0.15,
      computed: pct,
      printed: scan.pct_fat,
    },
  ];
}

/** Left-to-right difference in lean mass, as a percentage of the pair's mean; null without both sides. */
export function limbAsymmetry(scan: Scan): {
  arms_pct: number | null;
  legs_pct: number | null;
} {
  const pct = (left: BodyCompRegion, right: BodyCompRegion) => {
    const l = region(scan, left)?.lean_g;
    const r = region(scan, right)?.lean_g;
    return l === undefined || r === undefined || l + r === 0
      ? null
      : ((r - l) / ((r + l) / 2)) * 100;
  };
  return { arms_pct: pct('l_arm', 'r_arm'), legs_pct: pct('l_leg', 'r_leg') };
}

/** Android over gynoid percentage fat, and trunk fat over limb fat; null without the regions. */
export function distributionRatios(scan: Scan): {
  android_gynoid: number | null;
  trunk_limb_fat: number | null;
} {
  const android = region(scan, 'android');
  const gynoid = region(scan, 'gynoid');
  const trunk = region(scan, 'trunk');
  const limbs = LIMBS.map((name) => region(scan, name));
  const limbFat = limbs.every(Boolean)
    ? limbs.reduce((sum, r) => sum + r!.fat_g, 0)
    : null;
  return {
    android_gynoid:
      android && gynoid && gynoid.pct_fat > 0
        ? android.pct_fat / gynoid.pct_fat
        : null,
    trunk_limb_fat: trunk && limbFat ? trunk.fat_g / limbFat : null,
  };
}

/** How much two readings of the same body can differ on this scanner without anything changing. */
export interface BodyCompPrecision {
  fat_cv_pct: number;
  lean_cv_pct: number;
  pct_fat_lsc_abs: number;
  alm_cv_pct: number;
  vat_cv_pct: number;
  /** A change over days, not minutes, is noisier: scale the technical figure by these. */
  practical_fat_multiplier: number;
  practical_lean_multiplier: number;
}
/**
 * Hologic Horizon A same-day precision (Nowitz 2017) with consecutive-day multipliers (Zemski
 * 2019): a device-class default, not this clinic's own precision.
 */
export const DEFAULT_BODY_COMP_PRECISION: BodyCompPrecision = {
  fat_cv_pct: 0.78,
  lean_cv_pct: 0.52,
  pct_fat_lsc_abs: 0.5,
  alm_cv_pct: 1.0,
  vat_cv_pct: 2.63,
  practical_fat_multiplier: 1.9,
  practical_lean_multiplier: 3.4,
};
/** 2.77 = 1.96 x sqrt(2): the smallest difference of two readings that is not just noise. */
export const LSC_K = 2.77;

export interface BodyCompBand {
  technical: number;
  practical: number | null;
}
const lscAbs = (value: number, cvPct: number) =>
  ((value * cvPct) / 100) * LSC_K;

export type ChangeTier = 'within_noise' | 'indeterminate' | 'exceeds_lsc';
export interface BodyCompDeltaFlag {
  delta: number;
  tier: ChangeTier;
  band: BodyCompBand;
  /** Set when the tier was lowered a step because the scans were not taken alike. */
  demoted: boolean;
  /** The tier the numbers alone give. */
  raw_tier: ChangeTier;
}

const EPS = 1e-9;
/** Inside noise, in the grey zone, or past the practical limit; the edges count as the higher tier. */
export function deltaFlag(
  previous: number,
  next: number,
  band: BodyCompBand
): BodyCompDeltaFlag {
  const delta = next - previous;
  const size = Math.abs(delta);
  const tier: ChangeTier =
    band.practical !== null && size >= band.practical - EPS
      ? 'exceeds_lsc'
      : size >= band.technical - EPS
        ? 'indeterminate'
        : 'within_noise';
  return { delta, tier, band, demoted: false, raw_tier: tier };
}
const demote = (flag: BodyCompDeltaFlag): BodyCompDeltaFlag => ({
  ...flag,
  tier: flag.tier === 'exceeds_lsc' ? 'indeterminate' : 'within_noise',
  demoted: true,
});

export interface BodyCompComparability {
  /** Alike enough to compare outright. */
  comparable: boolean;
  /** Different scanner or analysis software: the numbers are not comparable at all. */
  hidden: boolean;
  /** Taken under different conditions: compared, with the verdict lowered a step. */
  demote: boolean;
  reasons: string[];
}

const PREP_KEYS = [
  'fasted',
  'no_caffeine',
  'no_training_prior_day',
  'active_travel',
  'euhydrated_voided',
  'illness_free_14d',
] as const;

/** Different scanner or software: never compared. Different or unrecorded conditions: compared with less weight. */
export function bodyCompComparability(
  a: BodyCompScan,
  b: BodyCompScan
): BodyCompComparability {
  const reasons: string[] = [];
  let hidden = false;
  if (
    a.device_serial &&
    b.device_serial &&
    a.device_serial !== b.device_serial
  ) {
    hidden = true;
    reasons.push('different scanner serial');
  }
  if (
    a.software_version &&
    b.software_version &&
    a.software_version !== b.software_version
  ) {
    hidden = true;
    reasons.push('different analysis software');
  }
  for (const key of PREP_KEYS) {
    const x = a.prep[key];
    const y = b.prep[key];
    if (x === null || y === null)
      reasons.push(`${key}: not recorded on one scan`);
    else if (x !== y) reasons.push(`${key}: differs`);
  }
  if ((a.creatine_status ?? 'unknown') !== (b.creatine_status ?? 'unknown'))
    reasons.push('creatine status differs');
  return {
    comparable: !hidden && reasons.length === 0,
    hidden,
    demote: !hidden && reasons.length > 0,
    reasons,
  };
}

export type BodyCompDeltaKey =
  'fat_mass' | 'lean_mass' | 'pct_fat' | 'alm' | 'vat';
export interface BodyCompDeltaRow {
  key: BodyCompDeltaKey;
  unit: 'kg' | 'pct' | 'g';
  previous: number;
  next: number;
  flag: BodyCompDeltaFlag;
  /** The change over 30 days, only when it is at least the technical limit and the scans are 28+ days apart. */
  per_30_days: number | null;
}
export interface BodyCompComparison {
  days: number;
  comparability: BodyCompComparability;
  /** Empty when the scanners differ: nothing is shown rather than a number that means nothing. */
  rows: BodyCompDeltaRow[];
}

/** What changed from the earlier scan to the later one, each against that quantity's own noise band. */
export function compareBodyCompScans(
  previous: BodyCompScan,
  next: BodyCompScan,
  precision: BodyCompPrecision = DEFAULT_BODY_COMP_PRECISION
): BodyCompComparison {
  const days = daysBetween(previous.scanned_day, next.scanned_day);
  const comparability = bodyCompComparability(previous, next);
  if (comparability.hidden) return { days, comparability, rows: [] };
  const a = bodyCompIndices(previous);
  const b = bodyCompIndices(next);
  const row = (
    key: BodyCompDeltaKey,
    unit: BodyCompDeltaRow['unit'],
    from: number,
    to: number,
    band: BodyCompBand
  ): BodyCompDeltaRow => {
    const raw = deltaFlag(from, to, band);
    const flag = comparability.demote ? demote(raw) : raw;
    return {
      key,
      unit,
      previous: from,
      next: to,
      flag,
      per_30_days:
        days < 28 || Math.abs(raw.delta) < band.technical
          ? null
          : (raw.delta / days) * 30,
    };
  };
  const fatKg = previous.total_fat_g / 1000;
  const leanKg = previous.total_lean_g / 1000;
  const fatTechnical = lscAbs(fatKg, precision.fat_cv_pct);
  const leanTechnical = lscAbs(leanKg, precision.lean_cv_pct);
  const rows: BodyCompDeltaRow[] = [
    row('fat_mass', 'kg', fatKg, next.total_fat_g / 1000, {
      technical: fatTechnical,
      practical: fatTechnical * precision.practical_fat_multiplier,
    }),
    row('lean_mass', 'kg', leanKg, next.total_lean_g / 1000, {
      technical: leanTechnical,
      practical: leanTechnical * precision.practical_lean_multiplier,
    }),
    row('pct_fat', 'pct', previous.pct_fat, next.pct_fat, {
      technical: precision.pct_fat_lsc_abs,
      practical:
        precision.pct_fat_lsc_abs * precision.practical_lean_multiplier,
    }),
  ];
  if (a.alm_kg !== null && b.alm_kg !== null)
    rows.push(
      row('alm', 'kg', a.alm_kg, b.alm_kg, {
        technical: lscAbs(a.alm_kg, precision.alm_cv_pct),
        practical: null,
      })
    );
  if (previous.vat_mass_g !== null && next.vat_mass_g !== null) {
    const vat = lscAbs(previous.vat_mass_g, precision.vat_cv_pct);
    rows.push(
      row('vat', 'g', previous.vat_mass_g, next.vat_mass_g, {
        technical: vat,
        practical: vat * 2,
      })
    );
  }
  return { days, comparability, rows };
}

/** The window a repeat scan is worth taking in: twelve to sixteen weeks after the latest one. */
export function nextBodyCompScanWindow(
  latestDay: string,
  today: string
): {
  due_from: string;
  due_to: string;
  days_to_start: number;
  status: 'upcoming' | 'in_window' | 'window_passed';
} {
  const from = addDays(latestDay, 84);
  const to = addDays(latestDay, 112);
  return {
    due_from: from,
    due_to: to,
    days_to_start: daysBetween(today, from),
    status:
      today < from ? 'upcoming' : today <= to ? 'in_window' : 'window_passed',
  };
}
export const BODY_COMP_EXPORT_HEADERS = [
  'date',
  'scan',
  'region',
  'device',
  'facility',
  'sex',
  'age_years',
  'height_cm',
  'clinic_weight_kg',
  'fat_g',
  'lean_g',
  'bmc_g',
  'total_g',
  'pct_fat',
  'vat_mass_g',
  'vat_volume_cm3',
  'vat_area_cm2',
  'total_bmd_gcm2',
  'fasted',
  'no_caffeine',
  'no_training_prior_day',
  'active_travel',
  'creatine_status',
  'scan_mode',
  'reference_population',
  'bmd_t_score',
  'bmd_z_score',
  'bmd_cv_pct',
  'pct_fat_yn',
  'pct_fat_am',
  'fmi_yn',
  'fmi_am',
  'lmi_yn',
  'lmi_am',
  'almi_yn',
  'almi_am',
  'region_bmd_gcm2',
] as const;

const tri = (value: boolean | null): string | null =>
  value === null ? null : value ? 'true' : 'false';

/**
 * One row for each region the scan holds, then one `total` row, newest scan first, as Pitstop's
 * export lays it out. The whole-body measurements that are not regional (visceral fat, bone
 * density) are on the `total` row only, so they cannot be read as a region's. Serial number,
 * software, free-text notes and the full prep answers other than the headline ones are left out.
 */
export function bodyCompExportRows(
  scans: readonly BodyCompScan[]
): CsvCell[][] {
  const order = (name: string) => {
    const i = (BODY_COMP_REGIONS as readonly string[]).indexOf(name);
    return i === -1 ? BODY_COMP_REGIONS.length : i;
  };
  return [...scans]
    .sort((a, b) => b.scanned_day.localeCompare(a.scanned_day))
    .flatMap((scan, index, all) => {
      const scanNumber = all.length - index;
      const context = [scan.scanned_day, scanNumber];
      const tail = [
        scan.device_label,
        scan.facility,
        scan.sex,
        scan.age_years,
        scan.height_cm,
        scan.clinic_weight_kg,
      ];
      const prep = [
        tri(scan.prep.fasted),
        tri(scan.prep.no_caffeine),
        tri(scan.prep.no_training_prior_day),
        tri(scan.prep.active_travel),
        scan.creatine_status,
      ];
      const regions = [...scan.regions].sort(
        (a, b) => order(a.region) - order(b.region)
      );
      return [
        ...regions.map((r) => [
          ...context,
          r.region,
          ...tail,
          r.fat_g,
          r.lean_g,
          r.bmc_g,
          r.total_g,
          r.pct_fat,
          null,
          null,
          null,
          null,
          ...prep,
          // Whole-body report fields belong to the total row; a region keeps only its own.
          null,
          null,
          null,
          null,
          null,
          r.pct_fat_yn ?? null,
          r.pct_fat_am ?? null,
          null,
          null,
          null,
          null,
          null,
          null,
          r.bmd_gcm2 ?? null,
        ]),
        [
          ...context,
          'total',
          ...tail,
          scan.total_fat_g,
          scan.total_lean_g,
          scan.total_bmc_g,
          scan.total_mass_g,
          scan.pct_fat,
          scan.vat_mass_g,
          scan.vat_volume_cm3,
          scan.vat_area_cm2,
          scan.total_bmd_gcm2,
          ...prep,
          scan.scan_mode ?? null,
          scan.reference_population ?? null,
          scan.bmd_t_score ?? null,
          scan.bmd_z_score ?? null,
          scan.bmd_cv_pct ?? null,
          scan.pct_fat_yn ?? null,
          scan.pct_fat_am ?? null,
          scan.fmi_yn ?? null,
          scan.fmi_am ?? null,
          scan.lmi_yn ?? null,
          scan.lmi_am ?? null,
          scan.almi_yn ?? null,
          scan.almi_am ?? null,
          null,
        ],
      ];
    });
}

export interface BodyCompIntervalExposure extends ExposureRow {
  /** From the first to the last dose in the window, both days counted. */
  days_active: number;
  /** From the last dose to the end of the window. */
  days_since_last_dose: number;
}

/**
 * What was taken between two scans, as Pitstop's exposure ledger lists it: every compound with a
 * taken dose in the window, in mass units, alphabetically and with equal weight. A blend is
 * counted under its components. It is the regimen during the interval, not an attribution of any
 * change to any compound.
 */
export function bodyCompIntervalExposure(
  entries: readonly DoseHistoryEntry[],
  blends: readonly BlendCompositionRef[],
  from: string,
  to: string
): BodyCompIntervalExposure[] {
  return cumulativeExposure(
    entries.filter((e) => e.entry_date >= from && e.entry_date <= to),
    blends
  ).map((row) => ({
    ...row,
    days_active: daysBetween(row.first_date, row.last_date) + 1,
    days_since_last_dose: daysBetween(row.last_date, to),
  }));
}
