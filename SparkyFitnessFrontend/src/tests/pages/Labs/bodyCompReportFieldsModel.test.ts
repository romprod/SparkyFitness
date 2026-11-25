import {
  regionReportColumns,
  reportFields,
  scannerFields,
  showTScore,
} from '@/pages/Labs/bodyCompReportFieldsModel';
import { SIX_REGIONS, makeScan, region } from './bodyCompTestKit';

const byKey = (fields: { key: string; value: string }[], key: string) =>
  fields.find((f) => f.key === key)?.value;

describe('reportFields', () => {
  it('says "not printed" for the % fat percentiles when null and hides the rest', () => {
    const fields = reportFields(makeScan());
    expect(byKey(fields, 'pctFatYn')).toBe('not printed');
    expect(byKey(fields, 'pctFatAm')).toBe('not printed');
    expect(fields.map((f) => f.key)).toEqual(['pctFatYn', 'pctFatAm', 'bmdZ']);
    expect(byKey(fields, 'bmdZ')).toBe('—');
  });

  it('shows each percentile that was printed, rounded', () => {
    const fields = reportFields(
      makeScan({
        pct_fat_yn: 61.4,
        pct_fat_am: 38.6,
        fmi_yn: 70,
        lmi_am: 12.2,
        almi_yn: 55,
        almi_am: 41,
      })
    );
    expect(byKey(fields, 'pctFatYn')).toBe('61');
    expect(byKey(fields, 'pctFatAm')).toBe('39');
    expect(byKey(fields, 'fmiYn')).toBe('70');
    expect(byKey(fields, 'fmiAm')).toBeUndefined();
    expect(byKey(fields, 'lmiYn')).toBeUndefined();
    expect(byKey(fields, 'lmiAm')).toBe('12');
    expect(byKey(fields, 'almiYn')).toBe('55');
    expect(byKey(fields, 'almiAm')).toBe('41');
  });

  it('prints the Z-score signed with a true minus, and the site CV when printed', () => {
    const fields = reportFields(
      makeScan({ bmd_z_score: -0.4, bmd_cv_pct: 0.8 })
    );
    expect(byKey(fields, 'bmdZ')).toBe('−0.4');
    expect(byKey(fields, 'bmdCv')).toBe('0.80 %');
    expect(byKey(reportFields(makeScan({ bmd_z_score: 1.2 })), 'bmdZ')).toBe(
      '+1.2'
    );
  });

  it('shows the T-score only from age 50', () => {
    const young = makeScan({ age_years: 49, bmd_t_score: -1.1 });
    const older = makeScan({ age_years: 50, bmd_t_score: -1.1 });
    expect(showTScore(young)).toBe(false);
    expect(showTScore(older)).toBe(true);
    expect(byKey(reportFields(young), 'bmdT')).toBeUndefined();
    expect(byKey(reportFields(older), 'bmdT')).toBe('−1.1');
    expect(byKey(reportFields(makeScan({ age_years: 60 })), 'bmdT')).toBe('—');
  });
});

describe('scannerFields', () => {
  it('lists the device with its software, the scan mode and the reference population', () => {
    const fields = scannerFields(
      makeScan({ scan_mode: 'Fast array', reference_population: 'NHANES' })
    );
    expect(fields).toEqual([
      { key: 'device', label: 'Device', value: 'Hologic Horizon A · 13.6' },
      { key: 'scanMode', label: 'Scan mode', value: 'Fast array' },
      {
        key: 'referencePopulation',
        label: 'Reference population',
        value: 'NHANES',
      },
    ]);
  });

  it('leaves out what was not printed', () => {
    expect(
      scannerFields(
        makeScan({
          device_label: null,
          software_version: null,
          scan_mode: null,
        })
      )
    ).toEqual([]);
  });
});

describe('regionReportColumns', () => {
  it('shows a column only when some region has that figure', () => {
    expect(regionReportColumns(SIX_REGIONS())).toEqual({
      pctFatYn: false,
      pctFatAm: false,
      bmd: false,
    });
    expect(
      regionReportColumns([
        ...SIX_REGIONS(),
        region('head', 1, 1, 1, { pct_fat_yn: 40, bmd_gcm2: 2 }),
      ])
    ).toEqual({ pctFatYn: true, pctFatAm: false, bmd: true });
  });
});
