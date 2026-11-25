import { describe, expect, it } from 'vitest';
import {
  BODY_COMP_EXPORT_HEADERS,
  DEFAULT_BODY_COMP_PRECISION,
  bodyCompChecks,
  bodyCompComparability,
  bodyCompExportRows,
  bodyCompIntervalExposure,
  bodyCompIndices,
  bodyCompScanInputSchema,
  compareBodyCompScans,
  deltaFlag,
  distributionRatios,
  limbAsymmetry,
  nextBodyCompScanWindow,
  toCsv,
  type BodyCompRegionValues,
  type BodyCompScan,
} from '@workspace/shared';

const region = (
  name: BodyCompRegionValues['region'],
  fat: number,
  lean: number,
  bmc: number
): BodyCompRegionValues => {
  const total = fat + lean + bmc;
  return {
    region: name,
    fat_g: fat,
    lean_g: lean,
    bmc_g: bmc,
    total_g: total,
    pct_fat: Math.round((fat / total) * 1000) / 10,
  };
};
// Six body regions that add up exactly to the whole body: fat 20,000, lean 60,000, bone 3,000.
const regions = [
  region('l_arm', 1000, 4000, 200),
  region('r_arm', 1000, 4400, 220),
  region('trunk', 10000, 27000, 900),
  region('l_leg', 3000, 10000, 700),
  region('r_leg', 3000, 10600, 740),
  region('head', 2000, 4000, 240),
];
const scan = (patch: Partial<BodyCompScan> = {}): BodyCompScan => ({
  id: '00000000-0000-4000-8000-000000000001',
  scanned_day: '2026-08-10',
  device_label: 'Hologic Horizon A',
  device_serial: 'S1',
  software_version: '13.6',
  facility: 'Clinic',
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
  total_bmd_gcm2: null,
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
  regions,
  notes: null,
  ...patch,
});

describe('indices', () => {
  it('works fat-free mass, the mass indices and appendicular lean mass from the printed grams', () => {
    const i = bodyCompIndices(scan());
    const h2 = 1.8 * 1.8;
    expect(i.ffm_kg).toBe(63);
    expect(i.ffmi).toBeCloseTo(63 / h2, 10);
    expect(i.lmi).toBeCloseTo(60 / h2, 10);
    expect(i.fmi).toBeCloseTo(20 / h2, 10);
    // Arms and legs: 4000 + 4400 + 10000 + 10600.
    expect(i.alm_kg).toBeCloseTo(29, 10);
    expect(i.almi).toBeCloseTo(29 / h2, 10);
    expect(i.pct_fat_recomputed).toBeCloseTo((20000 / 83000) * 100, 10);
  });

  it('has no appendicular lean mass without all four limbs', () => {
    const i = bodyCompIndices(scan({ regions: regions.slice(0, 3) }));
    expect(i.alm_kg).toBeNull();
    expect(i.almi).toBeNull();
  });
});

describe('checks', () => {
  it('passes a report that agrees with itself', () => {
    const checks = bodyCompChecks(scan());
    expect(checks.map((c) => [c.name, c.evaluated, c.pass])).toEqual([
      ['fat_sum', true, true],
      ['lean_sum', true, true],
      ['bmc_sum', true, true],
      ['mass_sum', true, true],
      ['pct_fat', true, true],
    ]);
  });

  it('flags regions that do not add up to the whole body, and a printed percentage that is off', () => {
    const bad = bodyCompChecks(
      scan({
        total_fat_g: 21000,
        pct_fat: 31,
      })
    );
    expect(bad.find((c) => c.name === 'fat_sum')).toMatchObject({
      pass: false,
      computed: 20000,
      printed: 21000,
    });
    expect(bad.find((c) => c.name === 'pct_fat')!.pass).toBe(false);
    // Within a gram of rounding still passes.
    expect(
      bodyCompChecks(scan({ total_fat_g: 20001 })).find(
        (c) => c.name === 'fat_sum'
      )!.pass
    ).toBe(true);
  });

  it('does not judge the region sums when the regions are incomplete', () => {
    const checks = bodyCompChecks(scan({ regions: regions.slice(0, 4) }));
    expect(
      checks
        .filter((c) => c.name !== 'pct_fat')
        .every((c) => !c.evaluated && c.pass)
    ).toBe(true);
  });
});

