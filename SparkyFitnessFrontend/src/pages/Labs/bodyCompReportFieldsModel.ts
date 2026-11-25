import type { BodyCompRegionValues, BodyCompScan } from '@workspace/shared';
import { signed } from './bodyCompFormat';

/**
 * What a DEXA report printed beyond grams, as Pitstop's ScanDetail lays it out: percentiles
 * against the scanner's reference population, bone density scores, the report's own site precision
 * and the scan mode. Pure. A percentile is a position in a population, never a target.
 */

export interface ReportField {
  /** Translation key suffix under labs.bodyComp.report. */
  key: string;
  /** English default. */
  label: string;
  value: string;
}

/** The scan's T-score is shown from age 50; under that the Z-score is the one that applies. */
export const showTScore = (scan: Pick<BodyCompScan, 'age_years'>): boolean =>
  scan.age_years >= 50;

const NOT_PRINTED = 'not printed';
const percentile = (value: number | null | undefined) =>
  value === null || value === undefined ? null : value.toFixed(0);

/**
 * The percentile and bone density fields for one scan's detail. The % fat percentiles always
 * appear ("not printed" when null); the index percentiles appear only when printed; the T-score
 * appears only from age 50.
 */
export function reportFields(scan: BodyCompScan): ReportField[] {
  const fields: ReportField[] = [
    {
      key: 'pctFatYn',
      label: '% fat percentile (young-normal)',
      value: percentile(scan.pct_fat_yn) ?? NOT_PRINTED,
    },
    {
      key: 'pctFatAm',
      label: '% fat percentile (age-matched)',
      value: percentile(scan.pct_fat_am) ?? NOT_PRINTED,
    },
  ];
  const optional: [string, string, number | null | undefined][] = [
    ['fmiYn', 'FMI percentile (young-normal)', scan.fmi_yn],
    ['fmiAm', 'FMI percentile (age-matched)', scan.fmi_am],
    ['lmiYn', 'LMI percentile (young-normal)', scan.lmi_yn],
    ['lmiAm', 'LMI percentile (age-matched)', scan.lmi_am],
    ['almiYn', 'ALMI percentile (young-normal)', scan.almi_yn],
    ['almiAm', 'ALMI percentile (age-matched)', scan.almi_am],
  ];
  for (const [key, label, value] of optional) {
    const text = percentile(value);
    if (text !== null) fields.push({ key, label, value: text });
  }
  fields.push({
    key: 'bmdZ',
    label: 'BMD Z-score',
    value:
      scan.bmd_z_score === null || scan.bmd_z_score === undefined
        ? '—'
        : signed(scan.bmd_z_score, 1),
  });
  if (showTScore(scan))
    fields.push({
      key: 'bmdT',
      label: 'BMD T-score',
      value:
        scan.bmd_t_score === null || scan.bmd_t_score === undefined
          ? '—'
          : signed(scan.bmd_t_score, 1),
    });
  if (scan.bmd_cv_pct !== null && scan.bmd_cv_pct !== undefined)
    fields.push({
      key: 'bmdCv',
      label: 'Site BMD CV %',
      value: `${scan.bmd_cv_pct.toFixed(2)} %`,
    });
  return fields;
}

/** The device and report settings that were printed: which scanner, in what mode, against what population. */
export function scannerFields(scan: BodyCompScan): ReportField[] {
  const fields: ReportField[] = [];
  const device = [scan.device_label, scan.software_version]
    .filter((part): part is string => !!part)
    .join(' · ');
  if (device) fields.push({ key: 'device', label: 'Device', value: device });
  if (scan.scan_mode)
    fields.push({ key: 'scanMode', label: 'Scan mode', value: scan.scan_mode });
  if (scan.reference_population)
    fields.push({
      key: 'referencePopulation',
      label: 'Reference population',
      value: scan.reference_population,
    });
  return fields;
}

/** Which of the region table's extra columns any region fills. */
export function regionReportColumns(
  regions: readonly Pick<
    BodyCompRegionValues,
    'pct_fat_yn' | 'pct_fat_am' | 'bmd_gcm2'
  >[]
): { pctFatYn: boolean; pctFatAm: boolean; bmd: boolean } {
  const has = (v: number | null | undefined) => v !== null && v !== undefined;
  return {
    pctFatYn: regions.some((r) => has(r.pct_fat_yn)),
    pctFatAm: regions.some((r) => has(r.pct_fat_am)),
    bmd: regions.some((r) => has(r.bmd_gcm2)),
  };
}
