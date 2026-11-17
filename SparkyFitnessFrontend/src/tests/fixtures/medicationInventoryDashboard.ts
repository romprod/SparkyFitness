import type {
  MedicationInventoryPlannedDashboardResponse,
  MedicationPreparationQueueItem,
  MedicationPen,
} from '@workspace/shared';
import { inventoryForecastFixture } from './medicationInventoryForecast';
import { courseIds } from './medicationCourses';

export const dashboardStockId = '00000000-0000-4000-8000-000000000020';
export function queueItem(
  patch: Partial<MedicationPreparationQueueItem> = {}
): MedicationPreparationQueueItem {
  return {
    stock_id: dashboardStockId,
    medication_id: courseIds.med,
    medication_name: 'Example prepared medication',
    route: 'injection',
    label: 'Example vial',
    label_mass_mg: '10',
    raw_status: 'sealed',
    expiry_date: null,
    expired: false,
    preparation_queue_state: 'a'.repeat(64),
    ...patch,
  };
}
export function dashboardFixture(
  patch: Partial<MedicationInventoryPlannedDashboardResponse> = {}
): MedicationInventoryPlannedDashboardResponse {
  return {
    forecast: inventoryForecastFixture(),
    supply: { state: 'forecast', medication_id: courseIds.med },
    preparation_queue: [queueItem()],
    ...patch,
  };
}
export function dashboardPen(
  patch: Partial<MedicationPen> = {}
): MedicationPen {
  return {
    id: dashboardStockId,
    medication_id: courseIds.med,
    kind: 'vial',
    label: 'Example vial',
    label_mass_mg: '10',
    preparation: null,
    dose_mg: null,
    concentration_mg_ml: null,
    volume_ml: null,
    doses_total: null,
    doses_used: 0,
    status: 'sealed',
    finished_at: null,
    opened_at: null,
    expiry_date: null,
    bud_date: null,
    reorder_flag: false,
    reorder_threshold: null,
    notes: null,
    ...patch,
  };
}