describe('shape', () => {
  it('measures right against left lean mass as a share of the pair’s mean', () => {
    const a = limbAsymmetry(scan());
    expect(a.arms_pct).toBeCloseTo(((4400 - 4000) / 4200) * 100, 10);
    expect(a.legs_pct).toBeCloseTo(((10600 - 10000) / 10300) * 100, 10);
    expect(limbAsymmetry(scan({ regions: [] }))).toEqual({
      arms_pct: null,
      legs_pct: null,
    });
  });

  it('works android over gynoid fat and trunk over limb fat when the regions are there', () => {
    const withZones = scan({
      regions: [
        ...regions,
        region('android', 2500, 5000, 0),
        region('gynoid', 3000, 9000, 0),
      ],
    });
    const r = distributionRatios(withZones);
    // The regions print percentage fat to one decimal: 33.3 over 25.0.
    expect(r.android_gynoid).toBeCloseTo(33.3 / 25, 10);
    expect(r.trunk_limb_fat).toBeCloseTo(10000 / 8000, 10);
    expect(distributionRatios(scan({ regions: [] }))).toEqual({
      android_gynoid: null,
      trunk_limb_fat: null,
    });
  });
});

describe('change against noise', () => {
  const band = { technical: 0.3, practical: 0.6 };

  it('calls a change inside the noise, in the grey zone, or past the practical limit, edges counting up', () => {
    expect(deltaFlag(10, 10.29, band).tier).toBe('within_noise');
    expect(deltaFlag(10, 10.3, band).tier).toBe('indeterminate');
    // 16.4 - 16.1 lands a few ULPs under 0.3 and still reaches the edge.
    expect(deltaFlag(16.1, 16.4, band).tier).toBe('indeterminate');
    expect(deltaFlag(10, 10.6, band).tier).toBe('exceeds_lsc');
    expect(deltaFlag(10, 9.2, band)).toMatchObject({
      tier: 'exceeds_lsc',
      delta: expect.closeTo(-0.8, 10),
    });
    expect(deltaFlag(10, 10.9, { technical: 0.3, practical: null }).tier).toBe(
      'indeterminate'
    );
  });

  it('puts fat and lean on their own precision, from the earlier scan', () => {
    const next = scan({
      scanned_day: '2026-11-02',
      total_fat_g: 18000,
      total_lean_g: 61000,
      total_mass_g: 82000,
      pct_fat: 22,
    });
    const out = compareBodyCompScans(scan(), next);
    expect(out.days).toBe(84);
    expect(out.comparability.comparable).toBe(true);
    const fat = out.rows.find((r) => r.key === 'fat_mass')!;
    // 20 kg at 0.78% CV: technical 20 x 0.0078 x 2.77 = 0.432, practical x 1.9.
    expect(fat.flag.band.technical).toBeCloseTo(0.43212, 4);
    expect(fat.flag.band.practical).toBeCloseTo(0.43212 * 1.9, 4);
    expect(fat.flag).toMatchObject({ tier: 'exceeds_lsc', demoted: false });
    expect(fat.flag.delta).toBeCloseTo(-2, 10);
    // 60 kg at 0.52%: technical 0.864; a 1 kg gain is past it but not past x3.4.
    const lean = out.rows.find((r) => r.key === 'lean_mass')!;
    expect(lean.flag.band.technical).toBeCloseTo(0.864, 3);
    expect(lean.flag.tier).toBe('indeterminate');
    expect(out.rows.find((r) => r.key === 'pct_fat')!.flag.delta).toBeCloseTo(
      -2.1,
      10
    );
  });

  it('gives a rate over 30 days only for a real change over at least four weeks', () => {
    const far = scan({
      scanned_day: '2026-11-02',
      total_fat_g: 18000,
      total_mass_g: 81000,
    });
    expect(
      compareBodyCompScans(scan(), far).rows.find((r) => r.key === 'fat_mass')!
        .per_30_days
    ).toBeCloseTo((-2 / 84) * 30, 10);
    const soon = scan({
      scanned_day: '2026-08-20',
      total_fat_g: 18000,
      total_mass_g: 81000,
    });
    expect(
      compareBodyCompScans(scan(), soon).rows.find((r) => r.key === 'fat_mass')!
        .per_30_days
    ).toBeNull();
    const small = scan({
      scanned_day: '2026-11-02',
      total_fat_g: 20100,
      total_mass_g: 83100,
    });
    expect(
      compareBodyCompScans(scan(), small).rows.find(
        (r) => r.key === 'fat_mass'
      )!.per_30_days
    ).toBeNull();
  });

  it('adds appendicular lean mass and visceral fat only when both scans have them', () => {
    const next = scan({ scanned_day: '2026-11-02', vat_mass_g: 500 });
    const keys = compareBodyCompScans(scan(), next).rows.map((r) => r.key);
    expect(keys).toEqual(['fat_mass', 'lean_mass', 'pct_fat', 'alm', 'vat']);
    const bare = compareBodyCompScans(
      scan({ regions: [], vat_mass_g: null }),
      scan({ scanned_day: '2026-11-02', regions: [], vat_mass_g: null })
    );
    expect(bare.rows.map((r) => r.key)).toEqual([
      'fat_mass',
      'lean_mass',
      'pct_fat',
    ]);
  });

  it('shows no numbers across a different scanner or software, only why', () => {
    const out = compareBodyCompScans(
      scan(),
      scan({
        scanned_day: '2026-11-02',
        device_serial: 'S2',
        software_version: '14.0',
      })
    );
    expect(out.rows).toEqual([]);
    expect(out.comparability).toMatchObject({
      hidden: true,
      comparable: false,
    });
    expect(out.comparability.reasons).toEqual([
      'different scanner serial',
      'different analysis software',
    ]);
  });

  it('lowers the verdict one step when the conditions differed, and keeps what the numbers say', () => {
    const next = scan({
      scanned_day: '2026-11-02',
      total_fat_g: 18000,
      total_mass_g: 81000,
      prep: { ...scan().prep, fasted: false },
    });
    const out = compareBodyCompScans(scan(), next);
    expect(out.comparability).toMatchObject({
      comparable: false,
      demote: true,
      hidden: false,
    });
    expect(out.comparability.reasons).toEqual(['fasted: differs']);
    const fat = out.rows.find((r) => r.key === 'fat_mass')!;
    expect(fat.flag).toMatchObject({
      tier: 'indeterminate',
      raw_tier: 'exceeds_lsc',
      demoted: true,
    });
    // Within the noise stays within the noise.
    const calm = compareBodyCompScans(
      scan(),
      scan({
        scanned_day: '2026-11-02',
        prep: { ...scan().prep, fasted: false },
      })
    );
    expect(calm.rows.find((r) => r.key === 'fat_mass')!.flag).toMatchObject({
      tier: 'within_noise',
      demoted: true,
    });
  });

  it('notes conditions not recorded on one scan and a creatine change', () => {
    const a = scan();
    const b = scan({
      prep: { ...scan().prep, no_caffeine: null },
      creatine_status: 'started',
    });
    expect(bodyCompComparability(a, b).reasons).toEqual([
      'no_caffeine: not recorded on one scan',
      'creatine status differs',
    ]);
    expect(bodyCompComparability(a, scan()).comparable).toBe(true);
    // A scanner left blank on either side is not a mismatch.
    expect(
      bodyCompComparability(
        a,
        scan({ device_serial: null, software_version: null })
      ).hidden
    ).toBe(false);
  });

  it('names the default precision as a device class, not the clinic’s own', () => {
    expect(DEFAULT_BODY_COMP_PRECISION).toMatchObject({
      fat_cv_pct: 0.78,
      lean_cv_pct: 0.52,
    });
  });
});

