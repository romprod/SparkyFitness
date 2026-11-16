import {
  normalizePurchaseDecimal,
  resolvePreparedMedicationRoute,
} from '@workspace/shared';
import type { InventoryDashboardStockRow } from '../models/medicationInventoryForecastRepository.js';
import { courseFingerprint } from '../models/medicationCourseRepository.js';
export type InventoryPreparationState =
  | 'needs_preparation'
  | 'prepared'
  | 'legacy_physical'
  | 'used_without_preparation'
  | 'unknown'
  | 'not_applicable';
const positive = (value: string | null) =>
  value !== null &&
  normalizePurchaseDecimal(value) !== null &&
  normalizePurchaseDecimal(value) !== '0';
/** A missing formal preparation is not evidence that a legacy container needs mixing. */
export function classifyInventoryPreparation(
  stock: InventoryDashboardStockRow
): InventoryPreparationState {
  if (
    !['sealed', 'in_use'].includes(stock.status) ||
    stock.finished_at !== null ||
    stock.kind !== 'vial' ||
    !resolvePreparedMedicationRoute(stock)
  )
    return 'not_applicable';
  if (stock.current_preparation_id !== null) return 'prepared';
  if (stock.linked_actual_count !== '0' || stock.doses_used !== 0)
    return 'used_without_preparation';
  if (positive(stock.concentration_mg_ml) && positive(stock.volume_ml))
    return 'legacy_physical';
  if (
    stock.prior_preparation ||
    stock.status !== 'sealed' ||
    stock.opened_at !== null ||
    stock.concentration_mg_ml !== null ||
    stock.volume_ml !== null
  )
    return 'unknown';
  // Nominal dose/count and label metadata are not physical mixing evidence.
  return 'needs_preparation';
}
export function inventoryPreparationQueueState(
  stock: InventoryDashboardStockRow,
  owner: string
): string {
  return courseFingerprint({
    purpose: 'inventory-preparation-queue',
    owner,
    stock,
  });
}
