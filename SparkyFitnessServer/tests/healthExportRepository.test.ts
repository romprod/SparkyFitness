import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  listWearableExportRecords,
  loadJournalExportParts,
} from '../models/healthExportRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });
const sql = () =>
  mocks.query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' '));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('wearable records', () => {
  it('lays a night’s sleep beside the same day and source, preferring the day’s own resting rate', async () => {
    mocks.query
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            source: 'garmin',
            total_steps: 8123,
            resting_heart_rate: null,
            avg_stress_level: '36',
            body_battery_highest: null,
            updated_at: new Date('2026-11-22T20:00:00Z'),
          },
          {
            day: '2026-11-23',
            source: 'garmin',
            total_steps: 100,
            resting_heart_rate: 64,
          },
        ])
      )
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            source: 'garmin',
            sleep_seconds: '24600',
            sleep_score: 84,
            avg_overnight_hrv: '52.5',
            resting_heart_rate: 58,
            bedtime: new Date('2026-11-21T23:10:00Z'),
            wake_time: '2026-11-22T06:00:00Z',
          },
          {
            day: '2026-11-19',
            source: 'manual',
            sleep_seconds: 21000,
            resting_heart_rate: 61,
          },
        ])
      );
    const out = await listWearableExportRecords(owner, owner);
    const byKey = Object.fromEntries(
      out.map((r) => [`${r.entry_date}|${r.source}`, r])
    );
    expect(Object.keys(byKey).sort()).toEqual([
      '2026-11-19|manual',
      '2026-11-22|garmin',
      '2026-11-23|garmin',
    ]);
    expect(byKey['2026-11-22|garmin']).toMatchObject({
      steps: 8123,
      stress_avg: 36,
      sleep_seconds: 24600,
      sleep_score: 84,
      hrv_ms: 52.5,
      // The day has none of its own, so the night's fills in.
      resting_hr: 58,
      bedtime: '2026-11-21T23:10:00.000Z',
      wake_time: '2026-11-22T06:00:00.000Z',
      synced_at: '2026-11-22T20:00:00.000Z',
      body_battery_high: null,
    });
    // The day's own resting rate wins over the night's.
    expect(byKey['2026-11-23|garmin']!.resting_hr).toBe(64);
    // Sleep with no daily row still gets a row, with no activity figures.
    expect(byKey['2026-11-19|manual']).toMatchObject({
      sleep_seconds: 21000,
      steps: null,
      resting_hr: 61,
    });
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('asks only for the owner’s own rows and picks the longest night for each day and source', async () => {
    mocks.query.mockResolvedValue(rows());
    await listWearableExportRecords(owner);
    expect(sql()).toHaveLength(2);
    for (const text of sql()) expect(text).toContain('user_id=$1');
    expect(sql()[1]).toContain('DISTINCT ON (entry_date, source)');
    expect(sql()[1]).toContain('DESC NULLS LAST');
    for (const call of mocks.query.mock.calls) expect(call[1]).toEqual([owner]);
  });

  it('treats an unreadable number as not recorded rather than failing', async () => {
    mocks.query
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            source: 'garmin',
            total_steps: 'n/a',
            resting_heart_rate: '',
          },
        ])
      )
      .mockResolvedValueOnce(rows());
    const [row] = await listWearableExportRecords(owner);
    expect(row).toMatchObject({ steps: null, resting_hr: null });
  });
});

describe('journal parts', () => {
  it('reads weight, mood, water and sleep, dropping a weight of zero and unreadable times', async () => {
    mocks.query
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            at: new Date('2026-11-22T07:00:00Z'),
            weight: '79.9',
            body_fat_percentage: '22.5',
            muscle_mass_kg: null,
          },
          {
            day: '2026-11-21',
            at: 'not a time',
            weight: '0',
            body_fat_percentage: null,
            muscle_mass_kg: null,
          },
        ])
      )
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            at: new Date('2026-11-22T08:00:00Z'),
            mood_value: 4,
            energy_value: '3',
            focus_value: null,
            notes: null,
          },
        ])
      )
      .mockResolvedValueOnce(rows([{ day: '2026-11-22', water_ml: '1500' }]))
      .mockResolvedValueOnce(rows([{ day: '2026-11-22', seconds: '24600' }]));
    const parts = await loadJournalExportParts(owner, owner);
    expect(parts.measurements).toEqual([
      {
        day: '2026-11-22',
        at: '2026-11-22T07:00:00.000Z',
        weight_kg: 79.9,
        body_fat_percent: 22.5,
        muscle_mass_kg: null,
      },
      {
        day: '2026-11-21',
        at: '',
        weight_kg: null,
        body_fat_percent: null,
        muscle_mass_kg: null,
      },
    ]);
    expect(parts.moods).toEqual([
      {
        day: '2026-11-22',
        at: '2026-11-22T08:00:00.000Z',
        mood: 4,
        energy: 3,
        focus: null,
        notes: null,
      },
    ]);
    expect(parts.water).toEqual([{ day: '2026-11-22', water_ml: 1500 }]);
    expect(parts.sleep).toEqual([{ day: '2026-11-22', seconds: 24600 }]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('never reads symptoms, which need their own permission', async () => {
    mocks.query.mockResolvedValue(rows());
    await loadJournalExportParts(owner);
    expect(sql()).toHaveLength(4);
    expect(sql().join(' ')).not.toContain('symptom');
    for (const text of sql()) expect(text).toContain('user_id=$1');
  });
});
