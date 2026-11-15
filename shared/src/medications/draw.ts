import { Decimal } from 'decimal.js';
import { z } from 'zod';

// Match the reference engine without changing Decimal's process-wide configuration.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
function decimalMeets(value: string, positive: boolean) {
  try {
    const n = new D(value);
    return n.isFinite() && (positive ? n.gt(0) : n.gte(0));
  } catch {
    return false;
  }
}
const decimalString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      return new D(value).isFinite();
    } catch {
      return false;
    }
  }, 'Enter a finite decimal value');
const positiveDecimal = decimalString.refine(
  (value) => decimalMeets(value, true),
  'Must be positive'
);
export const medicationDeviceTypeSchema = z.enum(['syringe', 'pen', 'pump']);
export type MedicationDeviceType = z.infer<typeof medicationDeviceTypeSchema>;
export const medicationSyringeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    device_type: medicationDeviceTypeSchema.optional(),
    graduation_type: z.enum(['units', 'ml']),
    units_per_ml: z.number().int().positive(),
    capacity_ml: positiveDecimal,
    capacity_units: z.number().int().nonnegative(),
    increment: positiveDecimal,
  })
  .refine(
    (device) => device.device_type === 'pump' || device.capacity_units > 0,
    {
      path: ['capacity_units'],
    }
  );
export type MedicationSyringeInput = z.input<
  typeof medicationSyringeInputSchema
