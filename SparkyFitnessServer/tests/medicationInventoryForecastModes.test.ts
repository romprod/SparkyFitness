import { beforeEach, describe, it, expect, vi } from 'vitest';
import { medicationInventoryPlannedForecastResponseSchema } from '@workspace/shared';
import { inventoryProjectionFixture } from './fixtures/medicationInventoryProjectionFixture.js';
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
  forecastInventorySnapshot,
  getMedicationInventoryForecast,
} from '../services/medicationInventoryForecastService.js';
import {
  buildInventoryDashboard,
  getMedicationInventoryDashboard,
} from '../services/medicationInventoryDashboardService.js';
const now = new Date('2026-11-16T12:00:00Z');
describe('explicit planned-cycle forecast read mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.load.mockResolvedValue(inventoryProjectionFixture());
  });
  it('keeps omitted/default committed payloads identical and rejects an unlabeled old response as planned', () => {
    const snapshot = inventoryProjectionFixture(),
      before = JSON.stringify(snapshot);
    const omitted = forecastInventorySnapshot(snapshot, now),
      committed = forecastInventorySnapshot(snapshot, now, 'committed');
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(committed));
    expect(JSON.stringify(omitted)).not.toMatch(
      /forecast_mode|cycle_assumptions|"projection"/
    );
    expect(
      medicationInventoryPlannedForecastResponseSchema.safeParse(omitted)
        .success
    ).toBe(false);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('echoes opt-in and preserves every whole/prepared/container projection with manual assumptions', () => {
    const snapshot = inventoryProjectionFixture(),
      before = JSON.stringify(snapshot);
    const planned = forecastInventorySnapshot(snapshot, now, 'planned_cycles');
    expect(planned.forecast_mode).toBe('planned_cycles');
    const med = planned.medications[0]!;
    expect(med.cycle_assumptions[0]).toMatchObject({
      course_id: snapshot.medications[0]!.courses[0]!.id,
      committed_end_date: '2026-11-07',
      manual_restart_required: true,
      overdue: true,
    });
    expect(med.projection.provisional_slots).toBeGreaterThan(0);
    expect(med.prepared_only.projection.provisional_slots).toBeGreaterThan(0);
    expect(
      med.containers[0]!.coverage.projection.provisional_slots
    ).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('still echoes opt-in for an ineligible course without inventing provisional dates', () => {
    const snapshot = inventoryProjectionFixture();
    snapshot.medications[0]!.courses[0]!.revisions[0]!.course_cycle_off_weeks =
      null;
    const planned = forecastInventorySnapshot(snapshot, now, 'planned_cycles');
    expect(planned.forecast_mode).toBe('planned_cycles');
    expect(planned.medications[0]!.cycle_assumptions).toEqual([]);
    expect(planned.medications[0]!.projection).toMatchObject({
      provisional_slots: 0,
      projection_starts_on: null,
    });
  });
  it('uses one read-only RR client for planned forecast and releases on success', async () => {
    const value = await getMedicationInventoryForecast(
      'owner',
      now,
      'planned_cycles'
    );
    expect(value.forecast_mode).toBe('planned_cycles');
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls.map((row) => row[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('builds Supply and queue from the same planned snapshot while keeping queue proof bytes unchanged', async () => {
    const snapshot = inventoryProjectionFixture();
    const committed = buildInventoryDashboard(snapshot, 'owner', now);
    const planned = await getMedicationInventoryDashboard(
      'owner',
      now,
      'planned_cycles'
    );
    expect(planned.forecast.forecast_mode).toBe('planned_cycles');
    expect(JSON.stringify(planned.preparation_queue)).toBe(
      JSON.stringify(committed.preparation_queue)
    );
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls.map((row) => row[0])).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    if (planned.supply.medication_id !== null)
      expect(
        planned.forecast.medications.some(
          (row) => row.medication_id === planned.supply.medication_id
        )
      ).toBe(true);
  });
  it('rolls back without falling back to a committed response when planned reads fail', async () => {
    mocks.load.mockRejectedValue(
      new Error('Synthetic planned snapshot failure')
    );
    await expect(
      getMedicationInventoryDashboard('owner', now, 'planned_cycles')
    ).rejects.toThrow('Synthetic planned snapshot failure');
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('keeps concurrent committed and planned calls isolated with one RR transaction per request', async () => {
    const clients = Array.from({ length: 2 }, () => ({
      query: vi.fn(async (_sql: string) => ({ rows: [] })),
      release: vi.fn(),
    }));
    let index = 0;
    mocks.getClient.mockImplementation(async () => clients[index++]);
    const [committed, planned] = await Promise.all([
      getMedicationInventoryForecast('owner', now),
      getMedicationInventoryForecast('owner', now, 'planned_cycles'),
    ]);
    expect(JSON.stringify(committed)).not.toMatch(
      /forecast_mode|cycle_assumptions|"projection"/
    );
    expect(planned.forecast_mode).toBe('planned_cycles');
    for (const client of clients) {
      expect(client.query.mock.calls.map((row) => row[0])).toEqual([
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        'COMMIT',
      ]);
      expect(client.release).toHaveBeenCalledOnce();
    }
  });
  it('preserves first-unserved provenance when provisional consumption influences a later committed shortage', () => {
    const snapshot = inventoryProjectionFixture(),
      med = snapshot.medications[0]!,
      second = structuredClone(med.courses[0]!);
    second.id = '00000000-0000-4000-a000-000000000070';
    const revision = second.revisions[0]!;
    revision.id = '00000000-0000-4000-a000-000000000071';
    revision.course_id = second.id;
    second.current_revision_id = revision.id;
    revision.start_date = '2026-11-17';
    revision.end_date = '2026-11-20';
    revision.course_cycle_on_weeks = null;
    revision.course_cycle_off_weeks = null;
    revision.course_cycle_anchor_date = null;
    revision.phase_origin_context = {
      start_date: revision.start_date,
      end_date: revision.end_date,
    };
    revision.rules[0] = {
      ...revision.rules[0]!,
      id: '00000000-0000-4000-a000-000000000072',
      revision_id: revision.id,
      time_of_day: '09:00:00',
      start_date: '2026-11-17',
    };
    revision.activity[0] = {
      ...revision.activity[0]!,
      revision_id: revision.id,
      from_at: '2026-11-17T00:00:00Z',
    };
    med.courses.push(second);
    med.containers[0]!.remaining_ml = '0.15';
    const row = forecastInventorySnapshot(snapshot, now, 'planned_cycles')
      .medications[0]!;
    expect(row.projection).toMatchObject({
      first_unserved_day: '2026-11-17',
      first_unserved_kind: 'committed',
      claim_basis: 'projected_coverage',
    });
    expect(row.cycle_assumptions).toHaveLength(1);
  });
  it('retains planned-only cross-zone date uncertainty through rows, Supply and every coverage scope', () => {
    const snapshot = inventoryProjectionFixture(),
      revision = snapshot.medications[0]!.courses[0]!.revisions[0]!;
    snapshot.medications[0]!.courses[0]!.timezone = 'Pacific/Kiritimati';
    revision.rules[0]!.time_of_day = null;
    const committed = buildInventoryDashboard(snapshot, 'owner', now);
    const planned = buildInventoryDashboard(
      snapshot,
      'owner',
      now,
      'planned_cycles'
    );
    const row = planned.forecast.medications[0]!;
    for (const coverage of [
      row,
      row.prepared_only,
      ...row.containers.map((container) => container.coverage),
    ]) {
      expect(coverage.limitations).toContain('unknown_projection_date');
      expect(coverage.status).toBe('unknown');
      expect(coverage.projection).toMatchObject({
        claim_basis: 'unknown',
        projection_starts_on: null,
        first_unserved_day: null,
        first_unserved_kind: null,
      });
      expect(coverage.depletion_date).toBeNull();
      expect(coverage.reorder_by).toBeNull();
    }
    expect(planned.supply).toEqual({
      state: 'unavailable',
      medication_id: row.medication_id,
    });
    expect(JSON.stringify(planned.preparation_queue)).toBe(
      JSON.stringify(committed.preparation_queue)
    );
    expect(JSON.stringify(committed)).not.toContain('unknown_projection_date');
  });
});
