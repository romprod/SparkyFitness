import { describe, expect, it } from 'vitest';
import {
  DOSE_EXPORT_HEADERS,
  LAB_EXPORT_HEADERS,
  csvField,
  doseExportRows,
  labExportRows,
  toCsv,
  type DoseExportRecord,
  type LabExportRecord,
} from '@workspace/shared';

describe('csv writer', () => {
  it('ends every record, the last included, with CRLF', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });
  it('quotes only what needs it and doubles quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });
  it('writes empty for nothing and plain text for numbers and booleans', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(0)).toBe('0');
    expect(csvField(-5)).toBe('-5');
    expect(csvField(true)).toBe('true');
  });
  it('marks text a spreadsheet would run as a formula, but leaves real numbers alone', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('+44 20 7946 0000')).toBe("'+44 20 7946 0000");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('-')).toBe("'-");
    expect(csvField('-5')).toBe('-5');
    expect(csvField('-5.25')).toBe('-5.25');
    expect(csvField('+3')).toBe('+3');
    expect(csvField('1e3')).toBe('1e3');
    expect(csvField('=a,b')).toBe('"\'=a,b"');
  });
});

const dose = (patch: Partial<DoseExportRecord> = {}): DoseExportRecord => ({
  entry_type: 'injection',
  taken_at: '2026-11-16T13:19:18.510Z',
  entry_date: '2026-11-16',
  medication: 'Retatrutide',
  is_supplement: false,
  status: 'taken',
  administration_route: null,
  dose_amount: '2',
  dose_unit: 'mg',
  volume_ml: '0.2',
  syringe_units: '20',
  site: 'stomach_mid_left',
  vial: 'Rt20 #1',
  source: 'manual',
  scheduled_for: '2026-11-16T13:00:00.000Z',
  plan: 'Reta weekly',
  notes: null,
  ...patch,
});

describe('dose export rows', () => {
  const row = (record: DoseExportRecord) =>
    Object.fromEntries(
      DOSE_EXPORT_HEADERS.map((header, i) => [
        header,
        doseExportRows([record], 'Europe/London')[0]![i],
      ])
    );
  it('lays an injection out under its headings', () => {
    expect(row(dose())).toEqual({
      taken_at: '2026-11-16T13:19:18.510Z',
      local_day: '2026-11-16',
      timezone: 'Europe/London',
      medication: 'Retatrutide',
      kind: 'medication',
      status: 'taken',
      route: 'injection',
      dose: '2',
      dose_unit: 'mg',
      volume_ml: '0.2',
      syringe_units: '20',
      injection_site: 'stomach_mid_left',
      vial: 'Rt20 #1',
      source: 'manual',
      scheduled_for: '2026-11-16T13:00:00.000Z',
      minutes_from_schedule: 19,
      plan: 'Reta weekly',
      notes: null,
    });
  });
  it('labels a supplement entry and leaves injection-only columns empty', () => {
    expect(
      row(
        dose({
          entry_type: 'entry',
          is_supplement: true,
          medication: 'Omega 3',
          dose_amount: '2',
          dose_unit: 'softgel',
          volume_ml: null,
          syringe_units: null,
          site: null,
          vial: null,
          plan: null,
        })
      )
    ).toMatchObject({
      kind: 'supplement',
      route: null,
      dose_unit: 'softgel',
      injection_site: null,
    });
  });
  it('keeps a skipped dose with no time, and an early dose negative', () => {
    expect(
      row(dose({ taken_at: null, status: 'skipped', scheduled_for: null }))
    ).toMatchObject({
      taken_at: null,
      status: 'skipped',
      minutes_from_schedule: null,
    });
    expect(row(dose({ taken_at: '2026-11-16T12:30:00.000Z' }))).toMatchObject({
      minutes_from_schedule: -30,
    });
  });
  it('writes instants from the database as ISO text', () => {
    expect(
      row(dose({ taken_at: new Date('2026-11-16T13:00:00Z') }))
    ).toMatchObject({ taken_at: '2026-11-16T13:00:00.000Z' });
  });
  it('gives every row exactly one cell per heading', () => {
    for (const cells of doseExportRows(
      [dose(), dose({ entry_type: 'entry' })],
      'UTC'
    ))
      expect(cells).toHaveLength(DOSE_EXPORT_HEADERS.length);
  });
});

const lab = (patch: Partial<LabExportRecord> = {}): LabExportRecord => ({
  entry_date: '2026-11-01',
  lab_name: 'Synthetic Lab',
  marker_key: 'hba1c',
  custom_marker_name: null,
  value_numeric: 6.1,
  value_text: null,
  unit: '%',
  ref_range_low: 4,
  ref_range_high: 5.6,
  source: 'report',
  notes: null,
  ...patch,
});

describe('lab export rows', () => {
  const row = (record: LabExportRecord) =>
    Object.fromEntries(
      LAB_EXPORT_HEADERS.map((header, i) => [
        header,
        labExportRows([record])[0]![i],
      ])
    );
  it('names a built-in marker and flags a value outside its own range', () => {
    expect(row(lab())).toEqual({
      collected_date: '2026-11-01',
      lab: 'Synthetic Lab',
      marker: 'HbA1c',
      value: 6.1,
      unit: '%',
      reference_low: 4,
      reference_high: 5.6,
      flag: 'high',
      source: 'report',
      notes: null,
    });
  });
  it('judges a result with no range by the built-in default, only in the same unit', () => {
    expect(
      row(lab({ ref_range_low: null, ref_range_high: null, value_numeric: 5 }))
    ).toMatchObject({
      reference_low: 4,
      reference_high: 5.6,
      flag: 'in_range',
    });
    expect(
      row(
        lab({
          ref_range_low: null,
          ref_range_high: null,
          unit: 'mmol/mol',
          value_numeric: 50,
        })
      )
    ).toMatchObject({ reference_low: null, reference_high: null, flag: null });
  });
  it('uses the name of the person’s own marker and keeps a text value', () => {
    expect(
      row(
        lab({
          marker_key: null,
          custom_marker_name: 'My marker',
          value_numeric: null,
          value_text: 'Negative',
          unit: '',
          ref_range_low: null,
          ref_range_high: null,
        })
      )
    ).toMatchObject({ marker: 'My marker', value: 'Negative', flag: null });
  });
  it('gives every row exactly one cell per heading', () => {
    expect(labExportRows([lab(), lab({ marker_key: null })])[0]).toHaveLength(
      LAB_EXPORT_HEADERS.length
    );
  });
});
