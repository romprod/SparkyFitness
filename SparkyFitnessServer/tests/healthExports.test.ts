import { describe, expect, it } from 'vitest';
import {
  JOURNAL_EXPORT_HEADERS,
  WEARABLE_EXPORT_HEADERS,
  journalExportRecords,
  journalExportRows,
  toCsv,
  wearableExportRows,
  type JournalParts,
  type WearableExportRecord,
} from '@workspace/shared';

const wearable = (
  patch: Partial<WearableExportRecord> = {}
): WearableExportRecord => ({
  entry_date: '2026-11-22',
  source: 'garmin',
  sleep_seconds: null,
  sleep_deep_seconds: null,
  sleep_light_seconds: null,
  sleep_rem_seconds: null,
  sleep_awake_seconds: null,
  sleep_score: null,
  bedtime: null,
  wake_time: null,
  resting_hr: null,
  hrv_ms: null,
  body_battery_high: null,
  body_battery_low: null,
  body_battery_charged: null,
  body_battery_drained: null,
  stress_avg: null,
  stress_max: null,
  steps: null,
  distance_m: null,
  floors_climbed: null,
  active_calories: null,
  total_calories: null,
  exercise_minutes: null,
  moderate_minutes: null,
  vigorous_minutes: null,
  vo2_max: null,
  training_readiness: null,
  recovery_time_hours: null,
  spo2_avg: null,
  respiration_avg: null,
  synced_at: null,
  ...patch,
});

describe('wearable CSV', () => {
  it('has a cell for every header, in the same order', () => {
    const [row] = wearableExportRows([
      wearable({ sleep_score: 84, steps: 9000 }),
    ]);
    expect(row).toHaveLength(WEARABLE_EXPORT_HEADERS.length);
    expect(row![WEARABLE_EXPORT_HEADERS.indexOf('sleep_score')]).toBe(84);
    expect(row![WEARABLE_EXPORT_HEADERS.indexOf('steps')]).toBe(9000);
    expect(row![WEARABLE_EXPORT_HEADERS.indexOf('date')]).toBe('2026-11-22');
  });

  it('puts the newest day first and a day’s sources together, and writes a missing figure as empty, not zero', () => {
    const rows = wearableExportRows([
      wearable({ entry_date: '2026-11-20', source: 'garmin', steps: 0 }),
      wearable({ entry_date: '2026-11-22', source: 'garmin' }),
      wearable({ entry_date: '2026-11-22', source: 'apple', resting_hr: 60 }),
    ]);
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['2026-11-22', 'apple'],
      ['2026-11-22', 'garmin'],
      ['2026-11-20', 'garmin'],
    ]);
    const csv = toCsv(WEARABLE_EXPORT_HEADERS, rows).split('\r\n');
    expect(csv[0]).toBe(WEARABLE_EXPORT_HEADERS.join(','));
    // A real zero stays a zero; a figure that was not recorded is blank.
    expect(csv[3]).toContain(',0,');
    expect(csv[2]!.split(',')[WEARABLE_EXPORT_HEADERS.indexOf('steps')]).toBe(
      ''
    );
  });
});

