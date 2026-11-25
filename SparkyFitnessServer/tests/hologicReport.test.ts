import { describe, expect, it } from 'vitest';
import {
  bodyCompScanInputSchema,
  hologicScanToPrefill,
  isoFromPrintedDate,
  normaliseReportText,
  parseHologicReport,
  type ParsedHologicScan,
} from '@workspace/shared';
import { HOLOGIC_TEMPLATE as TEMPLATE } from './fixtures/hologicReportText.js';

/**
 * Ported from Pitstop's dexa-parse-core and dexa-prefill tests, against the same synthetic report.
 * Sparky reads numbers as numbers (Pitstop keeps the strings the form takes).
 */
const region = (scan: ParsedHologicScan | null, name: string) =>
  scan!.regions.find((x) => x.region === name)!;

describe('parseHologicReport: synthetic template', () => {
  const res = parseHologicReport(TEMPLATE);

  it('is ok with every anchor found and every check passing', () => {
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.confidence).toBe(1);
    expect(res.checks.length).toBeGreaterThan(5);
    for (const c of res.checks)
      expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
  });

  it('reads the header', () => {
    expect(res.scan!.header).toEqual({
      sex: 'male',
      heightCm: 178,
      clinicWeightKg: 82,
      ageYears: 40,
      scanDate: '2026-01-10',
      scanDateRaw: '10 January 2026',
      softwareVersion: '13.6',
      deviceModel: 'Horizon A',
      deviceSerial: 'TEST1',
      scanMode: 'Whole Body',
      referencePopulation: 'NHANES-Example Example Male',
    });
  });

  it('reads totals with percentiles from the Total row', () => {
    expect(res.scan!.totals).toEqual({
      totalFatG: 16400,
      totalLeanG: 61800,
      totalBmcG: 2800,
      totalMassG: 81000,
      pctFat: 20.2,
      pctFatYn: 50,
      pctFatAm: 40,
    });
  });

  it('reads all eight regions as printed, with percentiles and bone density where printed', () => {
    const s = res.scan!;
    expect(s.regions.map((r) => r.region)).toEqual([
      'l_arm',
      'r_arm',
      'trunk',
      'l_leg',
      'r_leg',
      'head',
      'android',
      'gynoid',
    ]);
    expect(region(s, 'l_arm')).toEqual({
      region: 'l_arm',
      bmcG: 200,
      fatG: 1000,
      leanG: 3500,
      totalG: 4700,
      pctFat: 21.3,
      pctFatYn: 55,
      pctFatAm: 45,
      bmdGcm2: 0.8,
    });
    expect(region(s, 'trunk')).toEqual({
      region: 'trunk',
      bmcG: 800,
      fatG: 7300,
      leanG: 30000,
      totalG: 38100,
      pctFat: 19.2,
      pctFatYn: 48,
      pctFatAm: 40,
      bmdGcm2: null,
    });
    expect(region(s, 'head')).toEqual({
      region: 'head',
      bmcG: 580,
      fatG: 1200,
      leanG: 3300,
      totalG: 5080,
      pctFat: 23.6,
      pctFatYn: null,
      pctFatAm: null,
      bmdGcm2: 2,
    });
    expect(region(s, 'r_leg').bmdGcm2).toBe(1);
    expect(region(s, 'android')).toEqual({
      region: 'android',
      bmcG: null,
      fatG: 1200,
      leanG: 4800,
      totalG: 6000,
      pctFat: 20,
      pctFatYn: null,
      pctFatAm: null,
      bmdGcm2: null,
    });
    expect(region(s, 'gynoid').totalG).toBe(13000);
  });

  it('reads visceral fat, bone and the printed indices', () => {
    const s = res.scan!;
    expect(s.vat).toEqual({ massG: 500, volumeCm3: 540, areaCm2: 104 });
    expect(s.bone).toEqual({
      totalBmdGcm2: 1.2,
      tScore: 0.1,
      zScore: 0.1,
      cvPct: 1,
    });
    expect(s.indices).toEqual({
      fmi: 5.18,
      fmiYn: 45,
      fmiAm: 38,
      lmi: 19.5,
      lmiYn: 60,
      lmiAm: 55,
      almi: 8.99,
      almiYn: 62,
      almiAm: 58,
      androidGynoid: 0.96,
    });
  });

  it('names the checks the review shows, with Sparky’s own checks first', () => {
    const names = res.checks.map((c) => c.name);
    expect(names.slice(0, 5)).toEqual([
      'fat_sum',
      'lean_sum',
      'bmc_sum',
      'mass_sum',
      'pct_fat',
    ]);
    for (const n of [
      'subtotal_head_fat',
      'subtotal_head_mass',
      'regions_subtotal_lean',
      'fmi_printed',
      'lmi_printed',
      'almi_printed',
      'vat_density',
    ])
      expect(names).toContain(n);
    expect(res.checks.find((c) => c.name === 'fat_sum')!.detail).toBe(
      'regions 16400.0 vs total 16400.0'
    );
    expect(res.checks.find((c) => c.name === 'pct_fat')!.detail).toMatch(
      /^recomputed 20\.\d\d vs printed 20\.2$/
    );
  });
});

