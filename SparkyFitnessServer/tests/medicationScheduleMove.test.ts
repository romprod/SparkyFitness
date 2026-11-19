import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  createMockDbClient,
  type MockDbClient,
} from './helpers/mockDbClient.js';
import medicationRepository from '../models/medicationRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({ getClient: vi.fn() }));
vi.mock('../models/medicationCourseRepository.js', () => ({
  guardLegacyScheduleMutation: vi.fn(),
  transitionCourseMedicationActivity: vi.fn(),
}));

const userId = uuidv4();
const medicationId = uuidv4();
const ruleId = uuidv4();

const weeklyRow = (extra: Record<string, unknown> = {}) => ({
  id: ruleId,
  medication_id: medicationId,
  schedule_type_id: 'weekly',
  time_of_day: '08:00:00',
  dose_amount: '0.5',
  days_of_week: [1, 4],
  interval_days: null,
  day_of_month: null,
  cycle_on_days: null,
  cycle_off_days: null,
  with_meal: null,
  prn_reason: null,
  prn_max_per_day: null,
  start_date: '2026-10-01',
  end_date: null,
  active: true,
  source: 'manual',
  custom_fields: { note: 'keep' },
  ...extra,
});

describe('moveSchedules', () => {
  let client: MockDbClient;
  let handoffs: unknown[];
  let rows: unknown[];

  beforeEach(() => {
    client = createMockDbClient();
    handoffs = [];
    rows = [weeklyRow()];
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (
        text.includes('FROM medication_schedules') &&
        text.includes('FOR UPDATE') &&
        text.includes('ANY')
      )
        return { rows, rowCount: rows.length };
      if (text.includes('medication_course_handoffs'))
        return { rows: handoffs, rowCount: handoffs.length };
      if (text.includes('INSERT INTO medication_schedules'))
        return { rows: [{ id: 'created' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    vi.mocked(getClient).mockResolvedValue(client);
  });
  afterEach(() => vi.clearAllMocks());

  const statements = () => client.query.mock.calls.map(([sql]) => String(sql));
  const body = (extra: Record<string, unknown> = {}) => ({
    schedule_ids: [ruleId],
    end_date: '2026-11-18',
    new_start_date: '2026-11-19',
    rotate_days: 1,
    ...extra,
  });

  it('ends the rule and starts a rotated copy in one transaction', async () => {
    const result = await medicationRepository.moveSchedules(
      userId,
      medicationId,
      body()
    );
    expect(result).toEqual({
      ended_ids: [ruleId],
      created: [{ id: 'created' }],
    });
    const sql = statements();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    const update = client.query.mock.calls.find(([s]) =>
      String(s).includes('UPDATE medication_schedules')
    )!;
    expect(update[1]).toEqual([ruleId, userId, '2026-11-18']);
    const insert = client.query.mock.calls.find(([s]) =>
      String(s).includes('INSERT INTO medication_schedules')
    )!;
    expect(insert[1]).toEqual([
      medicationId,
      userId,
      'weekly',
      '08:00:00',
      '0.5',
      [2, 5],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      '2026-11-19',
      null,
      'manual',
      JSON.stringify({ note: 'keep' }),
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('wraps the week when rotating and keeps the rule end date', async () => {
    rows = [weeklyRow({ days_of_week: [5, 6], end_date: '2027-03-01' })];
    await medicationRepository.moveSchedules(
      userId,
      medicationId,
      body({ rotate_days: 2 })
    );
    const insert = client.query.mock.calls.find(([s]) =>
      String(s).includes('INSERT INTO medication_schedules')
    )!;
    expect(insert[1][5]).toEqual([0, 1]);
    expect(insert[1][14]).toBe('2027-03-01');
  });

  it('rolls an every-N-days rule one interval after the dose', async () => {
    rows = [
      weeklyRow({
        schedule_type_id: 'every_n_days',
        days_of_week: null,
        interval_days: 7,
        start_date: '2026-11-02',
      }),
    ];
    await medicationRepository.moveSchedules(userId, medicationId, {
      schedule_ids: [ruleId],
      end_date: '2026-11-18',
      new_start_date: '2026-11-25',
    });
    const insert = client.query.mock.calls.find(([s]) =>
      String(s).includes('INSERT INTO medication_schedules')
    )!;
    expect(insert[1][5]).toBeNull();
    expect(insert[1][6]).toBe(7);
    expect(insert[1][13]).toBe('2026-11-25');
  });

  it.each([
    [
      'a start that is not after the end',
      { new_start_date: '2026-11-18' },
      422,
    ],
    [
      'a weekly start more than a day on',
      { new_start_date: '2026-11-20' },
      422,
    ],
    ['a weekly rule with no rotation', { rotate_days: undefined }, 422],
  ])('refuses %s and rolls back', async (_name, extra, status) => {
    await expect(
      medicationRepository.moveSchedules(userId, medicationId, body(extra))
    ).rejects.toMatchObject({ statusCode: status });
    expect(statements()).not.toContain('COMMIT');
    expect(
      client.query.mock.calls.some(([s]) => String(s).includes('INSERT INTO'))
    ).toBe(false);
  });

  it('refuses an every-N-days move that is not one interval on, or is rotated', async () => {
    rows = [
      weeklyRow({
        schedule_type_id: 'every_n_days',
        days_of_week: null,
        interval_days: 7,
      }),
    ];
    await expect(
      medicationRepository.moveSchedules(userId, medicationId, {
        schedule_ids: [ruleId],
        end_date: '2026-11-18',
        new_start_date: '2026-11-24',
      })
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      medicationRepository.moveSchedules(userId, medicationId, {
        schedule_ids: [ruleId],
        end_date: '2026-11-18',
        new_start_date: '2026-11-25',
        rotate_days: 1,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses inactive, as-needed, daily and already-ended rules', async () => {
    for (const row of [
      weeklyRow({ active: false }),
      weeklyRow({ schedule_type_id: 'prn' }),
      weeklyRow({ schedule_type_id: 'daily', days_of_week: null }),
      weeklyRow({ end_date: '2026-11-18' }),
      weeklyRow({ start_date: '2026-11-19' }),
    ]) {
      rows = [row];
      await expect(
        medicationRepository.moveSchedules(userId, medicationId, body())
      ).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(
      client.query.mock.calls.some(([s]) => String(s).includes('INSERT INTO'))
    ).toBe(false);
  });

  it('refuses a schedule retained for a course', async () => {
    handoffs = [{ '?column?': 1 }];
    await expect(
      medicationRepository.moveSchedules(userId, medicationId, body())
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(statements()).toContain('ROLLBACK');
  });

  it('reports a missing or foreign schedule as not found', async () => {
    rows = [];
    await expect(
      medicationRepository.moveSchedules(userId, medicationId, body())
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(statements()).toContain('ROLLBACK');
  });
});
