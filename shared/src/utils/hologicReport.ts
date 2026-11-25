import {
  bodyCompChecks,
  bodyCompIndices,
  type BodyCompCheck,
} from './bodyComp.ts';
import type {
  BodyCompRegion,
  BodyCompRegionValues,
  BodyCompReportPrefill,
} from '../schemas/api/BodyCompScans.api.zod.ts';

/**
 * Hologic APEX whole-body report text to the values a DEXA scan takes, with checks and a
 * confidence score. Ported from Pitstop's dexa-parse-core and dexa-prefill. Pure: no I/O.
 *
 * Every anchor is a regular expression over the report's text with its table rows laid out one
 * row to a line (the server builds that text from the PDF's text layer). Any whitespace,
 * newlines included, is allowed between fields. Numbers are read exactly as printed; the only
 * thing worked out is the checks, which compare printed values with each other.
 */

export interface HologicReportCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ParsedHologicHeader {
  sex: 'male' | 'female';
  heightCm: number;
  clinicWeightKg: number | null;
  ageYears: number;
  /** YYYY-MM-DD when the printed "Scan Date" can be read as a date; null otherwise. */
  scanDate: string | null;
  /** The "Scan Date" exactly as printed, kept so nothing is lost when it cannot be read. */
  scanDateRaw: string | null;
  softwareVersion: string | null;
  deviceModel: string | null;
  deviceSerial: string | null;
  scanMode: string | null;
  referencePopulation: string | null;
}

export interface ParsedHologicRegion {
  region: BodyCompRegion;
  /** Android and gynoid print no bone mineral. */
  bmcG: number | null;
  fatG: number;
  leanG: number;
  totalG: number;
  pctFat: number;
  pctFatYn: number | null;
  pctFatAm: number | null;
  bmdGcm2: number | null;
}

export interface ParsedHologicScan {
  header: ParsedHologicHeader;
  totals: {
    totalFatG: number;
    totalLeanG: number;
    totalBmcG: number;
    totalMassG: number;
    pctFat: number;
    pctFatYn: number | null;
    pctFatAm: number | null;
  };
  /** Up to all eight regions; android and gynoid only when printed. */
  regions: ParsedHologicRegion[];
  vat: {
    massG: number | null;
    volumeCm3: number | null;
    areaCm2: number | null;
  };
  bone: {
    totalBmdGcm2: number | null;
    tScore: number | null;
    zScore: number | null;
    cvPct: number | null;
  };
  indices: {
    fmi: number | null;
    fmiYn: number | null;
    fmiAm: number | null;
    lmi: number | null;
    lmiYn: number | null;
    lmiAm: number | null;
    almi: number | null;
    almiYn: number | null;
    almiAm: number | null;
    androidGynoid: number | null;
  };
}

export interface HologicParseResult {
  /** Every required anchor was found and every check passed. */
  ok: boolean;
  /**
   * Present whenever the required anchors were found, even when a check failed, so what was read
   * can still be shown for review. Null when this is not a Hologic whole-body report.
   */
  scan: ParsedHologicScan | null;
  checks: HologicReportCheck[];
  /** 0 to 1: the share of expected anchors found, times the share of checks passed. */
  confidence: number;
  /** Anchor names not found, required and optional alike. */
  missing: string[];
}

/** Superscripts and no-break spaces as pdf.js emits them become plain ASCII; thousands separators go. */
export function normaliseReportText(text: string): string {
  return text
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/[  ]/g, ' ')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------
const SUMMARY_LABELS = [
  'L Arm',
  'R Arm',
  'Trunk',
  'L Leg',
  'R Leg',
  'Subtotal',
  'Head',
  'Total',
] as const;
const PERCENTILE_LABELS = [
  'L Arm',
  'R Arm',
  'Trunk',
  'L Leg',
  'R Leg',
  'Subtotal',
  'Total',
] as const;
const BMD_LABELS = ['L Arm', 'R Arm', 'L Leg', 'R Leg', 'Head'] as const;
type SummaryLabel = (typeof SUMMARY_LABELS)[number];
type PercentileLabel = (typeof PERCENTILE_LABELS)[number];
type BmdLabel = (typeof BMD_LABELS)[number];