describe('next scan', () => {
  it('is worth taking twelve to sixteen weeks after the latest', () => {
    expect(nextBodyCompScanWindow('2026-08-10', '2026-09-01')).toEqual({
      due_from: '2026-11-02',
      due_to: '2026-11-30',
      days_to_start: 62,
      status: 'upcoming',
    });
    expect(nextBodyCompScanWindow('2026-08-10', '2026-11-02').status).toBe(
      'in_window'
    );
    expect(nextBodyCompScanWindow('2026-08-10', '2026-11-30').status).toBe(
      'in_window'
    );
    expect(nextBodyCompScanWindow('2026-08-10', '2026-12-01').status).toBe(
      'window_passed'
    );
  });
});

describe('input', () => {
  const base = {
    scanned_day: '2026-08-10',
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    total_fat_g: 20000,
    total_lean_g: 60000,
    total_bmc_g: 3000,
  };

  it('works the total mass and the percentage fat out of fat, lean and bone when they are left out', () => {
    const out = bodyCompScanInputSchema.parse(base);
    expect(out.total_mass_g).toBe(83000);
    expect(out.pct_fat).toBe(24.1);
    expect(out.prep.fasted).toBeNull();
    expect(out.regions).toEqual([]);
  });

  it('keeps what the report printed', () => {
    const out = bodyCompScanInputSchema.parse({
      ...base,
      total_mass_g: 83250,
      pct_fat: 24.0,
    });
    expect(out.total_mass_g).toBe(83250);
    expect(out.pct_fat).toBe(24);
  });

  it('refuses nonsense, a repeated region and more fat than mass', () => {
    const bad = (patch: Record<string, unknown>) =>
      bodyCompScanInputSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ scanned_day: '2026-02-31' })).toBe(false);
    expect(bad({ sex: 'x' })).toBe(false);
    expect(bad({ height_cm: 50 })).toBe(false);
    expect(bad({ total_lean_g: 0 })).toBe(false);
    expect(bad({ total_mass_g: 15000 })).toBe(false);
    expect(bad({ pct_fat: 120 })).toBe(false);
    expect(bad({ regions: [regions[0], regions[0]] })).toBe(false);
    expect(bad({ regions: [{ ...regions[0], region: 'elbow' }] })).toBe(false);
  });
});

