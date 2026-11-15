import { Decimal } from 'decimal.js';
import {
  medicationPreparationInputSchema,
  type MedicationPreparationCreationInput,
  type MedicationPreparationInput,
} from '../schemas/api/MedicationPreparation.api.zod.ts';
import {
  computeDraw,
  normalizeDeviceDose,
  normalizeMedicationDevice,
  type DeviceDose,
  type DrawResult,
  type MedicationSyringeInput,
} from './draw.ts';
import { preparationCorrectionValues } from './preparationCorrection.ts';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function preparationCreationValues(
  raw: MedicationPreparationCreationInput | MedicationPreparationInput
): ReturnType<typeof preparationCorrectionValues> | null {
  const parsed = medicationPreparationInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data;
  const volume =
    'final_volume_ml_exact' in raw &&
    typeof raw.final_volume_ml_exact === 'string'
      ? raw.final_volume_ml_exact
      : (input.final_volume_ml_exact ?? String(input.final_volume_ml));
  const mass =
    'mass_value_exact' in raw && typeof raw.mass_value_exact === 'string'
      ? raw.mass_value_exact
      : (input.mass_value_exact ?? String(input.mass_value));

  try {
    return preparationCorrectionValues(
      input.mode === 'premixed' && input.label_concentration_value !== undefined
        ? {
            mode: 'premixed',
            label_concentration_value: input.label_concentration_value,
            label_concentration_unit: 'mg/ml',
            final_volume_ml: volume,
            prepared_date: input.prepared_date,
          }
        : {
            mode: 'reconstituted',
            mass_value: mass,
            mass_unit: input.mass_unit,
            final_volume_ml: volume,
            prepared_date: input.prepared_date,
          }
    );
  } catch {
    return null;
  }
}

/** Source creation review only: saving this preparation never records a dose. */
export function previewPreparationCreation(
  raw: MedicationPreparationCreationInput,
  target: DeviceDose | null,
  device: (MedicationSyringeInput & { id?: string }) | null
): {
  values: {
    mass_mg: string;
    concentration_mg_ml: string;
    final_volume_ml: string;
  };
  draw: DrawResult | null;
  doses_in_vial: string | null;
} | null {
  const values = preparationCreationValues(raw);
  if (!values) return null;
  const result = {
    values: {
      mass_mg: values.mass_mg,
      concentration_mg_ml: values.concentration_mg_ml,
      final_volume_ml: values.final_volume_ml,
    },
    draw: null as DrawResult | null,
    doses_in_vial: null as string | null,
  };
  if (!target || !device) return result;
  try {
    const normalized = normalizeMedicationDevice(device);
    const draw = computeDraw({
      dose: normalizeDeviceDose(target, normalized),
      concentrationMcgPerMl: new D(values.concentration_mg_ml)
        .times(1000)
        .toString(),
      syringe: normalized,
      remainingMl: values.final_volume_ml,
    });
    draw.syringeCapacityMl = normalized.capacity_ml;
    if (device.id)
      draw.device = {
        id: device.id,
        device_type: normalized.device_type,
        increment: normalized.increment,
        capacity_ml: normalized.capacity_ml,
        graduation_type: normalized.graduation_type,
        units_per_ml: normalized.units_per_ml,
      };
    result.draw = draw;
    const targetVolume = new D(draw.targetVolumeMl);
    if (targetVolume.isFinite() && targetVolume.gt(0))
      result.doses_in_vial = new D(values.final_volume_ml)
        .div(targetVolume)
        .floor()
        .toString();
  } catch {
    /* Invalid or mismatched target/device yields no stale draw or yield. */
  }
  return result;
}
