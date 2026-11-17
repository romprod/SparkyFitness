import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
  assertOwner: vi.fn(),
  build: vi.fn(),
  estimates: vi.fn(),
  vialEstimates: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
vi.mock('../models/medicationPurchaseRepository.js', () => ({
  assertMedicationFinancialOwner: mocks.assertOwner,
}));
vi.mock('@workspace/shared', async (original) => ({
  ...(await original<typeof import('@workspace/shared')>()),
  buildMedicationCostAnalytics: mocks.build,
  buildMedicationPrescriptionCostAnalytics: mocks.estimates,
  buildMedicationVialCostEstimates: mocks.vialEstimates,
}));
import {
  getMedicationCostAnalytics,
  getMedicationPrescriptionVialCosts,
  loadMedicationPrescriptionFinancialSnapshot,
} from '../models/medicationCostAnalyticsRepository.js';
describe('owner cost analytics snapshot projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClient.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.build.mockReturnValue({ rows: [] });
    mocks.estimates.mockReturnValue({
      cost_basis: 'with_prescription_estimates',
      rows: [],
    });
    mocks.vialEstimates.mockReturnValue({
      cost_basis: 'with_prescription_estimates',
      vials: [],
    });
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
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        String(sql).includes('medication_prescriptions')
      )
    ).toBe(false);
    expect(mocks.estimates).not.toHaveBeenCalled();
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
  it('loads only explicit linked financial facts with the supplied client and no clinical text/decryption', async () => {
    const row = {
      id: 'rx',
      medication_id: 'med',
      cost: '0',
      currency: 'GBP',
      date_written: null,
      cost_basis: 'per_vial',
    };
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM medication_prescriptions r') ? [row] : [],
    }));
    const client = { query: mocks.query } as unknown as import('pg').PoolClient;
    expect(
      (await loadMedicationPrescriptionFinancialSnapshot(client, 'owner'))
        .prescriptions
    ).toEqual([row]);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    for (const [sql, parameters] of mocks.query.mock.calls) {
      expect(sql).toMatch(/^SELECT/);
      expect(sql).not.toMatch(
        /encrypted|prescriber|pharmacy|dose_instructions|source|FOR UPDATE/
      );
      expect(parameters).toEqual(['owner']);
    }
    const query = mocks.query.mock.calls.find(([sql]) =>
      sql.includes('FROM medication_prescriptions r')
    )![0];
    expect(query).toContain('p.prescription_id=r.id');
    expect(query).toContain('p.user_id=r.user_id');
    expect(query).toContain('p.medication_id=r.medication_id');
    expect(query).toContain("p.kind='vial'");
  });
  it('keeps all opt-in inputs and projection on one read-only snapshot with an explicit echo', async () => {
    const result = await getMedicationCostAnalytics(
      'owner',
      'all',
      new Date('2026-11-17T12:00Z'),
      'with_prescription_estimates'
    );
    expect(result).toMatchObject({ cost_basis: 'with_prescription_estimates' });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.estimates).toHaveBeenCalledWith(
      expect.objectContaining({ prescriptions: [] })
    );
    expect(mocks.query.mock.calls[0]![0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
    );
    expect(mocks.query).toHaveBeenLastCalledWith('COMMIT');
    expect(mocks.getClient).toHaveBeenCalledOnce();
  });
  it('uses the same canonical resolver wrapper for opt-in vial badges without reading dose/clinical rows', async () => {
    expect(await getMedicationPrescriptionVialCosts('owner')).toEqual({
      cost_basis: 'with_prescription_estimates',
      vials: [],
    });
    expect(mocks.vialEstimates).toHaveBeenCalledWith({
      vials: [],
      invoice_prices: [],
      prescriptions: [],
    });
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        /injection_entries|medication_entries|encrypted/.test(sql)
      )
    ).toBe(false);
    expect(mocks.getClient).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
