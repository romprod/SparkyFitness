import { describe, expect, it } from 'vitest';
import { dashboardStockFixture } from './fixtures/medicationInventoryDashboardFixture.js';
import {
  classifyInventoryPreparation,
  inventoryPreparationQueueState,
} from '../services/medicationInventoryDashboardClassification.js';
describe('authoritative preparation queue classification', () => {
  it('admits genuinely unused sealed injection/nasal vials regardless nominal dose/count, missing label or expired annotation', () => {
    for (const route of ['subcutaneous', 'nasal'])
      expect(
        classifyInventoryPreparation({
          ...dashboardStockFixture(),
          route_id: route,
        })
      ).toBe('needs_preparation');
  });
  it('does not resurrect closed stock or reconstitute prefilled pens and unsupported routes', () => {
    for (const patch of [
      { status: 'finished' },
      { status: 'discarded' },
      { finished_at: '2026-11-16T12:00:00Z' },
      { finished_at: 'infinity' },
      { kind: 'pen' },
      { route_id: 'oral' },
    ])
      expect(
        classifyInventoryPreparation({ ...dashboardStockFixture(), ...patch })
      ).toBe('not_applicable');
  });
  it('preserves current prepared and known legacy physical states without adding to queue', () => {
    expect(
      classifyInventoryPreparation({
        ...dashboardStockFixture(),
        current_preparation_id: 'saved',
      })
    ).toBe('prepared');
    expect(
      classifyInventoryPreparation({
        ...dashboardStockFixture(),
        concentration_mg_ml: '1.000000000000001',
        volume_ml: '2',
      })
    ).toBe('legacy_physical');
  });
  it('excludes any previous use, historical linked actuals and prior preparation audit evidence', () => {
    for (const patch of [{ doses_used: 1 }, { linked_actual_count: '1' }])
      expect(
        classifyInventoryPreparation({ ...dashboardStockFixture(), ...patch })
      ).toBe('used_without_preparation');
    expect(
      classifyInventoryPreparation({
        ...dashboardStockFixture(),
        prior_preparation: true,
      })
    ).toBe('unknown');
  });
  it('does not call ambiguous in-use/opened, explicit zero, invalid or partial physical state unprepared', () => {
    for (const patch of [
      { status: 'in_use' },
      { opened_at: '2026-11-16' },
      { concentration_mg_ml: '0' },
      { volume_ml: '0' },
      { concentration_mg_ml: 'NaN' },
      { concentration_mg_ml: '1' },
      { volume_ml: '2' },
    ])
      expect(
        classifyInventoryPreparation({ ...dashboardStockFixture(), ...patch })
      ).toBe('unknown');
  });
  it('binds a deterministic token to owner, stock identity, route and exact current facts', () => {
    const stock = dashboardStockFixture(),
      token = inventoryPreparationQueueState(stock, 'owner');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(inventoryPreparationQueueState({ ...stock }, 'owner')).toBe(token);
    for (const patch of [
      { id: 'different' },
      { route_id: 'nasal' },
      { linked_actual_count: '1' },
      { current_preparation_id: 'new' },
      { concentration_mg_ml: '0' },
      { updated_at: '2026-11-16T12:00:01Z' },
    ])
      expect(
        inventoryPreparationQueueState({ ...stock, ...patch }, 'owner')
      ).not.toBe(token);
    expect(inventoryPreparationQueueState(stock, 'other')).not.toBe(token);
  });
});
