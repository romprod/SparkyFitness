import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  records: vi.fn(),
  courses: vi.fn(),
  history: vi.fn(),
  timezone: vi.fn(),
}));
vi.mock('../models/medicationInsightRepository.js', () => ({
  loadInsightRecords: mocks.records,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.timezone,
}));
vi.mock('../services/medicationCourseService.js', () => ({
  listMedicationCourses: mocks.courses,
  getMedicationCourseHistory: mocks.history,
}));
import { getMedicationInsightStreams } from '../services/medicationInsightService.js';

const now = new Date('2026-11-22T10:00:00.000Z');
const records = (ids: string[] = ['reta', 'cagri']) => ({
  doses: [{ at: '2026-11-16T13:19:18.510Z', day: '2026-11-16' }],
  wearable: [],
  weights_kg: [],
  symptoms: [],
  injectable_medication_ids: ids,
});
const adherence = (taken: number, missed: number) => ({
  adherence: { taken, missed },
});

describe('insight records for the last 90 days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timezone.mockResolvedValue('Europe/London');
    mocks.records.mockResolvedValue(records());
    mocks.courses.mockResolvedValue({
      courses: [
        { id: 'c-reta', medication_id: 'reta' },
        { id: 'c-cagri', medication_id: 'cagri' },
        { id: 'c-pill', medication_id: 'sertraline' },
        { id: 'c-none', medication_id: null },
      ],
    });
    mocks.history.mockImplementation(async (_owner: string, id: string) =>
      id === 'c-reta' ? adherence(3, 1) : adherence(1, 0)
    );
  });

  it('covers the 90 days ending today in the owner’s own day', async () => {
    const out = await getMedicationInsightStreams(owner, owner, now);
    expect(out.today).toBe('2026-11-22');
    expect(out.from_day).toBe('2026-08-25');
    expect(mocks.records).toHaveBeenCalledWith(
      owner,
      owner,
      { from_day: '2026-08-25', to_day: '2026-11-22' },
      'Europe/London'
    );
    expect(out.doses).toEqual(records().doses);
    expect(out).not.toHaveProperty('injectable_medication_ids');
  });

  it('uses the owner’s day, not the server’s, around midnight', async () => {
    // 23:30 UTC on 21 Nov is already 12:30 on 22 Nov in Auckland.
    mocks.timezone.mockResolvedValue('Pacific/Auckland');
    const out = await getMedicationInsightStreams(
      owner,
      owner,
      new Date('2026-11-21T23:30:00.000Z')
    );
    expect(out.today).toBe('2026-11-22');
    expect(mocks.records).toHaveBeenCalledWith(
      owner,
      owner,
      { from_day: '2026-08-25', to_day: '2026-11-22' },
      'Pacific/Auckland'
    );
  });

  it('scores adherence as taken out of taken plus missed across injectable plans only', async () => {
    const out = await getMedicationInsightStreams(owner, owner, now);
    // Retatrutide 3 taken, 1 missed; Cagrilintide 1 taken: 4 of 5. The pill plan is left out.
    expect(out.adherence_pct).toBe(80);
    const read = mocks.history.mock.calls.map((call) => call[1]);
    expect(read).toEqual(['c-reta', 'c-cagri']);
    expect(mocks.history).toHaveBeenCalledWith(
      owner,
      'c-reta',
      '2026-08-25',
      '2026-11-22',
      now
    );
  });

  it('has no adherence when nothing was scored or there is no injectable', async () => {
    mocks.history.mockResolvedValue(adherence(0, 0));
    expect(
      (await getMedicationInsightStreams(owner, owner, now)).adherence_pct
    ).toBeNull();
    mocks.records.mockResolvedValue(records([]));
    mocks.courses.mockClear();
    expect(
      (await getMedicationInsightStreams(owner, owner, now)).adherence_pct
    ).toBeNull();
    expect(mocks.courses).not.toHaveBeenCalled();
  });

  it('still returns the records when a plan’s history cannot be read', async () => {
    mocks.history.mockRejectedValue(new Error('plan history broke'));
    const out = await getMedicationInsightStreams(owner, owner, now);
    expect(out.adherence_pct).toBeNull();
    expect(out.doses).toHaveLength(1);
  });
});
