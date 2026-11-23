import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({ records: vi.fn(), timezone: vi.fn() }));
vi.mock('../models/medicationWellnessRepository.js', () => ({
  loadWellnessRecords: mocks.records,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.timezone,
}));
import { getMedicationWellnessStreams } from '../services/medicationWellnessService.js';

const records = { days: [], activities: [], weights_kg: [] };

describe('recovery and weight tile records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timezone.mockResolvedValue('Europe/London');
    mocks.records.mockResolvedValue(records);
  });

  it('covers the fortnight and the week ending today in the owner’s own day', async () => {
    const out = await getMedicationWellnessStreams(
      owner,
      owner,
      new Date('2026-11-23T10:00:00.000Z')
    );
    expect(out).toEqual({ today: '2026-11-23', ...records });
    expect(mocks.records).toHaveBeenCalledWith(owner, owner, {
      from_day: '2026-11-10',
      to_day: '2026-11-23',
      weights_from_day: '2026-11-17',
    });
  });

  it('uses the owner’s day, not the server’s, around midnight', async () => {
    // 23:30 UTC on 22 Nov is already 12:30 on 23 Nov in Auckland.
    mocks.timezone.mockResolvedValue('Pacific/Auckland');
    const out = await getMedicationWellnessStreams(
      owner,
      owner,
      new Date('2026-11-22T23:30:00.000Z')
    );
    expect(out.today).toBe('2026-11-23');
    expect(mocks.records.mock.calls[0]![2]).toMatchObject({
      to_day: '2026-11-23',
    });
  });
});
