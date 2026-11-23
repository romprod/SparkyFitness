import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import { loadWellnessRecords } from '../models/medicationWellnessRepository.js';
import { listWearableExportRecords } from '../models/healthExportRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const window = {
  from_day: '2026-11-10',
  to_day: '2026-11-23',
  weights_from_day: '2026-11-17',
};
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('reading the tile records', () => {
  it('merges a day’s sleep and daily figures, preferring the day’s own resting rate', async () => {
    mocks.query
      .mockResolvedValueOnce(
        rows([
          // 23 Nov: the day's figures arrived before any sleep did.
          {
            day: '2026-11-23',
            resting_heart_rate: 64,
            body_battery_highest: null,
            avg_stress_level: '11',
          },
          {
            day: '2026-11-22',
            resting_heart_rate: null,
            body_battery_highest: 71,
            avg_stress_level: 36,
          },
        ])
      )
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-22',
            sleep_score: '84',
            avg_overnight_hrv: '52.5',
            resting_heart_rate: 58,
            sleep_seconds: '24600',
          },
        ])
      )
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows());
    const out = await loadWellnessRecords(owner, owner, window);
    expect(out.days).toEqual([
      {
        day: '2026-11-22',
        resting_hr: 58,
        hrv_ms: 52.5,
        body_battery: 71,
        sleep_score: 84,
        sleep_seconds: 24600,
        avg_stress: 36,
      },
      {
        day: '2026-11-23',
        resting_hr: 64,
        hrv_ms: null,
        body_battery: null,
        sleep_score: null,
        sleep_seconds: null,
        avg_stress: 11,
      },
    ]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('keeps real workouts, rounded to a tenth of a minute, and drops zero-length rows and bad weights', async () => {
    mocks.query
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(
        rows([
          {
            day: '2026-11-21',
            name: ' Chesterfield Hiking ',
            duration_minutes: '28.183034261067707',
          },
          { day: '2026-11-21', name: 'Active Calories', duration_minutes: 0 },
          { day: '2026-11-20', name: null, duration_minutes: 12 },
        ])
      )
      .mockResolvedValueOnce(
        rows([
          { day: '2026-11-22', weight: '91.3' },
          { day: '2026-11-23', weight: 'n/a' },
        ])
      );
    const out = await loadWellnessRecords(owner, undefined, window);
    expect(out.activities).toEqual([
      {
        day: '2026-11-21',
        name: 'Chesterfield Hiking',
        duration_minutes: 28.2,
      },
      { day: '2026-11-20', name: '', duration_minutes: 12 },
    ]);
    expect(out.weights_kg).toEqual([{ day: '2026-11-22', value: 91.3 }]);
  });

  it('asks only for the owner’s Garmin records and the weight week', async () => {
    mocks.query.mockResolvedValue(rows());
    await loadWellnessRecords(owner, owner, window);
    const calls = mocks.query.mock.calls.map(([text, params]) => ({
      text: String(text).replace(/\s+/g, ' '),
      params,
    }));
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.text).toContain('user_id=$1');
    expect(calls[0]!.text).toContain("source_provider='garmin'");
    expect(calls[1]!.text).toContain("source='garmin'");
    expect(calls[2]!.text).toContain('duration_minutes > 0');
    // The week's weight is asked for from the week's first day to today.
    expect(calls[3]!.params).toEqual([
      owner,
      window.weights_from_day,
      window.to_day,
    ]);
    expect(calls[3]!.text).toContain('BETWEEN $2 AND $3');
  });

  it('gives every query exactly the parameters it uses: PostgreSQL refuses one it never uses', async () => {
    mocks.query.mockResolvedValue(rows());
    await listWearableExportRecords(owner, owner).catch(() => undefined);
    await loadWellnessRecords(owner, owner, window);
    for (const [text, params] of mocks.query.mock.calls) {
      const used = new Set(
        [...String(text).matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
      );
      const given = new Set((params as unknown[]).map((_, i) => i + 1));
      expect(used, String(text)).toEqual(given);
    }
  });
});
