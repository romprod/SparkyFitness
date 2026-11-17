import type { InventoryForecastSnapshot } from '../../models/medicationInventoryForecastRepository.js';
import { medicationCourseFixture } from './medicationCourseFixture.js';
import { dashboardStockFixture } from './medicationInventoryDashboardFixture.js';
/** Only public synthetic identities and exact physical facts; no saved personal records. */
export function inventoryProjectionFixture(): InventoryForecastSnapshot {
  const course = medicationCourseFixture(),
    revision = course.revisions[0]!;
  course.timezone = 'UTC';
  revision.end_date = '2026-11-07';
  revision.course_cycle_on_weeks = 1;
  revision.course_cycle_off_weeks = 1;
  revision.course_cycle_anchor_date = '2026-11-01';
  revision.phase_origin_context = {
    start_date: '2026-11-01',
    end_date: '2026-11-07',
  };
  const deviceId = '00000000-0000-4000-a000-000000000099';
  return {
    today: '2026-11-16',
    timezone: 'UTC',
    defaults: { lead_days: 14, buffer_days: 3 },
    devices: [
      {
        id: deviceId,
        name: 'Synthetic syringe',
        device_type: 'syringe',
        graduation_type: 'units',
        units_per_ml: 100,
        capacity_ml: '1',
        capacity_units: 100,
        increment: '1',
        is_default: true,
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      },
    ],
    preferred_device_id: deviceId,
    dashboard_stock: [dashboardStockFixture()],
    medications: [
      {
        id: course.medication_id!,
        name: 'Synthetic prepared peptide',
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
            remaining_ml: '0.2',
            concentration_mcg_ml: '10000',
            usable_until: '2027-12-31',
            expiry_date: null,
            opened_at: '2026-11-01',
            created_at: '2026-11-01T00:00:00Z',
          },
        ],
        stock_limitations: [],
      },
    ],
  };
}
