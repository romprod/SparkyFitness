import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  nutrition: vi.fn(),
  labs: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: mocks.getClient,
  dbContextStorage: { getStore: () => ({ authenticatedUserId: 'owner' }) },
}));
vi.mock('../models/reportRepository.js', () => ({
  default: { getNutritionData: mocks.nutrition },
}));
vi.mock('../models/labResultRepository.js', () => ({
  listLatestLabPanels: mocks.labs,
}));
import { getAppointmentReportData } from '../services/appointmentReportService.js';
const tables = new Map<string, Record<string, unknown>[]>();
const read = () =>
  getAppointmentReportData(
    'owner',
    { from: '2026-01-01', to: '2026-12-31', timezone: 'Europe/London' },
    new Date('2026-11-16T01:00:00Z')
  );
describe('appointment PDF hydration and timing facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: [...tables].find(([table]) => sql.includes(table))?.[1] ?? [],
    }));
    mocks.nutrition.mockResolvedValue([]);
    mocks.labs.mockResolvedValue({ panels: [] });
  });
  it.each([
    {
      name: 'late',
      actual: '2026-03-29T10:12:00Z',
      scheduled: '2026-03-29T10:00:00Z',
      expected: 12,
    },
    {
      name: 'early',
      actual: '2026-03-29T09:55:00Z',
      scheduled: '2026-03-29T10:00:00Z',
      expected: -5,
    },
    {
      name: 'on time',
      actual: '2026-03-29T10:00:00Z',
      scheduled: '2026-03-29T10:00:00Z',
      expected: 0,
    },
    {
      name: 'rounding',
      actual: '2026-03-29T10:01:29Z',
      scheduled: '2026-03-29T10:00:00Z',
      expected: 1,
    },
    {
      name: 'spring DST explicit offset',
      actual: '2026-03-29T03:12:00+01:00',
      scheduled: '2026-03-29T02:00:00Z',
      expected: 12,
    },
    {
      name: 'autumn duplicate clock hour',
      actual: '2026-10-25T01:30:00Z',
      scheduled: '2026-10-25T01:30:00+01:00',
      expected: 60,
    },
    {
      name: 'recorded PG Dates',
      actual: new Date('2026-03-29T09:55:00Z'),
      scheduled: new Date('2026-03-29T10:00:00Z'),
      expected: -5,
    },
    {
      name: 'no actual time',
      actual: '2026-03-29',
      scheduled: '2026-03-29T10:00:00Z',
      expected: null,
    },
    {
      name: 'no scheduled time',
      actual: '2026-03-29T10:00:00Z',
      scheduled: '2026-03-29',
      expected: null,
    },
    {
      name: 'no actual offset',
      actual: '2026-03-29T10:12:00',
      scheduled: '2026-03-29T10:00:00Z',
      expected: null,
    },
    {
      name: 'missing actual',
      actual: null,
      scheduled: '2026-03-29T10:00:00Z',
      expected: null,
    },
    {
      name: 'missing schedule',
      actual: '2026-03-29T10:00:00Z',
      scheduled: null,
      expected: null,
    },
    {
      name: 'invalid actual',
      actual: new Date('invalid'),
      scheduled: '2026-03-29T10:00:00Z',
      expected: null,
    },
  ])(
    'uses signed explicit recorded instants: $name',
    async ({ actual, scheduled, expected }) => {
      tables.set('FROM medication_entries ', [
        {
          id: 'ordinary',
          medication_id: null,
          status: 'taken',
          taken_at: actual,
          scheduled_for: scheduled,
          entry_date: '2026-03-29',
        },
      ]);
      const result = await read();
      expect(result.doseLog[0]?.timingDeltaMinutes).toBe(expected);
      if (typeof actual === 'string' && !actual.includes('T'))
        expect(result.doseLog[0]?.occurredAt).toBeNull();
      if (typeof scheduled === 'string' && !scheduled.includes('T'))
        expect(result.doseLog[0]?.scheduledFor).toBeNull();
    }
  );
  it.each(['skipped', 'snoozed', 'planned'])(
    'does not calculate timing for %s entries even when timestamps exist',
    async (status) => {
      tables.set('FROM medication_entries ', [
        {
          id: 'entry',
          status,
          taken_at: '2026-03-29T10:12:00Z',
          scheduled_for: '2026-03-29T10:00:00Z',
          entry_date: '2026-03-29',
        },
      ]);
      expect((await read()).doseLog[0]).toMatchObject({
        administered: false,
        timingDeltaMinutes: null,
      });
    }
  );
  it.each([null, undefined, 0, -1, 'NaN', 'Infinity'])(
    'does not invent a target for saved %s',
    async (saved) => {
      tables.set('goal_date=$2', [{ water_goal_ml: saved }]);
      expect((await read()).wellness.hydrationTargetMl).toBeNull();
    }
  );
  it('prefers a saved goal for current local today over weekday preset and carried targets', async () => {
    tables.set('goal_date=$2', [{ water_goal_ml: '2400' }]);
    tables.set('FROM weekly_goal_plans', [{ water_goal: '2100' }]);
    tables.set('goal_date<$2', [{ water_goal_ml: '1800' }]);
    const data = await read();
    expect(data.wellness.hydrationTargetMl).toBe(2400);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('goal_date=$2'),
      ['owner', '2026-11-16']
    );
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        String(sql).includes('FROM weekly_goal_plans')
      )
    ).toBe(false);
  });
  it('uses saved weekday target before a carried goal, and carries when the preset omits hydration', async () => {
    tables.set('FROM weekly_goal_plans', [{ water_goal: '2100' }]);
    tables.set('goal_date<$2', [{ water_goal_ml: '1800' }]);
    expect((await read()).wellness.hydrationTargetMl).toBe(2100);
    tables.set('FROM weekly_goal_plans', [{ water_goal: null }]);
    expect((await read()).wellness.hydrationTargetMl).toBe(1800);
  });
  it('keeps absent target absent and observed water zero distinct from missing', async () => {
    tables.set('FROM water_intake_entries', [
      { entry_date: '2026-03-29', total_ml: 0 },
      { entry_date: '2026-03-30', total_ml: null },
      { entry_date: '2026-03-31', total_ml: 1000 },
    ]);
    const data = await read();
    expect(data.wellness.hydrationTargetMl).toBeNull();
    expect(data.wellness.water).toEqual([
      { day: '2026-03-29', millilitres: 0 },
      { day: '2026-03-30', millilitres: null },
      { day: '2026-03-31', millilitres: 1000 },
    ]);
    expect(mocks.query.mock.calls[0]).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    ]);
    expect(mocks.query.mock.calls.at(-1)).toEqual(['COMMIT']);
  });
  it('does not infer an injection schedule from current medication schedules', async () => {
    tables.set('FROM injection_entries ', [
      {
        id: 'injection',
        medication_id: 'med',
        injected_at: '2026-03-29T10:12:00Z',
        entry_date: '2026-03-29',
        dose_mg: '1',
      },
    ]);
    tables.set('FROM medication_schedules ', [
      {
        medication_id: 'med',
        schedule_type_id: 'daily',
        time_of_day: '10:00:00',
        active: true,
      },
    ]);
    expect((await read()).doseLog[0]).toMatchObject({
      sourceKind: 'injection',
      scheduledFor: null,
      timingDeltaMinutes: null,
    });
  });
});
