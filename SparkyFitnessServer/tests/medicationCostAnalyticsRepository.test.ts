import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
  assertOwner: vi.fn(),
  build: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
vi.mock('../models/medicationPurchaseRepository.js', () => ({
  assertMedicationFinancialOwner: mocks.assertOwner,
}));
vi.mock('@workspace/shared', async (original) => ({
  ...(await original<typeof import('@workspace/shared')>()),
  buildMedicationCostAnalytics: mocks.build,
}));
import { getMedicationCostAnalytics } from '../models/medicationCostAnalyticsRepository.js';
describe('owner cost analytics snapshot projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.build.mockReturnValue({ rows: [] });
  });
  it('projects exact consumable metadata and closed stock with all lifetime doses under one read-only snapshot', async () => {
    const line = {
      id: 'line',
      purchase_id: 'invoice',
      kind: 'consumable',
      category: 'needle',
      quantity: 2,
      unit_cost: '10',
      units_per_pack: 100,
      units_per_dose: '0.123456789123456789',
      sort_index: 0,
    };
    const vial = {
      id: 'vial',
      medication_id: 'med',
      status: 'discarded',
      label_mass_mg: '10',
      purchase_item_id: 'line',
    };
    const dose = {
      medication_id: 'med',
      pen_id: 'vial',
      entry_date: '2020-01-01',
      dose_mg: '7',
      volume_ml: '0.1',
      dose_input_unit: 'ml',
    };
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM user_preferences')
        ? [{ timezone: 'UTC' }]
        : sql.includes('FROM medications WHERE')
          ? [{ id: 'med', name: 'Synthetic' }]
          : sql.includes('FROM medication_purchases WHERE')
            ? [
                {
                  id: 'invoice',
                  ordered_date: '2020-01-01',
                  currency: 'AUD',
                  allocation_method: 'value',
                },
              ]
            : sql.includes('FROM medication_purchase_items WHERE')
              ? [line]
              : sql.includes('FROM medication_pens p')
                ? [vial]
                : sql.includes('FROM injection_entries WHERE')
                  ? [dose]
                  : [],
    }));
    await getMedicationCostAnalytics(
      'owner',
      '3',
      new Date('2026-11-15T12:00:00Z')
    );
    expect(mocks.assertOwner).toHaveBeenCalledWith('owner');
    expect(mocks.query.mock.calls[0]).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    ]);
    expect(mocks.query.mock.calls.at(-1)).toEqual(['COMMIT']);
    const queries = mocks.query.mock.calls.filter(([sql]) =>
      String(sql).startsWith('SELECT')
    );
    for (const [, parameters] of queries) expect(parameters).toEqual(['owner']);
    expect(
      queries.find(([sql]) =>
        String(sql).includes('FROM medication_purchase_items')
      )?.[0]
    ).toContain('units_per_dose::text');
    const doseSql = queries.find(([sql]) =>
      String(sql).includes('FROM injection_entries')
    )?.[0];
    expect(doseSql).not.toMatch(/entry_date\s*[<>]|BETWEEN|LIMIT/);
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        window: '3',
        invoices: [expect.objectContaining({ lines: [line] })],
        vials: [vial],
        doses: [dose],
      })
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rejects non-owner context before acquiring a database connection', async () => {
    mocks.assertOwner.mockImplementation(() => {
      throw new Error('owner required');
    });
    await expect(getMedicationCostAnalytics('other')).rejects.toThrow(
      'owner required'
    );
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
  it('rolls back failed analytics and releases the snapshot connection', async () => {
    mocks.build.mockImplementation(() => {
      throw new Error('invalid projection');
    });
    await expect(getMedicationCostAnalytics('owner')).rejects.toThrow(
      'invalid projection'
    );
    expect(mocks.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
