import { beforeEach, describe, it, expect, vi } from 'vitest';
import type {
  MedicationInventoryForecast,
  MedicationInventoryForecastResponse,
} from '@workspace/shared';
import { dashboardStockFixture } from './fixtures/medicationInventoryDashboardFixture.js';
import {
  UpdatePenBodySchema,
  CreatePenBodySchema,
} from '../schemas/medicationSchemas.js';
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
vi.mock('../models/medicationInventoryForecastRepository.js', () => ({
  loadInventoryForecastSnapshot: mocks.load,
}));
import {
  selectInventorySupply,
  getMedicationInventoryDashboard,
} from '../services/medicationInventoryDashboardService.js';
function row(
  id: string,
  status: MedicationInventoryForecast['status'],
  reorder_by: string | null = null,
  name = 'Synthetic'
): MedicationInventoryForecast {
  const coverage = {
    status,
    basis:
      status === 'unknown'
        ? ('unknown' as const)
        : status === 'covered'
          ? ('horizon' as const)
          : ('depleted' as const),
    coverage_through: status === 'unknown' ? null : '2026-12-01',
    depletion_date:
      status === 'reorder_now' || status === 'ok' ? '2026-12-01' : null,
    reorder_by,
    days_left: status === 'reorder_now' || status === 'ok' ? 15 : null,
    served_slots: 0,
    expected_slots: 1,
    lead_days: 14,
    buffer_days: 3,
    limitations: [],
  };
  return {
    ...coverage,
    medication_id: id,
    name,
    route: 'injection',
    prepared_only: coverage,
    containers: [],
    device_basis: [],
  };
}
const forecast = (
  medications: MedicationInventoryForecast[]
): MedicationInventoryForecastResponse => ({
  as_of: '2026-11-16T12:00:00Z',
  today: '2026-11-16',
  timezone: 'UTC',
  horizon_days: 365,
  max_slots: 800,
  defaults: { lead_days: 14, buffer_days: 3 },
  medications,
});
describe('dashboard supply authority and coherent export snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.load.mockResolvedValue({
      today: '2026-11-16',
      timezone: 'UTC',
      defaults: { lead_days: 14, buffer_days: 3 },
      medications: [],
      devices: [],
      preferred_device_id: null,
      dashboard_stock: [dashboardStockFixture()],
    });
  });
  it('selects source urgency before date, then earliest reorder date and name without changing I06 rows', () => {
    const rows = [
      row('a', 'ok', '2026-11-17'),
      row('b', 'reorder_now', '2026-11-25'),
      row('c', 'reorder_now', '2026-11-24', 'Z'),
      row('d', 'reorder_now', '2026-11-24', 'A'),
    ];
    const before = JSON.stringify(rows);
    expect(selectInventorySupply(forecast(rows))).toEqual({
      state: 'forecast',
      medication_id: 'd',
    });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('keeps named unknown selection distinct from provably no demand, including unmodelled demand with zero slots', () => {
    const unknown = row('unknown', 'unknown');
    expect(selectInventorySupply(forecast([unknown]))).toEqual({
      state: 'unavailable',
      medication_id: 'unknown',
    });
    unknown.expected_slots = 0;
    unknown.limitations = ['no_forecast_slots', 'unknown_stock'];
    expect(selectInventorySupply(forecast([unknown]))).toEqual({
      state: 'no_demand',
      medication_id: null,
    });
    unknown.limitations.push('unmodelled_legacy_demand');
    expect(selectInventorySupply(forecast([unknown]))).toEqual({
      state: 'unavailable',
      medication_id: 'unknown',
    });
  });
  it('returns queue+unchanged I06 forecast from one server-now RR read-only client', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const value = await getMedicationInventoryDashboard('owner', now);
    expect(value.forecast.as_of).toBe(now.toISOString());
    expect(value.preparation_queue[0]).toMatchObject({
      stock_id: dashboardStockFixture().id,
      expired: true,
      label_mass_mg: null,
    });
    expect(mocks.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.query }),
      'owner',
      now
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rolls back and releases on failed reads', async () => {
    mocks.load.mockRejectedValue(new Error('Synthetic failure'));
    await expect(getMedicationInventoryDashboard('owner')).rejects.toThrow(
      'Synthetic failure'
    );
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('keeps old pen patches valid and requires a preparation payload for the optional queue guard', () => {
    expect(
      UpdatePenBodySchema.safeParse({ label: 'Unchanged old client' }).success
    ).toBe(true);
    expect(
      UpdatePenBodySchema.safeParse({
        expected_preparation_queue_state: 'a'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      UpdatePenBodySchema.safeParse({
        preparation: {
          mode: 'reconstituted',
          mass_value: 2,
          mass_unit: 'mg',
          final_volume_ml: 2,
          prepared_date: '2026-11-16',
        },
        expected_preparation_queue_state: 'a'.repeat(64),
      }).success
    ).toBe(true);
    expect(
      CreatePenBodySchema.safeParse({
        expected_preparation_queue_state: 'a'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      UpdatePenBodySchema.safeParse({
        expected_preparation_queue_state: 'invalid',
      }).success
    ).toBe(false);
  });
});
