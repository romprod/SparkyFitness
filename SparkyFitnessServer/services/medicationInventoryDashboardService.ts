import {
  medicationInventoryDashboardResponseSchema,
  resolvePreparedMedicationRoute,
  type MedicationInventoryDashboardResponse,
  type MedicationInventoryForecastResponse,
  type MedicationInventorySupply,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import {
  loadInventoryForecastSnapshot,
  type InventoryForecastSnapshot,
} from '../models/medicationInventoryForecastRepository.js';
import { forecastInventorySnapshot } from './medicationInventoryForecastService.js';
import {
  classifyInventoryPreparation,
  inventoryPreparationQueueState,
} from './medicationInventoryDashboardClassification.js';
export function selectInventorySupply(
  forecast: MedicationInventoryForecastResponse
): MedicationInventorySupply {
  const candidates = forecast.medications.filter(
    (row) =>
      row.expected_slots > 0 ||
      row.limitations.includes('unmodelled_legacy_demand')
  );
  const rank = { reorder_now: 0, ok: 1, covered: 2, unknown: 3 };
  candidates.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.reorder_by ?? '9999-12-31').localeCompare(
        b.reorder_by ?? '9999-12-31'
      ) ||
      a.name.localeCompare(b.name) ||
      a.medication_id.localeCompare(b.medication_id)
  );
  const selected = candidates[0];
  if (!selected) return { state: 'no_demand', medication_id: null };
  return {
    state: selected.status === 'unknown' ? 'unavailable' : 'forecast',
    medication_id: selected.medication_id,
  };
}
export function buildInventoryDashboard(
  snapshot: InventoryForecastSnapshot,
  owner: string,
  now: Date
): MedicationInventoryDashboardResponse {
  const forecast = forecastInventorySnapshot(snapshot, now);
  const preparation_queue = snapshot.dashboard_stock
    .filter((row) => classifyInventoryPreparation(row) === 'needs_preparation')
    .sort(
      (a, b) =>
        a.status.localeCompare(b.status) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    )
    .map((row) => ({
      stock_id: row.id,
      medication_id: row.medication_id,
      medication_name: row.name,
      route: resolvePreparedMedicationRoute(row),
      label: row.label,
      label_mass_mg: row.label_mass_mg,
      raw_status: 'sealed',
      expiry_date: row.expiry_date,
      expired: row.expiry_date !== null && row.expiry_date < snapshot.today,
      preparation_queue_state: inventoryPreparationQueueState(row, owner),
    }));
  return medicationInventoryDashboardResponseSchema.parse({
    forecast,
    supply: selectInventorySupply(forecast),
    preparation_queue,
  });
}
export async function getMedicationInventoryDashboard(
  owner: string,
  now = new Date()
): Promise<MedicationInventoryDashboardResponse> {
  const client = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const value = buildInventoryDashboard(
      await loadInventoryForecastSnapshot(client, owner, now),
      owner,
      now
    );
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