describe('journal CSV', () => {
  const parts = (patch: Partial<JournalParts> = {}): JournalParts => ({
    measurements: [],
    moods: [],
    water: [],
    sleep: [],
    nutrition: [],
    symptoms: [],
    ...patch,
  });

  it('makes one record a day from every list, newest first, and no record for an empty day', () => {
    const records = journalExportRecords(
      parts({
        measurements: [
          {
            day: '2026-11-20',
            at: '2026-11-20T07:00:00Z',
            weight_kg: 80,
            body_fat_percent: null,
            muscle_mass_kg: null,
          },
        ],
        moods: [
          {
            day: '2026-11-22',
            at: '2026-11-22T08:00:00Z',
            mood: 4,
            energy: 3,
            focus: 5,
            notes: null,
          },
        ],
        water: [{ day: '2026-11-21', water_ml: 1200 }],
        sleep: [{ day: '2026-11-22', seconds: 24600 }],
      })
    );
    expect(records.map((r) => r.entry_date)).toEqual([
      '2026-11-22',
      '2026-11-21',
      '2026-11-20',
    ]);
    expect(records[0]).toMatchObject({
      mood: 4,
      energy: 3,
      focus: 5,
      sleep_hours: 6.8,
    });
    expect(records[1]).toMatchObject({ water_ml: 1200, mood: null });
    expect(journalExportRecords(parts())).toEqual([]);
  });

  it('takes the latest reading of each figure, keeping an earlier one a later reading lacks', () => {
    const [record] = journalExportRecords(
      parts({
        measurements: [
          {
            day: '2026-11-22',
            at: '2026-11-22T20:00:00Z',
            weight_kg: 79.5,
            body_fat_percent: null,
            muscle_mass_kg: null,
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T07:00:00Z',
            weight_kg: 80.2,
            body_fat_percent: 22.5,
            muscle_mass_kg: 61,
          },
        ],
        moods: [
          {
            day: '2026-11-22',
            at: '2026-11-22T18:00:00Z',
            mood: 2,
            energy: null,
            focus: null,
            notes: null,
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T09:00:00Z',
            mood: 4,
            energy: 3,
            focus: 4,
            notes: null,
          },
        ],
      })
    );
    expect(record).toMatchObject({
      weight_kg: 79.5,
      body_fat_percent: 22.5,
      muscle_mass_kg: 61,
      mood: 2,
      energy: 3,
      focus: 4,
    });
  });

  it('adds up the day’s water, keeps the longest night, and keeps every note oldest first', () => {
    const [record] = journalExportRecords(
      parts({
        moods: [
          {
            day: '2026-11-22',
            at: '2026-11-22T18:00:00Z',
            mood: 3,
            energy: null,
            focus: null,
            notes: ' tired ',
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T09:00:00Z',
            mood: 4,
            energy: null,
            focus: null,
            notes: 'slept badly',
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T12:00:00Z',
            mood: 4,
            energy: null,
            focus: null,
            notes: '   ',
          },
        ],
        water: [
          { day: '2026-11-22', water_ml: 500 },
          { day: '2026-11-22', water_ml: 750 },
          { day: '2026-11-22', water_ml: null },
        ],
        sleep: [
          { day: '2026-11-22', seconds: 5400 },
          { day: '2026-11-22', seconds: 27000 },
          { day: '2026-11-22', seconds: 0 },
          { day: '2026-11-22', seconds: null },
        ],
      })
    );
    expect(record).toMatchObject({
      water_ml: 1250,
      sleep_hours: 7.5,
      notes: 'slept badly | tired',
    });
  });

  it('rounds calories to whole kcal and protein to one decimal', () => {
    const [record] = journalExportRecords(
      parts({
        nutrition: [{ day: '2026-11-22', calories: 2149.5, protein_g: 151.26 }],
      })
    );
    expect(record).toMatchObject({ calories: 2150, protein_g: 151.3 });
  });

  it('gives a day with only food, or only symptoms, its own row', () => {
    const records = journalExportRecords(
      parts({
        nutrition: [{ day: '2026-11-21', calories: 1800, protein_g: 120 }],
        symptoms: [
          {
            day: '2026-11-20',
            at: '2026-11-20T09:00:00Z',
            name: 'Nausea',
            severity_label: null,
          },
        ],
      })
    );
    expect(records.map((r) => r.entry_date)).toEqual([
      '2026-11-21',
      '2026-11-20',
    ]);
    expect(records[0]).toMatchObject({ calories: 1800, side_effects: null });
    expect(records[1]).toMatchObject({
      calories: null,
      protein_g: null,
      side_effects: 'Nausea',
    });
  });

  it('leaves a missing or non-finite food figure empty, never zero', () => {
    const records = journalExportRecords(
      parts({
        nutrition: [
          { day: '2026-11-22', calories: 1900, protein_g: null },
          { day: '2026-11-21', calories: null, protein_g: 90 },
          { day: '2026-11-20', calories: null, protein_g: null },
          { day: '2026-11-19', calories: NaN, protein_g: Infinity },
        ],
      })
    );
    expect(records.map((r) => r.entry_date)).toEqual([
      '2026-11-22',
      '2026-11-21',
    ]);
    expect(records[0]).toMatchObject({ calories: 1900, protein_g: null });
    expect(records[1]).toMatchObject({ calories: null, protein_g: 90 });
  });

  it('lists side effects oldest first, severity lower-cased, skipping blank names', () => {
    const [record] = journalExportRecords(
      parts({
        symptoms: [
          {
            day: '2026-11-22',
            at: '2026-11-22T18:00:00Z',
            name: 'Headache',
            severity_label: '  ',
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T09:00:00Z',
            name: ' Nausea ',
            severity_label: ' Moderate ',
          },
          {
            day: '2026-11-22',
            at: '2026-11-22T12:00:00Z',
            name: '   ',
            severity_label: 'Mild',
          },
        ],
      })
    );
    expect(record?.side_effects).toBe('Nausea (moderate), Headache');
  });

  it('writes rows under the headers, with blanks for what was not recorded', () => {
    const rows = journalExportRows(
      journalExportRecords(
        parts({
          measurements: [
            {
              day: '2026-11-22',
              at: '2026-11-22T07:00:00Z',
              weight_kg: 79.9,
              body_fat_percent: null,
              muscle_mass_kg: null,
            },
          ],
        })
      )
    );
    expect(toCsv(JOURNAL_EXPORT_HEADERS, rows)).toBe(
      'date,weight_kg,body_fat_percent,muscle_mass_kg,mood,energy,focus,sleep_hours,calories,protein_g,water_ml,side_effects,notes\r\n2026-11-22,79.9,,,,,,,,,,,\r\n'
    );
  });
});
