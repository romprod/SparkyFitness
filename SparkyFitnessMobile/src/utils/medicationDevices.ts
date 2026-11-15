import type { TFunction } from 'i18next';
import type {
  DeviceDose,
  MedicationDeviceType,
  MedicationSyringe,
} from '@workspace/shared';

export function deviceDoseUnitOptions(
  type: MedicationDeviceType | undefined,
  t: TFunction
): { value: DeviceDose['unit']; label: string }[] {
  const mass: { value: DeviceDose['unit']; label: string }[] = [
    {
      value: 'mcg',
      label: t('medications.preparation.unitMcg', { defaultValue: 'mcg' }),
    },
    {
      value: 'mg',
      label: t('medications.preparation.unitMg', { defaultValue: 'mg' }),
    },
  ];
  return type === 'pump'
    ? [
        {
          value: 'pumps',
          label: t('medications.devices.pumps', { defaultValue: 'Pumps' }),
        },
        ...mass,
      ]
    : [
        ...mass,
        {
          value: 'ml',
          label: t('medications.syringes.ml', { defaultValue: 'mL' }),
        },
        {
          value: 'units',
          label: t('medications.syringes.units', { defaultValue: 'Units' }),
        },
      ];
}
export const deviceCalibrationContext = (
  device: MedicationSyringe | undefined
) =>
  device
    ? [
        device.id,
        device.device_type ?? 'syringe',
        device.graduation_type,
        device.units_per_ml,
        device.capacity_ml,
        device.capacity_units,
        device.increment,
      ]
    : null;
