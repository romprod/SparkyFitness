import type {
  BodyCompRegionValues,
  BodyCompScan,
  NewBodyCompScan,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * DEXA scans of the owner: what each report printed. Nothing here is read by any target, goal or
 * forecast.
 */
type Row = Record<string, unknown>;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const flag = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** pg returns NUMERIC columns as text; the API carries numbers. */
export function toBodyCompScan(row: Row): BodyCompScan {
  // Regions saved before the report fields existed lack them: they read back as not recorded.
  const regions = (
    Array.isArray(row['regions'])
      ? (row['regions'] as BodyCompRegionValues[])
      : []
  ).map((region) => ({
    ...region,
    pct_fat_yn: region.pct_fat_yn ?? null,
    pct_fat_am: region.pct_fat_am ?? null,
    bmd_gcm2: region.bmd_gcm2 ?? null,
  }));
  return {
    id: String(row['id']),
    scanned_day: String(row['scanned_day']),
    device_label: text(row['device_label']),
    device_serial: text(row['device_serial']),
    software_version: text(row['software_version']),
    facility: text(row['facility']),
    sex: row['sex'] as BodyCompScan['sex'],
    age_years: Number(row['age_years']),
    height_cm: Number(row['height_cm']),
    clinic_weight_kg: num(row['clinic_weight_kg']),
    total_fat_g: Number(row['total_fat_g']),
    total_lean_g: Number(row['total_lean_g']),
    total_bmc_g: Number(row['total_bmc_g']),
    total_mass_g: Number(row['total_mass_g']),
    pct_fat: Number(row['pct_fat']),
    vat_mass_g: num(row['vat_mass_g']),
    vat_volume_cm3: num(row['vat_volume_cm3']),
    vat_area_cm2: num(row['vat_area_cm2']),
    total_bmd_gcm2: num(row['total_bmd_gcm2']),
    prep: {
      fasted: flag(row['prep_fasted']),
      fasting_hours: num(row['prep_fasting_hours']),
      no_caffeine: flag(row['prep_no_caffeine']),
      no_training_prior_day: flag(row['prep_no_training_prior_day']),
      active_travel: flag(row['prep_active_travel']),
      euhydrated_voided: flag(row['prep_euhydrated_voided']),
      illness_free_14d: flag(row['prep_illness_free_14d']),
    },
    creatine_status: text(
      row['creatine_status']
    ) as BodyCompScan['creatine_status'],
    carb_pattern_48h: text(
      row['carb_pattern_48h']
    ) as BodyCompScan['carb_pattern_48h'],
    regions,
    notes: text(row['notes']),
    scan_mode: text(row['scan_mode']),
    reference_population: text(row['reference_population']),
    bmd_t_score: num(row['bmd_t_score']),
    bmd_z_score: num(row['bmd_z_score']),
    bmd_cv_pct: num(row['bmd_cv_pct']),
    pct_fat_yn: num(row['pct_fat_yn']),
    pct_fat_am: num(row['pct_fat_am']),
    fmi_yn: num(row['fmi_yn']),
    fmi_am: num(row['fmi_am']),
    lmi_yn: num(row['lmi_yn']),
    lmi_am: num(row['lmi_am']),
    almi_yn: num(row['almi_yn']),
    almi_am: num(row['almi_am']),
  };
}

/** Every scan of the owner, newest first. */
export async function listBodyCompScans(
  owner: string,
  authenticatedUserId?: string
): Promise<BodyCompScan[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT id, scanned_day::text AS scanned_day, device_label, device_serial, software_version,
              facility, sex, age_years, height_cm, clinic_weight_kg, total_fat_g, total_lean_g,
              total_bmc_g, total_mass_g, pct_fat, vat_mass_g, vat_volume_cm3, vat_area_cm2,
              total_bmd_gcm2, prep_fasted, prep_fasting_hours, prep_no_caffeine,
              prep_no_training_prior_day, prep_active_travel, prep_euhydrated_voided,
              prep_illness_free_14d, creatine_status, carb_pattern_48h, regions, notes,
              scan_mode, reference_population, bmd_t_score, bmd_z_score, bmd_cv_pct,
              pct_fat_yn, pct_fat_am, fmi_yn, fmi_am, lmi_yn, lmi_am, almi_yn, almi_am
         FROM body_comp_scans
        WHERE user_id = $1
        ORDER BY scanned_day DESC, created_at DESC`,
      [owner]
    );
    return (rows as Row[]).map(toBodyCompScan);
  } finally {
    client.release();
  }
}

export async function createBodyCompScan(
  owner: string,
  scan: NewBodyCompScan,
  authenticatedUserId?: string
): Promise<string> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { prep } = scan;
    const { rows } = await client.query(
      `INSERT INTO body_comp_scans (
         user_id, scanned_day, device_label, device_serial, software_version, facility, sex,
         age_years, height_cm, clinic_weight_kg, total_fat_g, total_lean_g, total_bmc_g,
         total_mass_g, pct_fat, vat_mass_g, vat_volume_cm3, vat_area_cm2, total_bmd_gcm2,
         prep_fasted, prep_fasting_hours, prep_no_caffeine, prep_no_training_prior_day,
         prep_active_travel, prep_euhydrated_voided, prep_illness_free_14d, creatine_status,
         carb_pattern_48h, regions, notes, scan_mode, reference_population, bmd_t_score,
         bmd_z_score, bmd_cv_pct, pct_fat_yn, pct_fat_am, fmi_yn, fmi_am, lmi_yn, lmi_am,
         almi_yn, almi_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               $23,$24,$25,$26,$27,$28,$29::jsonb,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
               $41,$42,$43)
       RETURNING id`,
      [
        owner,
        scan.scanned_day,
        scan.device_label,
        scan.device_serial,
        scan.software_version,
        scan.facility,
        scan.sex,
        scan.age_years,
        scan.height_cm,
        scan.clinic_weight_kg,
        scan.total_fat_g,
        scan.total_lean_g,
        scan.total_bmc_g,
        scan.total_mass_g,
        scan.pct_fat,
        scan.vat_mass_g,
        scan.vat_volume_cm3,
        scan.vat_area_cm2,
        scan.total_bmd_gcm2,
        prep.fasted,
        // How long fasted only means something when fasted is yes.
        prep.fasted === true ? prep.fasting_hours : null,
        prep.no_caffeine,
        prep.no_training_prior_day,
        prep.active_travel,
        prep.euhydrated_voided,
        prep.illness_free_14d,
        scan.creatine_status,
        scan.carb_pattern_48h,
        JSON.stringify(scan.regions),
        scan.notes,
        scan.scan_mode,
        scan.reference_population,
        scan.bmd_t_score,
        scan.bmd_z_score,
        scan.bmd_cv_pct,
        scan.pct_fat_yn,
        scan.pct_fat_am,
        scan.fmi_yn,
        scan.fmi_am,
        scan.lmi_yn,
        scan.lmi_am,
        scan.almi_yn,
        scan.almi_am,
      ]
    );
    return (rows[0] as { id: string }).id;
  } finally {
    client.release();
  }
}

/** Deletes a scan of the owner. A scan already gone counts as deleted. */
export async function deleteBodyCompScan(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<void> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    await client.query(
      'DELETE FROM body_comp_scans WHERE user_id = $1 AND id = $2',
      [owner, id]
    );
  } finally {
    client.release();
  }
}