describe('parseHologicReport: failure modes', () => {
  it('a mis-keyed row fails a check: ok is false, the scan is still returned, confidence is lower', () => {
    const bad = TEMPLATE.replace(
      'R Leg 510.00 2950.0 10700.0 11210.0 14160.0 20.8',
      'R Leg 510.00 2950.0 10800.0 11210.0 14160.0 20.8'
    );
    const res = parseHologicReport(bad);
    expect(res.ok).toBe(false);
    expect(res.scan).not.toBeNull();
    expect(res.missing).toEqual([]);
    const failed = res.checks
      .filter((c) => !c.pass)
      .map((c) => c.name)
      .sort();
    expect(failed).toEqual(['lean_sum', 'regions_subtotal_lean']);
    expect(res.confidence).toBeLessThan(1);
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it('a truncated text is not ok and names the missing anchors', () => {
    const res = parseHologicReport(
      TEMPLATE.slice(0, TEMPLATE.indexOf('DXA Results Summary'))
    );
    expect(res.ok).toBe(false);
    expect(res.scan).toBeNull();
    expect(res.checks).toEqual([]);
    for (const m of [
      'summary:L Arm',
      'summary:Head',
      'summary:Total',
      'percentile:Total',
      'indices:Est. VAT Mass',
      'bmd:Total',
    ])
      expect(res.missing).toContain(m);
    expect(res.missing).not.toContain('header:Sex');
    expect(res.confidence).toBeLessThan(0.5);
  });

  it('a printed scan date that cannot be interpreted is a failed check: not ok, not 100 %, no scan date', () => {
    for (const bad of ['10 Enero 2026', '32 January 2026']) {
      const res = parseHologicReport(TEMPLATE.replace('10 January 2026', bad));
      expect(res.ok).toBe(false);
      expect(res.scan).not.toBeNull();
      expect(res.scan!.header.scanDate).toBeNull();
      expect(res.scan!.header.scanDateRaw).toBe(bad);
      expect(res.missing).not.toContain('header:Scan Date');
      const check = res.checks.find((c) => c.name === 'scan_date');
      expect(check?.pass).toBe(false);
      expect(check?.detail).toContain(bad);
      expect(res.confidence).toBeLessThan(1);
    }
  });

  it('fails the pct_fat check when the printed percentage disagrees with fat over total', () => {
    const res = parseHologicReport(
      TEMPLATE.replace('81000.0 20.2', '81000.0 25.2')
    );
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name === 'pct_fat')!.pass).toBe(false);
  });

  it('optional sections missing: still ok, listed in missing', () => {
    const res = parseHologicReport(
      TEMPLATE.slice(0, TEMPLATE.indexOf('BMD Results'))
    );
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([
      'bmd:L Arm',
      'bmd:R Arm',
      'bmd:L Leg',
      'bmd:R Leg',
      'bmd:Head',
      'bmd:Total',
      'bmd:Total BMD CV',
    ]);
    expect(res.scan!.bone).toEqual({
      totalBmdGcm2: null,
      tScore: null,
      zScore: null,
      cvPct: null,
    });
    expect(region(res.scan, 'l_arm').bmdGcm2).toBeNull();
    expect(res.confidence).toBeLessThan(1);
  });

  it('android and gynoid rows missing: six regions, still ok', () => {
    const res = parseHologicReport(
      TEMPLATE.replace(/Android \(A\).*\n/, '').replace(/Gynoid \(G\).*\n/, '')
    );
    expect(res.ok).toBe(true);
    expect(res.scan!.regions).toHaveLength(6);
    expect(res.missing).toEqual(['percentile:Android', 'percentile:Gynoid']);
  });

  it('empty text', () => {
    const res = parseHologicReport('');
    expect(res.ok).toBe(false);
    expect(res.scan).toBeNull();
    expect(res.confidence).toBe(0);
    expect(res.missing.length).toBeGreaterThan(30);
  });
});

describe('parseHologicReport: text normalisation', () => {
  it('folds superscripts and no-break spaces, and strips thousands separators', () => {
    expect(
      normaliseReportText('Fat Mass/Height² (kg/m²) 5.18 1,234.5 12,345,678')
    ).toBe('Fat Mass/Height2 (kg/m2) 5.18 1234.5 12345678');
    expect(normaliseReportText('a b c')).toBe('a b c');
  });

  it('the ASCII variant (2 and 3 already plain) parses identically', () => {
    const ascii = TEMPLATE.replace(/²/g, '2').replace(/³/g, '3');
    expect(parseHologicReport(ascii)).toEqual(parseHologicReport(TEMPLATE));
  });

  it('no-break spaces everywhere still parse', () => {
    const nb = TEMPLATE.replace(/ /g, ' ');
    expect(parseHologicReport(nb)).toEqual(parseHologicReport(TEMPLATE));
  });

  it('extra whitespace and newlines between fields still parse', () => {
    const spread = TEMPLATE.replace(/(\d)\s+(?=[-\d])/g, '$1\n\t   ')
      .replace(/: /g, ':\n ')
      .replace(/L Arm/g, 'L  Arm')
      .replace(/Scan Date/g, 'Scan\nDate');
    expect(parseHologicReport(spread)).toEqual(parseHologicReport(TEMPLATE));
  });

  it('reads printed dates', () => {
    expect(isoFromPrintedDate('2 September 2026')).toBe('2026-09-02');
    expect(isoFromPrintedDate('02 Sep 2026')).toBe('2026-09-02');
    expect(isoFromPrintedDate('10 Brumaire 2026')).toBeNull();
    expect(isoFromPrintedDate('0 January 2026')).toBeNull();
  });
});