describe('CSV', () => {
  it('writes a row for each region and a total, newest scan first, with the whole-body figures on the total only', () => {
    const rows = bodyCompExportRows([
      scan({ scanned_day: '2026-08-10' }),
      scan({
        scanned_day: '2026-11-02',
        vat_mass_g: 500,
        regions: [regions[0]!],
      }),
    ]);
    const at = (name: string) =>
      BODY_COMP_EXPORT_HEADERS.indexOf(name as never);
    expect(
      rows.map((r) => [r[at('date')], r[at('scan')], r[at('region')]])
    ).toEqual([
      ['2026-11-02', 2, 'l_arm'],
      ['2026-11-02', 2, 'total'],
      ['2026-08-10', 1, 'l_arm'],
      ['2026-08-10', 1, 'r_arm'],
      ['2026-08-10', 1, 'trunk'],
      ['2026-08-10', 1, 'l_leg'],
      ['2026-08-10', 1, 'r_leg'],
      ['2026-08-10', 1, 'head'],
      ['2026-08-10', 1, 'total'],
    ]);
    expect(
      rows.every((r) => r.length === BODY_COMP_EXPORT_HEADERS.length)
    ).toBe(true);
    // Visceral fat is the whole body's: on the total row, empty on a region.
    expect(rows[0]![at('vat_mass_g')]).toBeNull();
    expect(rows[1]![at('vat_mass_g')]).toBe(500);
    expect(rows[1]![at('fat_g')]).toBe(20000);
    expect(rows[2]![at('fasted')]).toBe('true');
    expect(toCsv(BODY_COMP_EXPORT_HEADERS, rows).split('\r\n')[0]).toBe(
      BODY_COMP_EXPORT_HEADERS.join(',')
    );
  });

  it('appends the report fields at the end: the whole body’s on the total row, a region’s own percentiles and bone density on its row', () => {
    const headers = [...BODY_COMP_EXPORT_HEADERS];
    expect(headers.slice(0, 23)).toEqual([
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
    ]);
    expect(headers.slice(23)).toEqual([
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
    ]);
    const rows = bodyCompExportRows([
      scan({
        scan_mode: 'Whole Body',
        reference_population: 'NHANES Male',
        bmd_t_score: -0.4,
        bmd_z_score: 0.2,
        bmd_cv_pct: 1,
        pct_fat_yn: 50,
        pct_fat_am: 40,
        fmi_yn: 45,
        almi_am: 58,
        regions: [
          { ...regions[0]!, pct_fat_yn: 55, pct_fat_am: 45, bmd_gcm2: 0.8 },
        ],
      }),
    ]);
    const at = (name: string) =>
      BODY_COMP_EXPORT_HEADERS.indexOf(name as never);
    const [armRow, total] = rows as [
      (string | number | null)[],
      (string | number | null)[],
    ];
    expect(armRow[at('pct_fat_yn')]).toBe(55);
    expect(armRow[at('pct_fat_am')]).toBe(45);
    expect(armRow[at('region_bmd_gcm2')]).toBe(0.8);
    expect(armRow[at('scan_mode')]).toBeNull();
    expect(armRow[at('bmd_t_score')]).toBeNull();
    expect(armRow[at('fmi_yn')]).toBeNull();
    expect(total[at('scan_mode')]).toBe('Whole Body');
    expect(total[at('reference_population')]).toBe('NHANES Male');
    expect(total[at('bmd_t_score')]).toBe(-0.4);
    expect(total[at('bmd_z_score')]).toBe(0.2);
    expect(total[at('bmd_cv_pct')]).toBe(1);
    expect(total[at('pct_fat_yn')]).toBe(50);
    expect(total[at('fmi_yn')]).toBe(45);
    expect(total[at('almi_am')]).toBe(58);
    expect(total[at('region_bmd_gcm2')]).toBeNull();
  });

  it('writes an old scan with none of the report fields as empty cells', () => {
    const [row] = bodyCompExportRows([scan()]).slice(-1);
    expect(row!.slice(23)).toEqual(Array(14).fill(null));
  });

  it('leaves out the serial number, software and notes', () => {
    const cells = bodyCompExportRows([scan({ notes: 'private note' })]).flat();
    expect(cells).not.toContain('S1');
    expect(cells).not.toContain('13.6');
    expect(cells).not.toContain('private note');
  });
});