/** The six regions of the summary table, which add up to the whole body. */
const BODY_ROWS: readonly { region: BodyCompRegion; label: SummaryLabel }[] = [
  { region: 'l_arm', label: 'L Arm' }, // i18n-ignore: row label as printed
  { region: 'r_arm', label: 'R Arm' }, // i18n-ignore: row label as printed
  { region: 'trunk', label: 'Trunk' },
  { region: 'l_leg', label: 'L Leg' }, // i18n-ignore: row label as printed
  { region: 'r_leg', label: 'R Leg' }, // i18n-ignore: row label as printed
  { region: 'head', label: 'Head' },
];

const D1 = '(\\d+\\.\\d)'; // one decimal
const D2 = '(\\d+\\.\\d\\d)'; // two decimals
const INT = '(\\d+)';
const S = '\\s+';
/** A row label: words may be split by any whitespace; it must not be the tail of a longer word (Subtotal is not Total). */
const label = (text: string) => `(?<![A-Za-z])${text.split(' ').join('\\s+')}`;

const summaryRe = (l: string) =>
  new RegExp(
    `${label(l)}${S}${D2}${S}${D1}${S}${D1}${S}${D1}${S}${D1}${S}${D1}`
  );
const percentileRe = (l: string) =>
  new RegExp(
    `${label(l)}${S}${INT}${S}${INT}${S}${INT}${S}${D1}${S}${INT}${S}${INT}`
  );
const bmdRe = (l: string) =>
  new RegExp(`${label(l)}${S}${D2}${S}${D2}${S}(\\d\\.\\d{3})`);
const androidRe = new RegExp(
  `Android\\s*\\(A\\)${S}${INT}${S}${INT}${S}${INT}${S}${D1}`
);
const gynoidRe = new RegExp(
  `Gynoid\\s*\\(G\\)${S}${INT}${S}${INT}${S}${INT}${S}${D1}`
);

const HEADER = {
  sex: /Sex:\s*(Male|Female)/,
  height: /Height:\s*([\d.]+)\s*cm/,
  weight: /Weight:\s*([\d.]+)\s*kg/,
  age: /Age:\s*(\d+)/,
  scanDate: /Scan\s+Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
  version: /Version\s+([\d.]+)/,
  model: /Model:\s*([A-Za-z ]+?)\s*\(S\/N\s*([A-Za-z0-9]+)\)/,
  scanType: /Scan\s+Type:\s*a?\s*(Whole\s+Body)/,
  reference: /T-score\s+vs\.\s*([A-Za-z ]+?)\.\s*Source:\s*(\S+)/,
} as const;