describe('hologicScanToPrefill', () => {
  const scan = parseHologicReport(TEMPLATE).scan!;

  it('maps every printed value to the form’s input', () => {
    const out = hologicScanToPrefill(scan);
    expect(out).toMatchObject({
      scanned_day: '2026-01-10',
      device_label: 'Hologic Horizon A',
      device_serial: 'TEST1',
      software_version: '13.6',
      scan_mode: 'Whole Body',
      reference_population: 'NHANES-Example Example Male',
      sex: 'male',
      age_years: 40,
      height_cm: 178,
      clinic_weight_kg: 82,
      total_fat_g: 16400,
      total_lean_g: 61800,
      total_bmc_g: 2800,
      total_mass_g: 81000,
      pct_fat: 20.2,
      pct_fat_yn: 50,
      pct_fat_am: 40,
      vat_mass_g: 500,
      vat_volume_cm3: 540,
      vat_area_cm2: 104,
      total_bmd_gcm2: 1.2,
      bmd_t_score: 0.1,
      bmd_z_score: 0.1,
      bmd_cv_pct: 1,
      fmi_yn: 45,
      fmi_am: 38,
      lmi_yn: 60,
      lmi_am: 55,
      almi_yn: 62,
      almi_am: 58,
    });
    expect(out.regions).toHaveLength(8);
    expect(out.regions![0]).toEqual({
      region: 'l_arm',
      fat_g: 1000,
      lean_g: 3500,
      bmc_g: 200,
      total_g: 4700,
      pct_fat: 21.3,
      pct_fat_yn: 55,
      pct_fat_am: 45,
      bmd_gcm2: 0.8,
    });
    // Zones print no bone mineral and no percentiles: those keys are not there at all.
    expect(out.regions![6]).toEqual({
      region: 'android',
      fat_g: 1200,
      lean_g: 4800,
      total_g: 6000,
      pct_fat: 20,
    });
    // Nothing the report does not print is invented.
    for (const key of ['facility', 'prep', 'notes', 'creatine_status'])
      expect(out).not.toHaveProperty(key);
  });

  it('is a scan the API accepts as it stands', () => {
    const parsed = bodyCompScanInputSchema.safeParse(
      hologicScanToPrefill(scan)
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.regions).toHaveLength(8);
      expect(parsed.data.pct_fat_yn).toBe(50);
      expect(parsed.data.regions[1]!.pct_fat_am).toBe(44);
    }
  });

  it('leaves out what the report did not print instead of sending null', () => {
    const sparse: ParsedHologicScan = {
      ...scan,
      header: {
        ...scan.header,
        clinicWeightKg: null,
        scanDate: null,
        scanDateRaw: null,
        deviceModel: null,
        deviceSerial: null,
        scanMode: null,
        referencePopulation: null,
      },
      totals: { ...scan.totals, pctFatYn: null, pctFatAm: null },
      vat: { massG: null, volumeCm3: null, areaCm2: null },
      bone: { totalBmdGcm2: null, tScore: null, zScore: null, cvPct: null },
      indices: {
        fmi: null,
        fmiYn: null,
        fmiAm: null,
        lmi: null,
        lmiYn: null,
        lmiAm: null,
        almi: null,
        almiYn: null,
        almiAm: null,
        androidGynoid: null,
      },
      regions: scan.regions.slice(0, 6).map((r) => ({
        ...r,
        pctFatYn: null,
        pctFatAm: null,
        bmdGcm2: null,
      })),
    };
    const out = hologicScanToPrefill(sparse);
    expect(out.device_label).toBe('Hologic');
    for (const key of [
      'scanned_day',
      'clinic_weight_kg',
      'device_serial',
      'scan_mode',
      'reference_population',
      'pct_fat_yn',
      'vat_mass_g',
      'total_bmd_gcm2',
      'bmd_t_score',
      'fmi_yn',
      'almi_am',
    ])
      expect(out).not.toHaveProperty(key);
    expect(JSON.stringify(out)).not.toContain('null');
  });

  it('passes any set of regions on, unlike Pitstop’s none, four or eight', () => {
    const six = parseHologicReport(
      TEMPLATE.replace(/Android \(A\).*\n/, '').replace(/Gynoid \(G\).*\n/, '')
    ).scan!;
    expect(hologicScanToPrefill(six).regions!.map((r) => r.region)).toEqual([
      'l_arm',
      'r_arm',
      'trunk',
      'l_leg',
      'r_leg',
      'head',
    ]);
  });
});