describe('exposure between two scans', () => {
  const dose = (
    day: string,
    name: string,
    mg: number,
    id = name.toLowerCase()
  ) => ({
    medication_id: id,
    status: 'taken',
    entry_date: day,
    dose_amount_snapshot: mg,
    dose_unit_snapshot: 'mg',
    med_name_snapshot: name,
  });

  it('lists each compound taken in the window, with the days it covers and the days since its last dose', () => {
    const rows = bodyCompIntervalExposure(
      [
        dose('2026-08-09', 'Retatrutide', 1), // before the window
        dose('2026-08-10', 'Retatrutide', 1),
        dose('2026-08-17', 'Retatrutide', 2),
        dose('2026-10-26', 'Retatrutide', 4),
        dose('2026-09-01', 'Cagrilintide', 0.25),
        dose('2026-11-03', 'Retatrutide', 4), // after the window
      ],
      [],
      '2026-08-10',
      '2026-11-02'
    );
    expect(rows.map((r) => r.name)).toEqual(['Cagrilintide', 'Retatrutide']);
    const reta = rows[1]!;
    expect(reta).toMatchObject({
      doses: 3,
      total_mg: '7',
      first_date: '2026-08-10',
      last_date: '2026-10-26',
      days_active: 78,
      days_since_last_dose: 7,
    });
    expect(rows[0]).toMatchObject({ days_active: 1, days_since_last_dose: 62 });
  });

  it('counts a blend under its components and leaves skipped doses and other units out', () => {
    const blend = {
      blend_medication_id: 'klow',
      components: [
        {
          component_medication_id: 'a',
          name: 'GHK-Cu',
          mass_mg: '50',
          source: 'label' as const,
          sort_index: 0,
        },
        {
          component_medication_id: 'b',
          name: 'KPV',
          mass_mg: '50',
          source: 'label' as const,
          sort_index: 1,
        },
      ],
    };
    const rows = bodyCompIntervalExposure(
      [
        dose('2026-09-01', 'KLOW', 1, 'klow'),
        { ...dose('2026-09-02', 'KLOW', 1, 'klow'), status: 'skipped' },
        { ...dose('2026-09-03', 'Tablet', 1), dose_unit_snapshot: 'tablet' },
      ],
      [blend],
      '2026-08-10',
      '2026-11-02'
    );
    expect(rows.map((r) => [r.name, r.total_mg, r.via_blends_mg])).toEqual([
      ['GHK-Cu', '0.5', '0.5'],
      ['KPV', '0.5', '0.5'],
    ]);
  });

  it('is empty when nothing was taken in the window', () => {
    expect(
      bodyCompIntervalExposure([], [], '2026-08-10', '2026-11-02')
    ).toEqual([]);
  });
});
