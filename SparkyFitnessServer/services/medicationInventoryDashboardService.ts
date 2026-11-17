import {
  medicationInventoryDashboardResponseSchema,
  medicationInventoryPlannedDashboardResponseSchema,
  type MedicationInventoryPlannedDashboardResponse,
  resolvePreparedMedicationRoute,
  type MedicationInventoryDashboardResponse,
  type MedicationInventoryPlannedForecast,
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
export function selectInventorySupply(forecast: {
  medications: ReadonlyArray<
    Pick<
      MedicationInventoryPlannedForecast,
      | 'medication_id'
      | 'expected_slots'
      | 'limitations'
      | 'status'
      | 'reorder_by'
      | 'name'
    >
  >;
}): MedicationInventorySupply {
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
  now: Date,
  mode?: 'committed'
): MedicationInventoryDashboardResponse;
export function buildInventoryDashboard(
  snapshot: InventoryForecastSnapshot,
  owner: string,
  now: Date,
  mode: 'planned_cycles'
): MedicationInventoryPlannedDashboardResponse;
export function buildInventoryDashboard(
  snapshot: InventoryForecastSnapshot,
  owner: string,
  now: Date,
  mode: 'committed' | 'planned_cycles'
):
  | MedicationInventoryDashboardResponse
  | MedicationInventoryPlannedDashboardResponse;
export function buildInventoryDashboard(
  snapshot: InventoryForecastSnapshot,
  owner: string,
  now: Date,
  mode: 'committed' | 'planned_cycles' = 'committed'
):
  | MedicationInventoryDashboardResponse
  | MedicationInventoryPlannedDashboardResponse {
  const forecast =
    mode === 'planned_cycles'
      ? forecastInventorySnapshot(snapshot, now, 'planned_cycles')
      : forecastInventorySnapshot(snapshot, now);
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
  const response = {
    forecast,
    supply: selectInventorySupply(forecast),
    preparation_queue,
  };
  return mode === 'planned_cycles'
    ? medicationInventoryPlannedDashboardResponseSchema.parse(response)
    : medicationInventoryDashboardResponseSchema.parse(response);
}
export function getMedicationInventoryDashboard(
  owner: string,
  now?: Date,
  mode?: 'committed'
): Promise<MedicationInventoryDashboardResponse>;
export function getMedicationInventoryDashboard(
  owner: string,
  now: Date | undefined,
  mode: 'planned_cycles'
): Promise<MedicationInventoryPlannedDashboardResponse>;
export function getMedicationInventoryDashboard(
  owner: string,
  now: Date | undefined,
  mode: 'committed' | 'planned_cycles'
): Promise<
  | MedicationInventoryDashboardResponse
  | MedicationInventoryPlannedDashboardResponse
>;
export async function getMedicationInventoryDashboard(
  owner: string,
  now = new Date(),
  mode: 'committed' | 'planned_cycles' = 'committed'
): Promise<
  | MedicationInventoryDashboardResponse
  | MedicationInventoryPlannedDashboardResponse
> {
  const client = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const value = buildInventoryDashboard(
      await loadInventoryForecastSnapshot(client, owner, now),
      owner,
      now,
      mode
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
