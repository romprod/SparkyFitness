import {
  exactLabResultValue,
  LAB_MARKER_PRESETS,
  labResultStatus,
  sameLabUnit,
  type LabRangeStatus,
  type LabResultResponse,
} from '@workspace/shared';
import { labNumber } from './labFormat';

export interface LabOptimalBand {
  low: number | null;
  high: number | null;
}

interface UnitBand extends LabOptimalBand {
  unit: string;
}

/**
 * Pitstop's built-in "optimal" targets, keyed by built-in marker key, one band
 * per unit. For reference only, not medical advice. A band sits inside (or
 * beside) the lab's own reference range and never replaces it.
 *
 * Unit conversions used for the second unit of each marker:
 * - cholesterol (total, LDL, HDL): mmol/L = mg/dL / 38.67; 200 mg/dL = 5.2
 * - triglycerides: mmol/L = mg/dL / 88.57; 150 mg/dL = 1.7
 * - HbA1c: IFCC mmol/mol = (% - 2.15) x 10.929, so 4.0-5.4 % = 20.2-35.5
 * - glucose: mmol/L = mg/dL / 18.016; 72-97 mg/dL = 4.0-5.4
 * - CRP: mg/dL = mg/L / 10
 * - vitamin D: nmol/L = ng/mL x 2.496; 30-60 ng/mL = 75-150
 * - eGFR is per 1.73 m2 by definition, so a lab printing plain mL/min means
 *   the same quantity (this holds only in this table, not for unit matching
 *   elsewhere).
 */
export const LAB_OPTIMAL_BANDS: Readonly<Record<string, readonly UnitBand[]>> =
  {
    egfr: [
      { low: 90, high: null, unit: 'mL/min/1.73m²' },
      // Some labs print the square as "*2" (UK reports seen in Sparky data).
      { low: 90, high: null, unit: 'mL/min/1.73m*2' },
      { low: 90, high: null, unit: 'mL/min' },
    ],
    total_cholesterol: [
      { low: null, high: 5.2, unit: 'mmol/L' },
      { low: null, high: 200, unit: 'mg/dL' },
    ],
    ldl: [
      { low: null, high: 2.6, unit: 'mmol/L' },
      { low: null, high: 100, unit: 'mg/dL' },
    ],
    hdl: [
      { low: 1.3, high: null, unit: 'mmol/L' },
      { low: 50, high: null, unit: 'mg/dL' },
    ],
    triglycerides: [
      { low: null, high: 1.7, unit: 'mmol/L' },
      { low: null, high: 150, unit: 'mg/dL' },
    ],
    hba1c: [
      { low: 4.0, high: 5.4, unit: '%' },
      { low: 20.2, high: 35.5, unit: 'mmol/mol' },
    ],
    fasting_glucose: [
      { low: 4.0, high: 5.4, unit: 'mmol/L' },
      { low: 72, high: 97, unit: 'mg/dL' },
    ],
    tsh: [{ low: 0.5, high: 2.5, unit: 'mIU/L' }],
    crp: [
      { low: null, high: 1.0, unit: 'mg/L' },
      { low: null, high: 0.1, unit: 'mg/dL' },
    ],
    vitamin_d: [
      { low: 75, high: 150, unit: 'nmol/L' },
      { low: 30, high: 60, unit: 'ng/mL' },
    ],
  };

const findBand = (
  markerKey: string | null | undefined,
  unit: string | null | undefined
): UnitBand | null => {
  if (!markerKey) return null;
  const bands = LAB_OPTIMAL_BANDS[markerKey];
  if (!bands) return null;
  // A blank unit is read in the marker's own unit, as Sparky reads results.
  const readUnit = unit?.trim()
    ? unit
    : LAB_MARKER_PRESETS.find((p) => p.key === markerKey)?.unit;
  if (!readUnit) return null;
  return bands.find((b) => sameLabUnit(readUnit, b.unit, markerKey)) ?? null;
};

/** The optimal target for a built-in marker in a unit, or null when none applies. */
export const labOptimalBand = (
  markerKey: string | null | undefined,
  unit: string | null | undefined
): LabOptimalBand | null => {
  const band = findBand(markerKey, unit);
  return band ? { low: band.low, high: band.high } : null;
};

/** "4–5.4 %", "≥ 90 mL/min/1.73m²", "≤ 2.6 mmol/L", or null with no band. */
export const labOptimalText = (
  markerKey: string | null | undefined,
  unit: string | null | undefined
): string | null => {
  const band = findBand(markerKey, unit);
  if (!band) return null;
  const suffix = ` ${unit?.trim() ? unit.trim() : band.unit}`;
  if (band.low !== null && band.high !== null)
    return `${labNumber(band.low)}–${labNumber(band.high)}${suffix}`;
  if (band.high !== null) return `≤ ${labNumber(band.high)}${suffix}`;
  if (band.low !== null) return `≥ ${labNumber(band.low)}${suffix}`;
  return null;
};

/** Amber badge styling for Borderline, between In range and Low/High. */
export const BORDERLINE_BADGE_CLASS =
  'border-amber-500/40 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/40';

export type LabResultFlag = 'low' | 'high' | 'borderline' | LabRangeStatus;

/**
 * Low/High (outside the lab range) win; otherwise an exact value outside the
 * marker's optimal band is borderline, whether or not a range was judged.
 */
export const labOptimalFlag = (
  markerKey: string | null | undefined,
  unit: string | null | undefined,
  value: number | null,
  status: LabRangeStatus
): LabResultFlag => {
  if (value === null) return 'unknown';
  if (status === 'low' || status === 'high') return status;
  const band = labOptimalBand(markerKey, unit);
  if (
    band &&
    ((band.low !== null && value < band.low) ||
      (band.high !== null && value > band.high))
  )
    return 'borderline';
  return status;
};

/** A result's flag: its range status plus "borderline" against the optimal band. */
export const labResultFlag = (
  result: Pick<LabResultResponse, 'value_numeric' | 'unit' | 'marker_key'> &
    Partial<Pick<LabResultResponse, 'value_text'>> &
    Parameters<typeof labResultStatus>[0],
  fallback: Parameters<typeof labResultStatus>[1]
): LabResultFlag =>
  labOptimalFlag(
    result.marker_key,
    result.unit,
    exactLabResultValue(result),
    labResultStatus(result, fallback)
  );
