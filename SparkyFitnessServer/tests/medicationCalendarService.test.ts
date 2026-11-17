import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  load: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
vi.mock('../models/medicationCalendarRepository.js', () => ({
  loadMedicationCalendarSnapshot: mocks.load,
}));
import { getMedicationCalendarWeek } from '../services/medicationCalendarService.js';
describe('coherent calendar week orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.load.mockResolvedValue({
      as_of: '2026-11-17T12:00:00.000Z',
      today: '2026-11-17',
      timezone: 'UTC',
      week_start: '2026-11-16',
      medications: [],
      courses: [],
      managed_actuals: [],
      phase_actuals: [],
      legacy_schedules: [],
      actuals: [],
    });
  });
  it('uses one client and fixed instant in one RR READ ONLY transaction for all seven days', async () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const result = await getMedicationCalendarWeek('owner', '2026-11-16', now);
    expect(result.days).toHaveLength(7);
    expect(result.as_of).toBe(now.toISOString());
    expect(mocks.getClient).toHaveBeenCalledExactlyOnceWith('owner');
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ query: mocks.query }),
      'owner',
      now,
      '2026-11-16'
    );
    expect(mocks.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rolls back snapshot failure rather than returning an invented empty week', async () => {
    mocks.load.mockRejectedValue(new Error('Synthetic read failure'));
    await expect(getMedicationCalendarWeek('owner')).rejects.toThrow(
      'Synthetic read failure'
    );
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
