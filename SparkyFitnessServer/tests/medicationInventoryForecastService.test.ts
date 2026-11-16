import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryForecastSnapshot } from '../models/medicationInventoryForecastRepository.js';
import type { MedicationSyringe } from '@workspace/shared';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.js';
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
const device: MedicationSyringe = {
  id: '00000000-0000-4000-a000-000000000099',
  name: 'Synthetic syringe',
  device_type: 'syringe',
  graduation_type: 'units',
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
  is_default: true,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
};
function snapshot(): InventoryForecastSnapshot {
  const course = medicationCourseFixture();
  return {
    today: '2026-11-16',
    dashboard_stock: [],
    timezone: 'Europe/London',
    defaults: { lead_days: 14, buffer_days: 3 },
    devices: [device],
    preferred_device_id: device.id,
    medications: [
      {
        id: course.medication_id!,
        name: 'Synthetic non-GLP peptide',
        is_active: true,
        is_glp1: false,
        type_id: 'injection',
        route_id: 'subcutaneous',
        dose_amount: '1',
        dose_unit: 'mg',
        courses: [course],
        actuals: [],
        phase_actuals: [],
        legacy_schedules: [],
        legacy_entries: [],
        legacy_titration: [],
        containers: [
          {
            id: '00000000-0000-4000-a000-000000000088',
            status: 'in_use',
            remaining_ml: '10',
            concentration_mcg_ml: '10000',
            usable_until: '2027-12-31',
            expiry_date: null,
            opened_at: null,
            created_at: '2026-11-01T00:00:00Z',
          },
        ],
        stock_limitations: [],
      },
    ],
  };
}
const now = new Date('2026-11-16T07:00:00Z');
describe('read-only server-now inventory orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.load.mockResolvedValue(snapshot());
  });
  it('uses one read-only RR client and releases after commit', async () => {
    const value = await getMedicationInventoryForecast('owner', now);
    expect(value.as_of).toBe(now.toISOString());
    expect(value.medications).toHaveLength(1);
    expect(mocks.query.mock.calls.map((c) => c[0])).toEqual([
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
  it('rolls back and releases on read failure', async () => {
    mocks.load.mockRejectedValue(new Error('Synthetic failure'));
    await expect(getMedicationInventoryForecast('owner', now)).rejects.toThrow(
      'Synthetic failure'
    );
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('includes non-GLP prepared routes and all active plans without mutating input', () => {
    const input = snapshot();
    const second = structuredClone(input.medications[0]!.courses[0]!);
    second.id = '00000000-0000-4000-a000-000000000077';
    second.revisions[0]!.id = '00000000-0000-4000-a000-000000000076';
    second.current_revision_id = second.revisions[0]!.id;
    input.medications[0]!.courses.push(second);
    const before = JSON.stringify(input);
    const result = forecastInventorySnapshot(input, now);
    expect(result.medications[0]!.device_basis).toHaveLength(2);
    expect(result.medications[0]!.expected_slots).toBeGreaterThan(1);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('does not let an obsolete incompatible revision poison current demand', () => {
    const input = snapshot(),
      c = input.medications[0]!.courses[0]!;
    const obsolete = structuredClone(c.revisions[0]!);
    obsolete.id = '00000000-0000-4000-a000-000000000066';
    obsolete.status = 'completed';
    obsolete.end_date = '2026-11-02';
    obsolete.activity[0]!.until_at = '2026-11-03T00:00:00Z';
    obsolete.device_choice = 'explicit';
    obsolete.device_id = '00000000-0000-4000-a000-000000000055';
    input.devices.push({
      ...device,
      id: obsolete.device_id,
      device_type: 'pump',
    });
    c.revisions.unshift(obsolete);
    expect(
      forecastInventorySnapshot(input, now).medications[0]!.limitations
    ).not.toContain('incompatible_device');
  });
  it('discloses active PRN and medication-global titration as unmodelled demand', () => {
    for (const kind of ['prn', 'daily']) {
      const input = snapshot();
      input.medications[0]!.legacy_schedules = [
        {
          id: '00000000-0000-4000-a000-000000000044',
          medication_id: input.medications[0]!.id,
          schedule_type_id: kind,
          time_of_day: null,
          dose_amount: '1',
          days_of_week: null,
          interval_days: null,
          day_of_month: null,
          cycle_on_days: null,
          cycle_off_days: null,
          with_meal: null,
          prn_reason: null,
          prn_max_per_day: null,
          start_date: null,
          end_date: null,
          active: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      if (kind === 'daily')
        input.medications[0]!.legacy_titration = [
          {
            id: '00000000-0000-4000-a000-000000000033',
            medication_id: input.medications[0]!.id,
            dose_mg: '1',
            dose_unit: 'mg',
            start_date: null,
            planned_weeks: null,
            step_order: 0,
            status: 'active',
            is_taper: false,
          },
        ];
      const result = forecastInventorySnapshot(input, now).medications[0]!;
      expect(result.status).toBe('unknown');
      expect(result.limitations).toContain('unmodelled_legacy_demand');
    }
  });
});
