import { beforeEach, describe, it, expect, vi } from 'vitest';
import { courseTimelineSnapshotFixture } from './fixtures/medicationCourseTimelineFixture.js';
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  load: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: mocks.getClient,
  dbContextStorage: { getStore: () => undefined },
}));
vi.mock('../models/medicationCourseTimelineRepository.js', () => ({
  loadMedicationCourseTimelineSnapshot: mocks.load,
}));
import { getMedicationCourseTimeline } from '../services/medicationCourseTimelineService.js';
describe('read-only timeline orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.load.mockResolvedValue(courseTimelineSnapshotFixture());
  });
  it('captures server now once and builds the strict geometry from one RR READ ONLY snapshot', async () => {
    const now = new Date('2026-11-17T12:00:00Z'),
      result = await getMedicationCourseTimeline('owner', now);
    expect(result.as_of).toBe(now.toISOString());
    expect(result.window.days).toBe(140);
    expect(result.week_ticks).toHaveLength(20);
    expect(result.overlap).toHaveLength(140);
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.query }),
      'owner',
      now
    );
    expect(mocks.getClient).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls.map((row) => row[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rolls back and releases on a failed snapshot without producing a fabricated empty timeline', async () => {
    mocks.load.mockRejectedValue(new Error('Synthetic snapshot failure'));
    await expect(getMedicationCourseTimeline('owner')).rejects.toThrow(
      'Synthetic snapshot failure'
    );
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