>;
export interface MedicationSyringe extends MedicationSyringeInput {
  id: string;
  is_shared?: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
export interface MedicationSyringeListResponse {
  syringes: MedicationSyringe[];
  default_syringe_id: string | null;
}
export const drawDoseSchema = z.object({
  value: decimalString.refine(
    (value) => decimalMeets(value, false),
    'Dose cannot be negative'
  ),
  unit: z.enum(['mcg', 'mg', 'ml', 'units']),
});
export type DrawDoseUnit = z.infer<typeof drawDoseSchema>['unit'];
export const deviceDoseSchema = drawDoseSchema.extend({
  unit: z.enum(['mcg', 'mg', 'ml', 'units', 'pumps']),
});
export const positiveDeviceDoseSchema = deviceDoseSchema.refine(
  (dose) => decimalMeets(dose.value, true),
  'Enter a positive dose'
);
export type DeviceDose = z.infer<typeof deviceDoseSchema>;

export function pumpsToMl(value: string, increment: string): string {
  const count = new D(value);
  const step = new D(increment);
  if (!count.isFinite() || count.lt(0) || !step.isFinite() || step.lte(0))
    throw new Error('Invalid pump count or spray volume');
  return count.times(step).toString();
}

export function mlToPumps(value: string, increment: string): string {
  const volume = new D(value);
  const step = new D(increment);
  if (!volume.isFinite() || volume.lt(0) || !step.isFinite() || step.lte(0))
    throw new Error('Invalid pump volume or spray volume');
  return volume.div(step).toString();
}

/** Reconstruct only delivered quantities; never invent an original requested target. */
export function recordedDoseForEdit(
  entry: {
    dose_mg: string | number | null;
    dose_mg_exact?: string | null;
    volume_ml?: string | null;
    syringe_units?: string | null;
    dose_input_unit?: string | null;
  },
  device?: Pick<
    MedicationSyringeInput,
    'device_type' | 'increment' | 'units_per_ml'
  > | null
): DeviceDose | null {
  try {
    const unit = drawDoseSchema.shape.unit.parse(entry.dose_input_unit ?? 'mg');
    let value: string;
    if (unit === 'ml') {
      if (entry.volume_ml == null) return null;
      if (device?.device_type === 'pump')
        return {
          value: mlToPumps(entry.volume_ml, device.increment),
          unit: 'pumps',
        };
      value = entry.volume_ml;
    } else if (unit === 'units') {
      if (entry.syringe_units != null) value = entry.syringe_units;
      else return null;
    } else {
      const mass = entry.dose_mg_exact ?? entry.dose_mg;
      if (mass == null) return null;
      value = new D(mass).times(unit === 'mcg' ? 1000 : 1).toString();
    }
    return deviceDoseSchema.parse({ value, unit });
  } catch {
    return null;
  }
}

/** Pumps are a request/display unit; the canonical engine and history use mL. */
export function normalizeDeviceDose(
  input: DeviceDose,
  device: Pick<MedicationSyringeInput, 'device_type' | 'increment'>
): z.infer<typeof drawDoseSchema> {
  const dose = deviceDoseSchema.parse(input);
  if (dose.unit === 'pumps') {
    if (device.device_type !== 'pump')
      throw new Error('Pump counts require a nasal pump');
    return { value: pumpsToMl(dose.value, device.increment), unit: 'ml' };
  }
  if (device.device_type === 'pump' && dose.unit === 'units')
    throw new Error('Insulin units cannot be used with a nasal pump');
  return drawDoseSchema.parse(dose);
}

/** Normalize hidden legacy fields of a fixed-volume pump on every save. */
export function normalizeMedicationDevice(input: MedicationSyringeInput) {
  const parsed = medicationSyringeInputSchema.parse(input);
  const device = {
    ...parsed,
    device_type: parsed.device_type ?? ('syringe' as const),
  };
  if (device.device_type !== 'pump') return device;
  return {
    ...device,
    graduation_type: 'ml' as const,
    capacity_units: new D(device.capacity_ml)
      .div(device.increment)
      .toDecimalPlaces(0, D.ROUND_HALF_UP)
      .toNumber(),
  };
}
export const calculatedDrawInputSchema = z.object({
  syringe_id: z.string().uuid(),
  dose: deviceDoseSchema,
  expected_preview_state: z.string().optional(),
  review_intent: z.boolean().optional(),
});
export type CalculatedDrawInput = z.infer<typeof calculatedDrawInputSchema>;
export const drawPreviewInputSchema = calculatedDrawInputSchema.extend({
  editing_injection_id: z.string().uuid().optional(),
});
export type DrawPreviewInput = z.infer<typeof drawPreviewInputSchema>;
export interface DrawWarning {
  code:
    | 'EXCEEDS_SYRINGE_CAPACITY'
    | 'EXCEEDS_REMAINING_VIAL'
    | 'BELOW_MEASURABLE_MINIMUM'
    | 'FULL_BARREL'
    | 'ROUNDING_ERROR_HIGH';
  severity: 'warn' | 'block';
  message: string;
}
export interface DrawResult {
  /** Ephemeral preview metadata from the same saved syringe used for this draw. */
  syringeCapacityMl?: string;
  administrationRoute?: 'injection' | 'nasal';
  doseInputUnit?: DrawDoseUnit;
  review?: {
    state: string;
    previous?: { doseMg: string; volumeMl: string };
    remainingBeforeMl: string | null;
    remainingAfterMl: string | null;
  };
  device?: {
    id: string;
    device_type: MedicationDeviceType;
    increment: string;
    capacity_ml: string;
    graduation_type: 'units' | 'ml';
    units_per_ml: number;
  };
  targetMassMcg: string;
  targetVolumeMl: string;
  rawUnits: string;
  markingValue: string;
  markingScale: 'units' | 'ml';
  deliveredMassMcg: string;
  deliveredVolumeMl: string;
  roundingErrorMcg: string;
  warnings: DrawWarning[];
}
/** Exact reference arithmetic. Guardrails compare target volume, not rounded volume. */
export function computeDraw(args: {
  dose: z.infer<typeof drawDoseSchema>;
  concentrationMcgPerMl: string;
  syringe: MedicationSyringeInput;
  remainingMl?: string;
}): DrawResult {
  const dose = drawDoseSchema.parse(args.dose);
  const syringe = medicationSyringeInputSchema.parse(args.syringe);
  const concentration = new D(args.concentrationMcgPerMl);
  if (!concentration.isFinite() || concentration.lte(0))
    throw new Error('Concentration must be greater than zero');
  const value = new D(dose.value);
  const targetVolumeMl =
    dose.unit === 'ml'
      ? value
      : dose.unit === 'units'
        ? value.div(syringe.units_per_ml)
        : (dose.unit === 'mg' ? value.times(1000) : value).div(concentration);
  const targetMassMcg =
    dose.unit === 'mg'
      ? value.times(1000)
      : dose.unit === 'mcg'
        ? value
        : targetVolumeMl.times(concentration);
  const rawUnits = targetVolumeMl.times(syringe.units_per_ml);
  const markingValue = (
    syringe.graduation_type === 'units' ? rawUnits : targetVolumeMl
  )
    .div(syringe.increment)
    .toDecimalPlaces(0, D.ROUND_HALF_UP)
    .times(syringe.increment);
  const deliveredVolumeMl =
    syringe.graduation_type === 'units'
      ? markingValue.div(syringe.units_per_ml)
      : markingValue;
  const deliveredMassMcg = deliveredVolumeMl.times(concentration);
  const roundingErrorMcg = deliveredMassMcg.minus(targetMassMcg);
  const capacity = new D(syringe.capacity_ml);
  const warnings: DrawWarning[] = [];
  const fmt = (v: Decimal) => v.toDecimalPlaces(3).toString();
  if (targetVolumeMl.gt(capacity))
    warnings.push({
      code: 'EXCEEDS_SYRINGE_CAPACITY',
      severity: 'block',
      message: `Requested volume: ${fmt(targetVolumeMl)} mL. ${syringe.name} holds ${fmt(capacity)} mL.`,
    });
  if (args.remainingMl !== undefined) {
    const remaining = new D(args.remainingMl);
    if (!remaining.isFinite() || remaining.lt(0))
      throw new Error('Remaining volume must be finite and nonnegative');
    if (targetVolumeMl.gt(remaining))
      warnings.push({
        code: 'EXCEEDS_REMAINING_VIAL',
        severity: 'block',
        message: `Requested volume: ${fmt(targetVolumeMl)} mL; vial balance: ${fmt(remaining)} mL.`,
      });
  }
  if (syringe.graduation_type === 'units' && rawUnits.gt(0) && rawUnits.lt(2))
    warnings.push({
      code: 'BELOW_MEASURABLE_MINIMUM',
      severity: 'warn',
      message: `The unrounded draw is ${rawUnits.toDecimalPlaces(2).toString()} units, below the 2-unit measurement threshold.`,
    });
  if (targetVolumeMl.equals(capacity))
    warnings.push({
      code: 'FULL_BARREL',
      severity: 'warn',
      message: `This draw reaches the capacity of ${syringe.name}.`,
    });
  if (targetMassMcg.gt(0)) {
    const error = roundingErrorMcg.abs().div(targetMassMcg);
    if (error.gt('0.05'))
      warnings.push({
        code: 'ROUNDING_ERROR_HIGH',
        severity: 'warn',
        message: `The nearest graduation gives ${deliveredMassMcg.toDecimalPlaces(1).toString()} mcg for a ${targetMassMcg.toDecimalPlaces(1).toString()} mcg target; the difference is ${error.times(100).toDecimalPlaces(1).toString()}%.`,
      });
  }
  return {
    targetMassMcg: targetMassMcg.toString(),
    targetVolumeMl: targetVolumeMl.toString(),
    rawUnits: rawUnits.toString(),
    markingValue: markingValue.toString(),
    markingScale: syringe.graduation_type,
    deliveredMassMcg: deliveredMassMcg.toString(),
    deliveredVolumeMl: deliveredVolumeMl.toString(),
    roundingErrorMcg: roundingErrorMcg.toString(),
    warnings,
  };
}
/** Preserves labelled preparation precision; legacy concentration is used only when no snapshot exists. */
export function drawConcentration(input: {
  mass_value?: string | number;
  mass_unit?: 'mg' | 'mcg';
  final_volume_ml?: string | number;
  concentration_mg_ml?: string | number;
}) {
  return input.mass_value !== undefined && input.final_volume_ml !== undefined
    ? new D(input.mass_value)
        .times(input.mass_unit === 'mcg' ? 1 : 1000)
        .div(input.final_volume_ml)
        .toString()
    : new D(input.concentration_mg_ml ?? 0).times(1000).toString();
}
export function drawDeliveredMg(result: DrawResult) {
  return new D(result.deliveredMassMcg).div(1000).toString();
}

export function remainingDrawVolume(
  concentrationMcgPerMl: string,
  totalVolumeMl: string,
  usedMassMg: string,
  creditedMassMg: string = '0',
  addedMassMg: string = '0'
) {
  return D.max(
    0,
    new D(totalVolumeMl).minus(
      new D(usedMassMg)
        .minus(creditedMassMg)
        .plus(addedMassMg)
        .times(1000)
        .div(concentrationMcgPerMl)
    )
  ).toString();
}

export const positiveDrawDoseSchema = drawDoseSchema.refine(
  (dose) => decimalMeets(dose.value, true),
  'Enter a positive dose'
);

/** Source target figures: decimal rounding for display, without insignificant zeros. */
export function drawTargetDisplay(
  draw: Pick<DrawResult, 'targetMassMcg' | 'targetVolumeMl' | 'rawUnits'>
) {
  return {
    mcg: new D(draw.targetMassMcg).toDecimalPlaces(1).toString(),
    mg: new D(draw.targetMassMcg).div(1000).toDecimalPlaces(3).toString(),
    ml: new D(draw.targetVolumeMl).toDecimalPlaces(3).toString(),
    units: new D(draw.rawUnits).toDecimalPlaces(1).toString(),
  };
}
/** Convert to a native number only at the visual boundary. */
export function drawTargetFillFraction(
  targetVolumeMl: string,
  capacityMl: string
): number | null {
  try {
    const volume = new D(targetVolumeMl),
      capacity = new D(capacityMl);
    if (
      !volume.isFinite() ||
      volume.lt(0) ||
      !capacity.isFinite() ||
      capacity.lte(0)
    )
      return null;
    return D.min(1, D.max(0, volume.div(capacity))).toNumber();
  } catch {
    return null;
  }
}