const INDICES = {
  totalBodyPctFat: new RegExp(
    `Total\\s+Body\\s+%\\s*Fat${S}${D1}${S}${INT}${S}${INT}`
  ),
  fmi: new RegExp(
    `Fat\\s+Mass/Height2\\s*\\(kg/m2\\)${S}${D2}${S}${INT}${S}${INT}`
  ),
  agRatio: new RegExp(`Android/Gynoid\\s+Ratio${S}${D2}`),
  vatMass: new RegExp(`Est\\.\\s*VAT\\s+Mass\\s*\\(g\\)${S}${INT}`),
  vatVolume: new RegExp(`Est\\.\\s*VAT\\s+Volume\\s*\\(cm3\\)${S}${INT}`),
  vatArea: new RegExp(`Est\\.\\s*VAT\\s+Area\\s*\\(cm2\\)${S}${D1}`),
  lmi: new RegExp(
    `(?<!Appen\\.\\s{0,3})Lean/Height2\\s*\\(kg/m2\\)${S}${D1}${S}${INT}${S}${INT}`
  ),
  almi: new RegExp(
    `Appen\\.\\s*Lean/Height2\\s*\\(kg/m2\\)${S}${D2}${S}${INT}${S}${INT}`
  ),
} as const;
const BMD_TOTAL = new RegExp(
  `${label('Total')}${S}${D2}${S}${D2}${S}(\\d\\.\\d{3})${S}(-?\\d+\\.\\d)${S}(-?\\d+\\.\\d)`
);
const BMD_CV = new RegExp(`Total\\s+BMD\\s+CV${S}${D1}\\s*%`);

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "2 September 2026" or "02 Sep 2026" becomes "2026-09-02"; null when it is not an English month name and a real day. */
export function isoFromPrintedDate(printed: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(printed.trim());
  if (!m) return null;
  const word = m[2]!.toLowerCase();
  const month = MONTHS.findIndex(
    (name) => name === word || name.slice(0, 3) === word.slice(0, 3)
  );
  if (month < 0) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
interface SummaryRow {
  bmcG: number;
  fatG: number;
  leanG: number;
  leanBmcG: number;
  totalG: number;
  pctFat: number;
}
interface PercentileRow {
  pctFatYn: number;
  pctFatAm: number;
}
interface BmdRow {
  bmdGcm2: number;
}

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function parseHologicReport(rawText: string): HologicParseResult {
  const text = normaliseReportText(rawText);
  const found: string[] = [];
  const missing: string[] = [];
  const grab = <T>(
    name: string,
    re: RegExp,
    pick: (m: RegExpExecArray) => T
  ): T | null => {
    const m = re.exec(text);
    (m ? found : missing).push(name);
    return m ? pick(m) : null;
  };
  // The capture groups are present whenever the pattern matched.
  const g = (m: RegExpExecArray, i: number) => m[i] as string;

  // Header
  const sexRaw = grab('header:Sex', HEADER.sex, (m) => g(m, 1));
  const heightCm = grab('header:Height', HEADER.height, (m) => num(g(m, 1)));
  const clinicWeightKg = grab('header:Weight', HEADER.weight, (m) =>
    num(g(m, 1))
  );
  const ageYears = grab('header:Age', HEADER.age, (m) => num(g(m, 1)));
  const scanDateRaw = grab('header:Scan Date', HEADER.scanDate, (m) =>
    g(m, 1).replace(/\s+/g, ' ')
  );
  const softwareVersion = grab('header:Version', HEADER.version, (m) =>
    g(m, 1)
  );
  const model = grab('header:Model', HEADER.model, (m) => ({
    model: g(m, 1).trim(),
    serial: g(m, 2),
  }));
  const scanMode = grab('header:Scan Type', HEADER.scanType, (m) =>
    g(m, 1).replace(/\s+/g, ' ')
  );
  const reference = grab(
    'header:Reference',
    HEADER.reference,
    (m) => `${g(m, 2)} ${g(m, 1).trim()}`
  );

  // Summary table (bone mineral two decimals, the rest one)
  const summary: Partial<Record<SummaryLabel, SummaryRow>> = {};
  for (const l of SUMMARY_LABELS) {
    const row = grab(`summary:${l}`, summaryRe(l), (m) => ({
      bmcG: Number(m[1]),
      fatG: Number(m[2]),
      leanG: Number(m[3]),
      leanBmcG: Number(m[4]),
      totalG: Number(m[5]),
      pctFat: Number(m[6]),
    }));
    if (row) summary[l] = row;
  }
  // Percentile table (integers, % fat, then the YN and AM percentiles)
  const pct: Partial<Record<PercentileLabel, PercentileRow>> = {};
  for (const l of PERCENTILE_LABELS) {
    const row = grab(`percentile:${l}`, percentileRe(l), (m) => ({
      pctFatYn: Number(m[5]),
      pctFatAm: Number(m[6]),
    }));
    if (row) pct[l] = row;
  }
  const android = grab('percentile:Android', androidRe, (m) => ({
    fatG: Number(m[1]),
    leanG: Number(m[2]),
    totalG: Number(m[3]),
    pctFat: Number(m[4]),
  }));
  const gynoid = grab('percentile:Gynoid', gynoidRe, (m) => ({
    fatG: Number(m[1]),
    leanG: Number(m[2]),
    totalG: Number(m[3]),
    pctFat: Number(m[4]),
  }));

  // Adipose and lean indices
  const totalBodyPctFat = grab(
    'indices:Total Body % Fat',
    INDICES.totalBodyPctFat,
    (m) => ({ pctFat: Number(m[1]), yn: Number(m[2]), am: Number(m[3]) })
  );
  const fmi = grab('indices:Fat Mass/Height2', INDICES.fmi, (m) => ({
    value: Number(m[1]),
    yn: Number(m[2]),
    am: Number(m[3]),
  }));
  const agRatio = grab('indices:Android/Gynoid Ratio', INDICES.agRatio, (m) =>
    Number(m[1])
  );
  const vatMass = grab('indices:Est. VAT Mass', INDICES.vatMass, (m) =>
    Number(m[1])
  );
  const vatVolume = grab('indices:Est. VAT Volume', INDICES.vatVolume, (m) =>
    Number(m[1])
  );
  const vatArea = grab('indices:Est. VAT Area', INDICES.vatArea, (m) =>
    Number(m[1])
  );
  const lmi = grab('indices:Lean/Height2', INDICES.lmi, (m) => ({
    value: Number(m[1]),
    yn: Number(m[2]),
    am: Number(m[3]),
  }));
  const almi = grab('indices:Appen. Lean/Height2', INDICES.almi, (m) => ({
    value: Number(m[1]),
    yn: Number(m[2]),
    am: Number(m[3]),
  }));

  // Bone density table
  const bmd: Partial<Record<BmdLabel, BmdRow>> = {};
  for (const l of BMD_LABELS) {
    const row = grab(`bmd:${l}`, bmdRe(l), (m) => ({ bmdGcm2: Number(m[3]) }));
    if (row) bmd[l] = row;
  }
  const bmdTotal = grab('bmd:Total', BMD_TOTAL, (m) => ({
    bmdGcm2: Number(m[3]),
    tScore: Number(m[4]),
    zScore: Number(m[5]),
  }));
  const bmdCv = grab('bmd:Total BMD CV', BMD_CV, (m) => Number(m[1]));

  const anchorsExpected = found.length + missing.length;
  const anchorFraction = anchorsExpected ? found.length / anchorsExpected : 0;

  // Required: sex, height and age, the six body regions of the summary table, and its total row.
  const total = summary.Total;
  const bodyRows = BODY_ROWS.map((r) => summary[r.label]);
  if (
    sexRaw == null ||
    heightCm == null ||
    ageYears == null ||
    total == null ||
    !bodyRows.every(Boolean)
  ) {
    return {
      ok: false,
      scan: null,
      checks: [],
      confidence: round3(anchorFraction),
      missing,
    };
  }

  const regions: ParsedHologicRegion[] = BODY_ROWS.map(
    ({ region, label: l }) => {
      const s = summary[l] as SummaryRow;
      // Head has no row in the percentile table, and the trunk none in the bone table.
      const p = l === 'Head' ? undefined : pct[l as PercentileLabel];
      const b = l === 'Trunk' ? undefined : bmd[l as BmdLabel];
      return {
        region,
        bmcG: s.bmcG,
        fatG: s.fatG,
        leanG: s.leanG,
        totalG: s.totalG,
        pctFat: s.pctFat,
        pctFatYn: p?.pctFatYn ?? null,
        pctFatAm: p?.pctFatAm ?? null,
        bmdGcm2: b?.bmdGcm2 ?? null,
      };
    }
  );
  for (const [region, zone] of [
    ['android', android],
    ['gynoid', gynoid],
  ] as const) {
    if (zone)
      regions.push({
        region,
        bmcG: null,
        fatG: zone.fatG,
        leanG: zone.leanG,
        totalG: zone.totalG,
        pctFat: zone.pctFat,
        pctFatYn: null,
        pctFatAm: null,
        bmdGcm2: null,
      });
  }

  const scanDate = scanDateRaw ? isoFromPrintedDate(scanDateRaw) : null;
  const pctFatYn = pct.Total?.pctFatYn ?? totalBodyPctFat?.yn ?? null;
  const pctFatAm = pct.Total?.pctFatAm ?? totalBodyPctFat?.am ?? null;

  const checks: HologicReportCheck[] = [
    ...bodyCompChecks({
      height_cm: heightCm,
      total_fat_g: total.fatG,
      total_lean_g: total.leanG,
      total_bmc_g: total.bmcG,
      total_mass_g: total.totalG,
      pct_fat: total.pctFat,
      regions: regions.map(toStoredRegion),
    }).map(describeCheck),
    ...parserChecks(summary, {
      heightCm,
      totalFatG: total.fatG,
      totalLeanG: total.leanG,
      totalBmcG: total.bmcG,
      totalMassG: total.totalG,
      pctFat: total.pctFat,
      vatMassG: vatMass,
      vatVolumeCm3: vatVolume,
      regions,
      printed: {
        fmi: fmi?.value ?? null,
        lmi: lmi?.value ?? null,
        almi: almi?.value ?? null,
      },
    }),
  ];
  // The Scan Date anchor was found but its text is not a date ("32 January 2026", "10 Enero 2026"):
  // a failed check, so the report is never "read, 100 %" with the scan date silently absent.
  if (scanDateRaw != null && scanDate == null)
    checks.push({
      name: 'scan_date',
      pass: false,
      detail: `printed "${scanDateRaw}" could not be interpreted as a date`,
    });
  const passRate = checks.length
    ? checks.filter((c) => c.pass).length / checks.length
    : 1;

  const scan: ParsedHologicScan = {
    header: {
      sex: sexRaw === 'Female' ? 'female' : 'male',
      heightCm,
      clinicWeightKg,
      ageYears,
      scanDate,
      scanDateRaw,
      softwareVersion,
      deviceModel: model?.model ?? null,
      deviceSerial: model?.serial ?? null,
      scanMode,
      referencePopulation: reference,
    },
    totals: {
      totalFatG: total.fatG,
      totalLeanG: total.leanG,
      totalBmcG: total.bmcG,
      totalMassG: total.totalG,
      pctFat: total.pctFat,
      pctFatYn,
      pctFatAm,
    },
    regions,
    vat: { massG: vatMass, volumeCm3: vatVolume, areaCm2: vatArea },
    bone: {
      totalBmdGcm2: bmdTotal?.bmdGcm2 ?? null,
      tScore: bmdTotal?.tScore ?? null,
      zScore: bmdTotal?.zScore ?? null,
      cvPct: bmdCv,
    },
    indices: {
      fmi: fmi?.value ?? null,
      fmiYn: fmi?.yn ?? null,
      fmiAm: fmi?.am ?? null,
      lmi: lmi?.value ?? null,
      lmiYn: lmi?.yn ?? null,
      lmiAm: lmi?.am ?? null,
      almi: almi?.value ?? null,
      almiYn: almi?.yn ?? null,
      almiAm: almi?.am ?? null,
      androidGynoid: agRatio,
    },
  };
  return {
    ok: checks.every((c) => c.pass),
    scan,
    checks,
    confidence: round3(anchorFraction * passRate),
    missing,
  };
}

const toStoredRegion = (r: ParsedHologicRegion): BodyCompRegionValues => ({
  region: r.region,
  fat_g: r.fatG,
  lean_g: r.leanG,
  bmc_g: r.bmcG,
  total_g: r.totalG,
  pct_fat: r.pctFat,
});

/** Sparky's own checks, worded as Pitstop words them. */
function describeCheck(check: BodyCompCheck): HologicReportCheck {
  if (!check.evaluated)
    return {
      name: check.name,
      pass: true,
      detail: 'not evaluated (regions incomplete)',
    };
  return {
    name: check.name,
    pass: check.pass,
    detail:
      check.name === 'pct_fat'
        ? `recomputed ${check.computed.toFixed(2)} vs printed ${check.printed}`
        : `regions ${check.computed.toFixed(1)} vs total ${check.printed.toFixed(1)}`,
  };
}

/**
 * Checks over printed values that Sparky's own checks do not cover: the subtotal and the head add
 * up to the total; the five limb and trunk regions add up to the subtotal; the printed indices
 * match the ones worked out; and the visceral fat mass over its volume is a believable density.
 */
function parserChecks(
  summary: Partial<Record<SummaryLabel, SummaryRow>>,
  v: {
    heightCm: number;
    totalFatG: number;
    totalLeanG: number;
    totalBmcG: number;
    totalMassG: number;
    pctFat: number;
    vatMassG: number | null;
    vatVolumeCm3: number | null;
    regions: ParsedHologicRegion[];
    printed: { fmi: number | null; lmi: number | null; almi: number | null };
  }
): HologicReportCheck[] {
  const out: HologicReportCheck[] = [];
  const { Subtotal: sub, Head: head, Total: total } = summary;
  const metrics: { key: keyof SummaryRow; name: string }[] = [
    { key: 'fatG', name: 'fat' },
    { key: 'leanG', name: 'lean' },
    { key: 'bmcG', name: 'bmc' },
    { key: 'totalG', name: 'mass' },
  ];
  for (const { key, name } of metrics) {
    if (sub && head && total) {
      const s = sub[key] + head[key];
      out.push({
        name: `subtotal_head_${name}`,
        pass: Math.abs(s - total[key]) <= 1,
        detail: `subtotal + head ${s.toFixed(1)} vs total ${total[key].toFixed(1)}`,
      });
    } else
      out.push({
        name: `subtotal_head_${name}`,
        pass: true,
        detail: 'not evaluated (subtotal or head row missing)',
      });
    const five = (['L Arm', 'R Arm', 'Trunk', 'L Leg', 'R Leg'] as const).map(
      (l) => summary[l]
    );
    if (sub && five.every(Boolean)) {
      const s = five.reduce((a, r) => a + (r as SummaryRow)[key], 0);
      out.push({
        name: `regions_subtotal_${name}`,
        pass: Math.abs(s - sub[key]) <= 0.5,
        detail: `five regions ${s.toFixed(1)} vs subtotal ${sub[key].toFixed(1)}`,
      });
    } else
      out.push({
        name: `regions_subtotal_${name}`,
        pass: true,
        detail: 'not evaluated (subtotal row missing)',
      });
  }
  const worked = bodyCompIndices({
    height_cm: v.heightCm,
    total_fat_g: v.totalFatG,
    total_lean_g: v.totalLeanG,
    total_bmc_g: v.totalBmcG,
    total_mass_g: v.totalMassG,
    pct_fat: v.pctFat,
    regions: v.regions.map(toStoredRegion),
  });
  const compare = (
    name: string,
    recomputed: number | null,
    printed: number | null
  ) =>
    out.push(
      printed == null || recomputed == null
        ? { name, pass: true, detail: 'not evaluated (not printed)' }
        : {
            name,
            pass: Math.abs(recomputed - printed) <= 0.05,
            detail: `recomputed ${recomputed.toFixed(3)} vs printed ${printed}`,
          }
    );
  compare('fmi_printed', worked.fmi, v.printed.fmi);
  compare('lmi_printed', worked.lmi, v.printed.lmi);
  compare('almi_printed', worked.almi, v.printed.almi);
  if (v.vatMassG != null && v.vatVolumeCm3 != null && v.vatVolumeCm3 > 0) {
    const density = v.vatMassG / v.vatVolumeCm3;
    out.push({
      name: 'vat_density',
      pass: density >= 0.9 && density <= 0.95,
      detail: `${density.toFixed(3)} g/cm3 (expected 0.90-0.95)`,
    });
  } else
    out.push({
      name: 'vat_density',
      pass: true,
      detail: 'not evaluated (VAT mass or volume missing)',
    });
  return out;
}

// ---------------------------------------------------------------------------
// Prefill
// ---------------------------------------------------------------------------
/** A value the report did not print is left out, never sent as null or an empty string. */
const given = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined ? undefined : value;
const words = (value: string | null, max: number): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/**
 * A parsed report as the DEXA form's input. Only what the report printed is set: no facility, no
 * conditions, no notes. The scanner is "Hologic <model>". The scan date is the printed date, or
 * left out when the printed date could not be read.
 */
export function hologicScanToPrefill(
  scan: ParsedHologicScan
): BodyCompReportPrefill {
  const { header: h, totals, vat, bone, indices } = scan;
  const prefill: BodyCompReportPrefill = {
    scanned_day: given(h.scanDate),
    device_label: h.deviceModel ? `Hologic ${h.deviceModel}` : 'Hologic',
    device_serial: words(h.deviceSerial, 60),
    software_version: words(h.softwareVersion, 60),
    scan_mode: words(h.scanMode, 60),
    reference_population: words(h.referencePopulation, 100),
    sex: h.sex,
    age_years: h.ageYears,
    height_cm: h.heightCm,
    clinic_weight_kg: given(h.clinicWeightKg),
    total_fat_g: totals.totalFatG,
    total_lean_g: totals.totalLeanG,
    total_bmc_g: totals.totalBmcG,
    total_mass_g: totals.totalMassG,
    pct_fat: totals.pctFat,
    pct_fat_yn: given(totals.pctFatYn),
    pct_fat_am: given(totals.pctFatAm),
    vat_mass_g: given(vat.massG),
    vat_volume_cm3: given(vat.volumeCm3),
    vat_area_cm2: given(vat.areaCm2),
    total_bmd_gcm2: given(bone.totalBmdGcm2),
    bmd_t_score: given(bone.tScore),
    bmd_z_score: given(bone.zScore),
    bmd_cv_pct: given(bone.cvPct),
    fmi_yn: given(indices.fmiYn),
    fmi_am: given(indices.fmiAm),
    lmi_yn: given(indices.lmiYn),
    lmi_am: given(indices.lmiAm),
    almi_yn: given(indices.almiYn),
    almi_am: given(indices.almiAm),
    regions: scan.regions.map((r) => ({
      region: r.region,
      fat_g: r.fatG,
      lean_g: r.leanG,
      ...(r.bmcG !== null && { bmc_g: r.bmcG }),
      total_g: r.totalG,
      pct_fat: r.pctFat,
      ...(r.pctFatYn !== null && { pct_fat_yn: r.pctFatYn }),
      ...(r.pctFatAm !== null && { pct_fat_am: r.pctFatAm }),
      ...(r.bmdGcm2 !== null && { bmd_gcm2: r.bmdGcm2 }),
    })),
  };
  for (const key of Object.keys(prefill) as (keyof BodyCompReportPrefill)[])
    if (prefill[key] === undefined) delete prefill[key];
  return prefill;
}
