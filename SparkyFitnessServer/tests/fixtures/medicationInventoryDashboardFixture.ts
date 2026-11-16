import type { InventoryDashboardStockRow } from '../../models/medicationInventoryForecastRepository.js';
export function dashboardStockFixture(): InventoryDashboardStockRow {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    medication_id: '00000000-0000-4000-a000-000000000002',
    name: 'Synthetic peptide',
    type_id: 'injection',
    route_id: 'subcutaneous',
    kind: 'vial',
    label: null,
    label_mass_mg: null,
    dose_mg: '1',
    doses_total: 10,
    status: 'sealed',
    finished_at: null,
    opened_at: null,
    expiry_date: '2020-01-01',
    bud_date: null,
    doses_used: 0,
    concentration_mg_ml: null,
    volume_ml: null,
    current_preparation_id: null,
    prior_preparation: false,
    linked_actual_count: '0',
    updated_at: '2026-11-16T12:00:00Z',
    created_at: '2026-11-16T12:00:00Z',
  };
}
