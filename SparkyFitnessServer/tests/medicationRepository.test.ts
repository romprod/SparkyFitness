import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockDbClient,
  type MockDbClient,
} from './helpers/mockDbClient.js';
import medicationRepository from '../models/medicationRepository.js';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
}));

vi.mock('../models/medicationCourseRepository.js', () => ({
  guardLegacyScheduleMutation: vi.fn(),
}));

describe('medicationRepository', () => {
  let mockClient: MockDbClient;
  const userId = uuidv4();
  const scheduleId = uuidv4();

  beforeEach(() => {
    mockClient = createMockDbClient();
    vi.mocked(getClient).mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('updateSchedule', () => {
    it('passes explicit nulls through to the SQL params', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId, schedule_type_id: 'daily' }],
      });

      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        {
          schedule_type_id: 'daily',
          time_of_day: '09:00',
          days_of_week: null,
          interval_days: null,
        }
      );

      const [sql, values] = mockClient.query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE medication_schedules')
      )!;
      expect(sql).toContain('UPDATE medication_schedules');
      expect(sql).toContain('schedule_type_id = $3');
      expect(sql).toContain('time_of_day = $4');
      expect(sql).toContain('days_of_week = $5');
      expect(sql).toContain('interval_days = $6');
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(values).toEqual([
        scheduleId,
        userId,
        'daily',
        '09:00',
        null,
        null,
      ]);
      expect(result).toEqual({ id: scheduleId, schedule_type_id: 'daily' });
    });

    it('returns the current row without updating on an empty patch', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId }],
      });

      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        {}
      );

      const [sql, values] = mockClient.query.mock.calls.find(([sql]) =>
        String(sql).includes('SELECT id, medication_id')
      )!;
      expect(sql).toContain('SELECT');
      expect(sql).not.toContain('UPDATE');
      expect(values).toEqual([scheduleId, userId]);
      expect(result).toEqual({ id: scheduleId });
    });

    it('produces no SET clause for omitted custom_fields and source', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId }],
      });

      await medicationRepository.updateSchedule(userId, scheduleId, {
        time_of_day: '07:30',
        source: 'sneaky',
      });

      const [sql, values] = mockClient.query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE medication_schedules')
      )!;
      expect(sql).not.toContain('custom_fields =');
      expect(sql).not.toContain('source =');
      expect(values).toEqual([scheduleId, userId, '07:30']);
    });

    it('returns null when the schedule does not exist for the user', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        { active: false }
      );
      expect(result).toBeNull();
    });
  });
});
