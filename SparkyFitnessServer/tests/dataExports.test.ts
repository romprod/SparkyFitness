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
      derived_from_blend: null,
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

describe('dose export rows for a blend', () => {
  const klow = {
    blend_medication_id: 'klow-id',
    name: 'KLOW',
    components: [
      ['ghk', 'GHK-Cu', '50'],
      ['bpc', 'BPC-157', '10'],
      ['tb', 'TB-500', '10'],
      ['kpv', 'KPV', '10'],
    ].map(([id, name, mass_mg], sort_index) => ({
      component_medication_id: id!,
      name: name!,
      mass_mg: mass_mg!,
      source: 'label' as const,
      sort_index,
    })),
  };
  const blendDose = (patch: Partial<DoseExportRecord> = {}) =>
    dose({
      medication_id: 'klow-id',
      medication: 'KLOW',
      dose_amount: '800',
      dose_unit: 'mcg',
      ...patch,
    });
  const at = (name: string) => DOSE_EXPORT_HEADERS.indexOf(name as never);

  it('follows a taken blend dose with one derived row for each component, in mg', () => {
    const rows = doseExportRows([blendDose()], 'Europe/London', [klow]);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r[at('medication')])).toEqual([
      'KLOW',
      'GHK-Cu',
      'BPC-157',
      'TB-500',
      'KPV',
    ]);
    expect(rows[0]![at('derived_from_blend')]).toBeNull();
    expect(rows[0]![at('dose')]).toBe('800');
    expect(
      rows.slice(1).map((r) => [r[at('dose')], r[at('dose_unit')]])
    ).toEqual([
      ['0.5', 'mg'],
      ['0.1', 'mg'],
      ['0.1', 'mg'],
      ['0.1', 'mg'],
    ]);
    expect(rows[1]![at('derived_from_blend')]).toBe('KLOW (derived, label)');
    // A derived row keeps when it was taken and against which plan, but not what is the blend's alone.
    expect(rows[1]![at('taken_at')]).toBe('2026-11-16T13:19:18.510Z');
    expect(rows[1]![at('plan')]).toBe('Reta weekly');
    expect(rows[1]![at('volume_ml')]).toBeNull();
    expect(rows[1]![at('injection_site')]).toBeNull();
    expect(rows[1]![at('vial')]).toBeNull();
    expect(rows[1]![at('notes')]).toBeNull();
    expect(rows.every((r) => r.length === DOSE_EXPORT_HEADERS.length)).toBe(
      true
    );
  });

  it('claims the weakest source of the ratio', () => {
    const assumed = {
      ...klow,
      components: klow.components.map((c, i) =>
        i === 2 ? { ...c, source: 'assumed' as const } : c
      ),
    };
    const rows = doseExportRows([blendDose()], 'Europe/London', [assumed]);
    expect(rows[1]![at('derived_from_blend')]).toBe('KLOW (derived, assumed)');
  });

  it('leaves out a skipped dose, one in millilitres or tablets, another medication and a blend with no components', () => {
    const none = (record: DoseExportRecord, blends = [klow]) =>
      doseExportRows([record], 'Europe/London', blends);
    expect(none(blendDose({ status: 'skipped' }))).toHaveLength(1);
    expect(
      none(blendDose({ dose_amount: '0.2', dose_unit: 'ml' }))
    ).toHaveLength(1);
    expect(
      none(blendDose({ dose_amount: '1', dose_unit: 'tablet' }))
    ).toHaveLength(1);
    expect(none(blendDose({ medication_id: 'other' }))).toHaveLength(1);
    expect(none(blendDose({ medication_id: null }))).toHaveLength(1);
    expect(none(blendDose(), [{ ...klow, components: [] }])).toHaveLength(1);
    expect(doseExportRows([blendDose()], 'Europe/London')).toHaveLength(1);
  });

  it('derives from as-needed doses too, and keeps each dose’s rows together', () => {
    const rows = doseExportRows(
      [blendDose({ status: 'prn_taken' }), dose()],
      'Europe/London',
      [klow]
    );
    expect(rows.map((r) => r[at('medication')])).toEqual([
      'KLOW',
      'GHK-Cu',
      'BPC-157',
      'TB-500',
      'KPV',
      'Retatrutide',
    ]);
  });
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
