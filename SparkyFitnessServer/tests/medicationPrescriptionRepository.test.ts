import type { PoolClient } from 'pg';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  medicationPrescriptionCreateSchema,
  medicationPrescriptionCreateSchemaV2,
} from '@workspace/shared';
const mocks = vi.hoisted(() => ({
  actor: 'owner',
  query: vi.fn(),
  getClient: vi.fn(),
  release: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: mocks.getClient,
  dbContextStorage: { getStore: () => ({ authenticatedUserId: mocks.actor }) },
}));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'synthetic',
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));
import {
  createMedicationPrescription,
  updateMedicationPrescription,
  deleteMedicationPrescription,
  listMedicationPrescriptions,
  validatePrescriptionLink,
  publicCoursePrescriptionEnvelope,
} from '../models/medicationPrescriptionRepository.js';
import { publicCourseReviewPlan } from '../services/medicationCourseService.js';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.js';
const owner = 'owner',
  id = '00000000-0000-4000-a000-000000000001',
  med = '00000000-0000-4000-a000-000000000002',
  op = '00000000-0000-4000-a000-000000000003';
const client = {
  query: mocks.query,
  release: mocks.release,
} as unknown as PoolClient;
describe('private manual prescription transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = owner;
    mocks.getClient.mockResolvedValue(client);
    mocks.encrypt.mockImplementation(async (value: string) => ({
      encryptedText: 'encrypted:' + value,
      iv: 'syntheticiv',
      tag: 'synthetictag',
    }));
    mocks.decrypt.mockResolvedValue('decrypted synthetic');
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT id FROM medications')
        ? [{ id: med }]
        : sql.startsWith('SELECT COALESCE')
          ? [{ name: 'Synthetic name' }]
          : sql.includes('SELECT medication_id,version')
            ? [
                {
                  medication_id: med,
                  version: 1,
                  cost: null,
                  currency: 'AUD',
                  cost_basis: null,
                },
              ]
            : [],
    }));
  });
  it('encrypts all private free text, preserves manual zeros and writes only Rx/receipt facts', async () => {
    const result = await createMedicationPrescription(owner, {
      ...medicationPrescriptionCreateSchema.parse({
        operation_id: op,
        medication_id: med,
        currency: 'GBP',
        source: 'Synthetic source',
        prescriber: 'Synthetic prescriber',
        pharmacy: 'Synthetic pharmacy',
        dose_instructions: 'Synthetic instructions',
        cost: '0',
        quantity: 0,
        refills_authorized: 0,
        refills_remaining: 0,
        lead_time_days: 0,
      }),
    });
    expect(result).toMatchObject({ version: 1, deleted: false });
    expect(mocks.encrypt).toHaveBeenCalledTimes(4);
    const insert = mocks.query.mock.calls.find((c) =>
      c[0].startsWith('INSERT INTO medication_prescriptions(')
    )!;
    expect(insert[1]).toContain('0');
    expect(insert[1]).toContain('GBP');
    expect(insert[1]).not.toContain('AUD');
    expect(insert[1].filter((v: unknown) => v === 0)).toHaveLength(4);
    expect(insert[0]).not.toContain('medication_entries');
    expect(mocks.query).toHaveBeenLastCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('refuses to create without a currency instead of inventing one', async () => {
    await expect(
      createMedicationPrescription(owner, {
        operation_id: op,
        medication_id: med,
      } as never)
    ).rejects.toThrow('Currency is required.');
    expect(
      mocks.query.mock.calls.some((c) => c[0].startsWith('INSERT INTO'))
    ).toBe(false);
  });
  it('replays the exact original create result without inserting or resurrecting records', async () => {
    const data = medicationPrescriptionCreateSchema.parse({
      operation_id: op,
      medication_id: med,
      currency: 'GBP',
    });
    const prior = { id, version: 1, deleted: false };
    const hash = createHash('sha256')
      .update(JSON.stringify({ action: 'create', data }))
      .digest('hex');
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT request_hash,result')
        ? [{ request_hash: hash, result: prior }]
        : [],
    }));
    expect(await createMedicationPrescription(owner, data)).toEqual(prior);
    expect(mocks.query.mock.calls.some((c) => c[0].startsWith('INSERT'))).toBe(
      false
    );
  });
  it('rejects reused operation payload and rolls back before business writes', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT request_hash,result')
        ? [
            {
              request_hash: 'different',
              result: { id, version: 1, deleted: false },
            },
          ]
        : [],
    }));
    await expect(
      createMedicationPrescription(
        owner,
        medicationPrescriptionCreateSchema.parse({
          operation_id: op,
          medication_id: med,
          currency: 'GBP',
        })
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('rejects stale update and immutable medication retarget without mutation', async () => {
    await expect(
      updateMedicationPrescription(owner, id, {
        operation_id: op,
        expected_version: 2,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      updateMedicationPrescription(owner, id, {
        operation_id: op,
        expected_version: 1,
        medication_id: null,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.query.mock.calls.some((c) => c[0].startsWith('UPDATE'))).toBe(
      false
    );
  });
  it('omitted update fields do not overwrite stored status/currency/text/counters', async () => {
    await updateMedicationPrescription(owner, id, {
      operation_id: op,
      expected_version: 1,
      refills_remaining: 0,
    });
    const sql = mocks.query.mock.calls.find((c) =>
      c[0].startsWith('UPDATE medication_prescriptions')
    )![0];
    expect(sql).toContain('refills_remaining=');
    expect(sql).not.toMatch(
      /status=|currency=|source_encrypted=|refills_authorized=/
    );
  });
  it('locks child courses/revisions and pens before the Rx row and deletes only Rx', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT DISTINCT c.id')
        ? [{ id: 'course' }]
        : sql.includes('SELECT medication_id,version')
          ? [
              {
                medication_id: med,
                version: 1,
                cost: null,
                currency: 'AUD',
                cost_basis: null,
              },
            ]
          : sql.startsWith('SELECT id FROM medications')
            ? [{ id: med }]
            : [],
    }));
    await deleteMedicationPrescription(owner, id, {
      operation_id: op,
      expected_version: 1,
    });
    const sql = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(
      sql.findIndex((s) => s.includes('FROM medication_pens'))
    ).toBeLessThan(
      sql.findIndex(
        (s) =>
          s.includes('FROM medication_prescriptions') &&
          s.includes('FOR UPDATE')
      )
    );
    expect(sql.filter((s) => s.startsWith('DELETE'))).toEqual([
      'DELETE FROM medication_prescriptions WHERE user_id=$1 AND id=$2',
    ]);
  });
  it('rejects delegates and foreign profile assertions before acquiring a client', async () => {
    mocks.actor = 'delegate';
    await expect(listMedicationPrescriptions(owner)).rejects.toMatchObject({
      statusCode: 403,
    });
    mocks.actor = owner;
    await expect(
      listMedicationPrescriptions(owner, 'foreign')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
  it('preserves omitted private links for delegates but rejects even explicit null or unchanged echoes', async () => {
    mocks.actor = 'delegate';
    expect(await validatePrescriptionLink(client, owner, med, {}, id)).toBe(id);
    expect(mocks.query).not.toHaveBeenCalled();
    await expect(
      validatePrescriptionLink(
        client,
        owner,
        med,
        { prescription_id: null },
        id
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      validatePrescriptionLink(client, owner, med, { prescription_id: id }, id)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('validates explicit owner link with exact owner/med and allows explicit unlink', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id }] });
    expect(
      await validatePrescriptionLink(client, owner, med, {
        prescription_id: id,
      })
    ).toBe(id);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('medication_id=$3 FOR KEY SHARE'),
      [id, owner, med]
    );
    expect(
      await validatePrescriptionLink(
        client,
        owner,
        med,
        { prescription_id: null },
        id
      )
    ).toBeNull();
  });
  it('redacts only declared delegated bindings and leaves unrelated custom data unchanged', () => {
    mocks.actor = 'delegate';
    const value = {
      course: { revisions: [{ id: 'r', prescription_id: id }] },
      plan: { name: 'plan', prescription_id: id },
      custom_fields: { prescription_id: 'unrelated' },
    };
    expect(publicCoursePrescriptionEnvelope(value, owner)).toEqual({
      course: { revisions: [{ id: 'r' }] },
      plan: { name: 'plan' },
      custom_fields: { prescription_id: 'unrelated' },
    });
    expect(value.course.revisions[0]!.prescription_id).toBe(id);
  });
  it('keeps ordinary unbound Review.plan compatible with old strict clients', () => {
    const course = medicationCourseFixture();
    const revision = course.revisions[0]!;
    const plan = {
      name: revision.name,
      start_date: revision.start_date,
      dose_unit: revision.dose_unit,
      dose_basis: revision.dose_basis,
      rules: [],
      steps: [],
      prescription_id: null,
    };
    const result = publicCourseReviewPlan(plan, {
      ...plan,
      prescription_id: undefined,
    });
    expect(Object.hasOwn(result, 'prescription_id')).toBe(false);
    expect(plan.prescription_id).toBeNull();
  });
  it.each([null, 'per_vial'] as const)(
    'omits nullable basis from old-compatible public rows, exposes only confirmed marker %s',
    async (basis) => {
      mocks.query.mockResolvedValue({
        rows: [
          {
            id,
            medication_id: med,
            user_id: owner,
            medication_name: 'Synthetic',
            cost_basis: basis,
            cost: '5',
            currency: 'AUD',
            created_at: '2026-11-17T12:00Z',
            updated_at: '2026-11-17T12:00Z',
            source_encrypted: null,
            prescriber_encrypted: null,
            pharmacy_encrypted: null,
            dose_instructions_encrypted: null,
          },
        ],
      });
      const rows = await listMedicationPrescriptions(owner);
      expect(Object.hasOwn(rows[0]!, 'cost_basis')).toBe(basis !== null);
      if (basis !== null) expect(rows[0]?.cost_basis).toBe('per_vial');
      expect(rows[0]).not.toHaveProperty('source_encrypted');
    }
  );
  it('retains cost confirmation intent in operation receipts instead of treating it as an unrelated retry', async () => {
    let saved: { request_hash: string; result: unknown } | null = null;
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('SELECT request_hash,result'))
        return { rows: saved ? [saved] : [] };
      if (sql.startsWith('INSERT INTO medication_prescription_operations')) {
        saved = {
          request_hash: values![2] as string,
          result: JSON.parse(values![3] as string),
        };
        return { rows: [] };
      }
      return original(sql);
    });
    const legacy = medicationPrescriptionCreateSchema.parse({
      operation_id: op,
      medication_id: med,
      currency: 'GBP',
      cost: '5',
    });
    const result = await createMedicationPrescription(owner, legacy);
    expect(await createMedicationPrescription(owner, legacy)).toEqual(result);
    await expect(
      createMedicationPrescription(owner, { ...legacy, cost_basis: 'per_vial' })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      mocks.query.mock.calls.filter(([sql]) =>
        sql.startsWith('INSERT INTO medication_prescriptions(')
      )
    ).toHaveLength(1);
  });
  describe('prescriptions that cover several medicines', () => {
    const second = '00000000-0000-4000-a000-000000000009';
    const rowsFor = (
      sql: string,
      coverage: Array<{
        id: string;
        medication_id: string | null;
        position: number;
      }>,
      basis: 'per_vial' | null = null
    ) =>
      sql.includes('FROM medication_prescription_medications')
        ? coverage
        : sql.includes('SELECT medication_id,version')
          ? [
              {
                medication_id: med,
                version: 1,
                cost: '5',
                currency: 'AUD',
                cost_basis: basis,
              },
            ]
          : sql.startsWith('SELECT id FROM medications')
            ? coverage.flatMap((row) =>
                row.medication_id ? [{ id: row.medication_id }] : []
              )
            : sql.startsWith('SELECT id,COALESCE')
              ? [
                  { id: med, name: 'Synthetic one' },
                  { id: second, name: 'Synthetic two' },
                ]
              : [];
    it('locks the covered medicines in id order and writes the primary, then one coverage row per medicine', async () => {
      const ids = [second, med];
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: rowsFor(sql, []).length
          ? rowsFor(sql, [])
          : sql.startsWith('SELECT id FROM medications')
            ? ids.map((i) => ({ id: i }))
            : rowsFor(sql, []),
      }));
      await createMedicationPrescription(
        owner,
        medicationPrescriptionCreateSchemaV2.parse({
          operation_id: op,
          medication_ids: ids,
          currency: 'GBP',
        })
      );
      const lock = mocks.query.mock.calls.find((c) =>
        c[0].startsWith('SELECT id FROM medications')
      )!;
      expect(lock[0]).toContain('ORDER BY id FOR UPDATE');
      expect(lock[1][1]).toEqual([...ids].sort());
      const insert = mocks.query.mock.calls.find((c) =>
        c[0].startsWith('INSERT INTO medication_prescriptions(')
      )!;
      expect(insert[1][2]).toBe(second);
      const covered = mocks.query.mock.calls.filter((c) =>
        c[0].startsWith('INSERT INTO medication_prescription_medications')
      );
      expect(covered.map((c) => [c[1][2], c[1][4]])).toEqual([
        [second, 0],
        [med, 1],
      ]);
    });
    it('refuses a per-vial price on several medicines before writing anything', async () => {
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: rowsFor(sql, []).length
          ? []
          : sql.startsWith('SELECT id FROM medications')
            ? [{ id: med }, { id: second }]
            : rowsFor(sql, []),
      }));
      await expect(
        createMedicationPrescription(
          owner,
          medicationPrescriptionCreateSchemaV2.parse({
            operation_id: op,
            medication_ids: [med, second],
            currency: 'GBP',
            cost: '5',
            cost_basis: 'per_vial',
          })
        )
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'cost_basis_per_vial_needs_one_medication',
      });
      expect(
        mocks.query.mock.calls.some((c) =>
          c[0].startsWith('INSERT INTO medication_prescription')
        )
      ).toBe(false);
    });
    it('refuses to add a medicine to a confirmed per-vial price unless the same save clears the basis', async () => {
      const coverage = [{ id: 'row1', medication_id: med, position: 0 }];
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: sql.startsWith('SELECT id FROM medications')
          ? [{ id: med }, { id: second }]
          : rowsFor(sql, coverage, 'per_vial'),
      }));
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: op,
          expected_version: 1,
          medication_ids: [med, second],
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: '00000000-0000-4000-a000-0000000000aa',
          expected_version: 1,
          medication_ids: [med, second],
          cost_basis: null,
        })
      ).resolves.toMatchObject({ version: 2 });
    });
    it('refuses a removal that stock or a plan still links and names the counts', async () => {
      const coverage = [
        { id: 'row1', medication_id: med, position: 0 },
        { id: 'row2', medication_id: second, position: 1 },
      ];
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes('AS pens,')
          ? [{ pens: 2, plans: 1 }]
          : sql.startsWith('SELECT id FROM medications')
            ? [{ id: med }, { id: second }]
            : sql.startsWith('SELECT id,COALESCE')
              ? [{ id: second, name: 'Synthetic two' }]
              : rowsFor(sql, coverage),
      }));
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: op,
          expected_version: 1,
          medication_ids: [med],
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'prescription_medication_linked',
        message: expect.stringContaining('2 stock items and 1 plan revision'),
      });
      expect(
        mocks.query.mock.calls.some((c) => c[0].startsWith('DELETE'))
      ).toBe(false);
    });
    it('detects a coverage change between the first read and the lock', async () => {
      let reads = 0;
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM medication_prescription_medications'))
          return {
            rows: [{ id: 'row' + ++reads, medication_id: med, position: 0 }],
          };
        return {
          rows: rowsFor(sql, [{ id: 'row', medication_id: med, position: 0 }]),
        };
      });
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: op,
          expected_version: 1,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('echoes only the current primary as medication_id and never changes it', async () => {
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: rowsFor(sql, [{ id: 'row1', medication_id: med, position: 0 }]),
      }));
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: op,
          expected_version: 1,
          medication_id: second,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      await expect(
        updateMedicationPrescription(owner, id, {
          operation_id: '00000000-0000-4000-a000-0000000000ab',
          expected_version: 1,
          medication_id: med,
        })
      ).resolves.toMatchObject({ version: 2 });
    });
    it('replays a receipt hashed over a legacy single-medicine body', async () => {
      const body = {
        operation_id: op,
        medication_id: med,
        currency: 'GBP',
        cost: '1',
      };
      const legacyHash = createHash('sha256')
        .update(
          JSON.stringify({
            action: 'create',
            data: medicationPrescriptionCreateSchema.parse(body),
          })
        )
        .digest('hex');
      const prior = { id, version: 1, deleted: false };
      mocks.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes('SELECT request_hash,result')
          ? [{ request_hash: legacyHash, result: prior }]
          : [],
      }));
      expect(
        await createMedicationPrescription(
          owner,
          medicationPrescriptionCreateSchemaV2.parse(body)
        )
      ).toEqual(prior);
    });
    it('titles several medicines by their joined names and shows the coverage only to model 2', async () => {
      const row = {
        id,
        medication_id: med,
        user_id: owner,
        medication_name: 'Synthetic one',
        cost_basis: null,
        cost: '5',
        currency: 'AUD',
        created_at: '2026-11-17T12:00Z',
        updated_at: '2026-11-17T12:00Z',
        source_encrypted: null,
        prescriber_encrypted: null,
        pharmacy_encrypted: null,
        dose_instructions_encrypted: null,
        medications: [
          { medication_id: med, medication_name: 'Synthetic one' },
          { medication_id: null, medication_name: 'Synthetic gone' },
        ],
      };
      mocks.query.mockResolvedValue({ rows: [row] });
      const one = (await listMedicationPrescriptions(owner))[0]!;
      expect(one.medication_name).toBe('Synthetic one + Synthetic gone');
      expect(one).not.toHaveProperty('medications');
      const two = (await listMedicationPrescriptions(owner, undefined, 2))[0]!;
      expect(two).toMatchObject({
        medications: [
          { medication_id: med, medication_name: 'Synthetic one', position: 0 },
          {
            medication_id: null,
            medication_name: 'Synthetic gone',
            position: 1,
          },
        ],
      });
    });
    it('links a prescription only through a coverage row it holds for the medication', async () => {
      mocks.query.mockResolvedValue({ rows: [{ id }] });
      await validatePrescriptionLink(client, owner, second, {
        prescription_id: id,
      });
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining('medication_prescription_medications j'),
        [id, owner, second]
      );
      mocks.query.mockResolvedValue({ rows: [] });
      await expect(
        validatePrescriptionLink(client, owner, second, { prescription_id: id })
      ).rejects.toMatchObject({ statusCode: 422 });
    });
  });
});
