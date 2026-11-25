import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyCompScanInputSchema } from '@workspace/shared';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  createBodyCompScan,
  deleteBodyCompScan,
  listBodyCompScans,
  toBodyCompScan,
} from '../models/bodyCompScanRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const parse = (patch: Record<string, unknown> = {}) =>
  bodyCompScanInputSchema.parse({
    scanned_day: '2026-08-10',
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    total_fat_g: 20000,
    total_lean_g: 60000,
    total_bmc_g: 3000,
    ...patch,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('reading scans back', () => {
  const row = {
    id: 'a1',
    scanned_day: '2026-08-10',
    device_label: null,
    device_serial: 'S1',
    software_version: null,
    facility: 'Clinic',
    sex: 'male',
    age_years: '41',
    height_cm: '180.5',
    clinic_weight_kg: '83.2',
    total_fat_g: '20000.5',
    total_lean_g: '60000',
    total_bmc_g: '3000',
    total_mass_g: '83000.5',
    pct_fat: '24.1',
    vat_mass_g: null,
    vat_volume_cm3: null,
    vat_area_cm2: null,
    total_bmd_gcm2: '1.31',
    prep_fasted: true,
    prep_fasting_hours: '12',
    prep_no_caffeine: null,
    prep_no_training_prior_day: false,
    prep_active_travel: null,
    prep_euhydrated_voided: null,
    prep_illness_free_14d: null,
    creatine_status: 'none',
    carb_pattern_48h: null,
    regions: [
      {
        region: 'trunk',
        fat_g: 1,
        lean_g: 2,
        bmc_g: 3,
        total_g: 6,
        pct_fat: 16.7,
      },
    ],
    notes: null,
    scan_mode: 'Whole Body',
    reference_population: 'NHANES Male',
    bmd_t_score: '-0.4',
    bmd_z_score: '0.2',
    bmd_cv_pct: '1.0',
    pct_fat_yn: '55',
    pct_fat_am: null,
    fmi_yn: '45',
    fmi_am: '38',
    lmi_yn: null,
    lmi_am: null,
    almi_yn: null,
    almi_am: '58',
  };

  it('turns the text numbers pg gives into numbers, and keeps the three-valued answers', () => {
    const scan = toBodyCompScan(row);
    expect(scan).toMatchObject({
      age_years: 41,
      height_cm: 180.5,
      clinic_weight_kg: 83.2,
      total_fat_g: 20000.5,
      total_mass_g: 83000.5,
      pct_fat: 24.1,
      total_bmd_gcm2: 1.31,
      vat_mass_g: null,
      creatine_status: 'none',
    });
    expect(scan.prep).toEqual({
      fasted: true,
      fasting_hours: 12,
      no_caffeine: null,
      no_training_prior_day: false,
      active_travel: null,
      euhydrated_voided: null,
      illness_free_14d: null,
    });
    expect(scan.regions).toHaveLength(1);
  });

  it('reads the report fields as numbers and text, and not recorded as null', () => {
    expect(toBodyCompScan(row)).toMatchObject({
      scan_mode: 'Whole Body',
      reference_population: 'NHANES Male',
      bmd_t_score: -0.4,
      bmd_z_score: 0.2,
      bmd_cv_pct: 1,
      pct_fat_yn: 55,
      pct_fat_am: null,
      fmi_yn: 45,
      almi_am: 58,
    });
  });

  it('reads a scan saved before the report fields existed with nulls, regions included', () => {
    const old: Record<string, unknown> = { ...row };
    for (const key of [
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
    ])
      delete old[key];
    const scan = toBodyCompScan(old);
    expect(scan.scan_mode).toBeNull();
    expect(scan.bmd_t_score).toBeNull();
    expect(scan.almi_am).toBeNull();
    expect(scan.regions[0]).toEqual({
      region: 'trunk',
      fat_g: 1,
      lean_g: 2,
      bmc_g: 3,
      total_g: 6,
      pct_fat: 16.7,
      pct_fat_yn: null,
      pct_fat_am: null,
      bmd_gcm2: null,
    });
  });

  it('reads a scan with no regions as an empty list', () => {
    expect(toBodyCompScan({ ...row, regions: null }).regions).toEqual([]);
  });

  it('lists only the owner’s scans, newest first, and releases the client', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const list = await listBodyCompScans(owner, owner);
    expect(list).toHaveLength(1);
    const [text, params] = mocks.query.mock.calls[0]!;
    expect(String(text)).toContain('WHERE user_id = $1');
    expect(String(text)).toContain('ORDER BY scanned_day DESC');
    expect(params).toEqual([owner]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('saving a scan', () => {
  it('writes the figures, the regions as JSON, and the fasting hours only when fasted', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'new' }], rowCount: 1 });
    const id = await createBodyCompScan(
      owner,
      parse({
        regions: [
          {
            region: 'trunk',
            fat_g: 1,
            lean_g: 2,
            bmc_g: 3,
            total_g: 6,
            pct_fat: 16.7,
          },
        ],
        prep: { fasted: false, fasting_hours: 9 },
      }),
      owner
    );
    expect(id).toBe('new');
    const params = mocks.query.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(owner);
    expect(params.slice(1, 3)).toEqual(['2026-08-10', null]);
    // Total mass and percentage fat were worked out.
    expect(params).toContain(83000);
    expect(params).toContain(24.1);
    // fasted is no, so the hours are not kept.
    const fastedAt = params.indexOf(false);
    expect(params[fastedAt + 1]).toBeNull();
    expect(JSON.parse(String(params[28]))).toHaveLength(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('writes the report fields after the notes, in the order of the columns, and null when not given', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'new' }], rowCount: 1 });
    await createBodyCompScan(
      owner,
      parse({
        notes: 'n',
        scan_mode: 'Whole Body',
        reference_population: 'NHANES Male',
        bmd_t_score: -0.4,
        bmd_cv_pct: 1,
        pct_fat_yn: 50,
        almi_am: 58,
        regions: [
          {
            region: 'trunk',
            fat_g: 1,
            lean_g: 2,
            bmc_g: 3,
            total_g: 6,
            pct_fat: 16.7,
            pct_fat_yn: 48,
            bmd_gcm2: 1.1,
          },
        ],
      })
    );
    const [text, params] = mocks.query.mock.calls[0]! as [string, unknown[]];
    expect(params).toHaveLength(43);
    expect(params.slice(29)).toEqual([
      'n',
      'Whole Body',
      'NHANES Male',
      -0.4,
      null,
      1,
      50,
      null,
      null,
      null,
      null,
      null,
      null,
      58,
    ]);
    expect(String(text)).toContain('$43)');
    expect(String(text)).toMatch(
      /carb_pattern_48h, regions, notes, scan_mode, reference_population, bmd_t_score,\s+bmd_z_score, bmd_cv_pct, pct_fat_yn, pct_fat_am, fmi_yn, fmi_am, lmi_yn, lmi_am,\s+almi_yn, almi_am\)/
    );
    expect(JSON.parse(String(params[28]))[0]).toMatchObject({
      pct_fat_yn: 48,
      bmd_gcm2: 1.1,
    });
  });

  it('keeps the fasting hours when fasted is yes', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'new' }], rowCount: 1 });
    await createBodyCompScan(
      owner,
      parse({ prep: { fasted: true, fasting_hours: 12 } })
    );
    const params = mocks.query.mock.calls[0]![1] as unknown[];
    expect(params[params.indexOf(true) + 1]).toBe(12);
  });

  it('deletes by owner and id, and releases the client', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await deleteBodyCompScan(owner, 'x1', owner);
    expect(mocks.query.mock.calls[0]![1]).toEqual([owner, 'x1']);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
