import type { BodyCompRegionValues, BodyCompScan } from '@workspace/shared';

export const region = (
  name: BodyCompRegionValues['region'],
  fat: number,
  lean: number,
  bmc: number | null,
  extra: Partial<BodyCompRegionValues> = {}
): BodyCompRegionValues => ({
  region: name,
  fat_g: fat,
  lean_g: lean,
  bmc_g: bmc,
  total_g: fat + lean + (bmc ?? 0),
  pct_fat: Math.round((fat / (fat + lean + (bmc ?? 0))) * 1000) / 10,
  ...extra,
});

export const SIX_REGIONS = (): BodyCompRegionValues[] => [
  region('l_arm', 1000, 4000, 200),
  region('r_arm', 1000, 4400, 220),
  region('trunk', 10000, 27000, 900),
  region('l_leg', 3000, 10000, 700),
  region('r_leg', 3000, 10600, 740),
  region('head', 2000, 4000, 240),
];

/** A whole-body scan with every conditions answer given, so two of them are alike unless patched. */
export const makeScan = (patch: Partial<BodyCompScan> = {}): BodyCompScan => ({
  id: '00000000-0000-4000-a000-0000000000a1',
  scanned_day: '2026-08-10',
  device_label: 'Hologic Horizon A',
  device_serial: 'S1',
  software_version: '13.6',
  facility: 'City clinic',
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  clinic_weight_kg: 83,
  total_fat_g: 20000,
  total_lean_g: 60000,
  total_bmc_g: 3000,
  total_mass_g: 83000,
  pct_fat: 24.1,
  vat_mass_g: 800,
  vat_volume_cm3: null,
  vat_area_cm2: null,
  total_bmd_gcm2: 1.31,
  prep: {
    fasted: true,
    fasting_hours: 12,
    no_caffeine: true,
    no_training_prior_day: true,
    active_travel: false,
    euhydrated_voided: true,
    illness_free_14d: true,
  },
  creatine_status: 'none',
  carb_pattern_48h: null,
  regions: SIX_REGIONS(),
  notes: null,
  ...patch,
});
