import type { PoolClient } from 'pg';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { medicationPrescriptionCreateSchema } from '@workspace/shared';
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
});
