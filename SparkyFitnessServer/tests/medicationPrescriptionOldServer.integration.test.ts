import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { medicationPrescriptionCreateSchema } from '@workspace/shared';
import { endPool, getClient } from '../db/poolManager.js';
import * as current from '../models/medicationPrescriptionRepository.js';
import * as medications from '../models/medicationRepository.js';
import * as legacy from './fixtures/legacy/medicationPrescriptionRepository.legacy.js';
import { prescriptionCoverageHarness } from './fixtures/prescriptionCoverageHarness.js';

// An older server (the frozen pre-change repository) running on the migrated schema must keep working.
describe.runIf(
  process.env.MEDICATION_PRESCRIPTION_COVERAGE_INTEGRATION === '1'
)('older server on the prescription coverage schema PostgreSQL', () => {
  const h = prescriptionCoverageHarness('old-server');
  const { owner, admin, actor, medication, create, stock, coverage, mirror } =
    h;
  beforeAll(h.setup);
  afterAll(async () => {
    await h.teardown();
    await endPool();
  });
  const legacyInput = (
    medication_id: string,
    patch: Record<string, unknown> = {}
  ) =>
    medicationPrescriptionCreateSchema.parse({
      medication_id,
      operation_id: randomUUID(),
      currency: 'AUD',
      ...patch,
    });
  const legacyCreate = (medication_id: string, patch = {}) =>
    actor(owner, () =>
      legacy.createMedicationPrescription(
        owner,
        legacyInput(medication_id, patch)
      )
    );
  // What the older server runs to link stock: its own primary-only validation, then the write.
  const legacyLink = (medicationId: string, prescriptionId: string) =>
    actor(owner, async () => {
      const c = await getClient(owner);
      try {
        await c.query('BEGIN');
        const bound = await legacy.validatePrescriptionLink(
          c,
          owner,
          medicationId,
          { prescription_id: prescriptionId }
        );
        await c.query('ROLLBACK');
        return bound;
      } finally {
        c.release();
      }
    });

  it('creates through the old insert and gets its coverage row from the deferred repair trigger', async () => {
    const a = await medication('Synthetic Legacy A');
    const made = await legacyCreate(a, { cost: '4' });
    expect(await coverage(made.id)).toMatchObject([
      { medication_id: a, medication_name_snapshot: 'Synthetic Legacy A' },
    ]);
    expect(await mirror(made.id)).toBe(a);
    expect(await h.read(made.id)).toMatchObject({
      medication_id: a,
      medications: [
        {
          medication_id: a,
          medication_name: 'Synthetic Legacy A',
          position: 0,
        },
      ],
    });
  });
  it('reads, updates and deletes a multi-medicine prescription as if it covered only its primary', async () => {
    const a = await medication('Synthetic Legacy Primary'),
      b = await medication('Synthetic Legacy Second'),
      made = await create([a, b], { cost: '8' });
    expect(
      await actor(owner, () => legacy.listMedicationPrescriptions(owner)).then(
        (rows) => rows.find((row) => row.id === made.id)
      )
    ).toMatchObject({
      medication_id: a,
      medication_name: 'Synthetic Legacy Primary',
    });
    await actor(owner, () =>
      legacy.updateMedicationPrescription(owner, made.id, {
        operation_id: randomUUID(),
        expected_version: 1,
        refills_remaining: 4,
      })
    );
    expect((await coverage(made.id)).length).toBe(2);
    expect(await mirror(made.id)).toBe(a);
    await actor(owner, () =>
      legacy.deleteMedicationPrescription(owner, made.id, {
        operation_id: randomUUID(),
        expected_version: 2,
      })
    );
    expect(await coverage(made.id)).toEqual([]);
  });
  it('links only the primary medicine and fails closed for the others, and the database agrees with the new rule', async () => {
    const a = await medication(),
      b = await medication(),
      made = await create([a, b]);
    expect(await legacyLink(a, made.id)).toBe(made.id);
    await expect(legacyLink(b, made.id)).rejects.toMatchObject({
      statusCode: 422,
    });
    // The new rule links the second medicine; the database accepts it for the new server only.
    expect(await stock(b, made.id)).toBeDefined();
  });
  it('keeps the mirror moving when a medicine is deleted, as the old column promised', async () => {
    const a = await medication('Synthetic Gone'),
      b = await medication('Synthetic Stays'),
      made = await create([a, b]);
    await medications.deleteMedication(owner, a);
    expect(await mirror(made.id)).toBe(b);
    expect(
      (
        await actor(owner, () =>
          legacy.getMedicationPrescription(owner, made.id)
        )
      ).medication_name
    ).toBe('Synthetic Stays');
    await medications.deleteMedication(owner, b);
    expect(await mirror(made.id)).toBeNull();
    expect(
      await actor(owner, () => legacy.getMedicationPrescription(owner, made.id))
    ).toMatchObject({ medication_id: null });
  });
  it('prices only the primary on the old financial snapshot, an undercount and never an overcount', async () => {
    const a = await medication(),
      b = await medication(),
      made = await create([a, b], { cost: '10' });
    await stock(a, made.id);
    await stock(b, made.id);
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            "SELECT DISTINCT r.id,r.medication_id,r.cost::text,r.currency,r.date_written::text,r.cost_basis FROM medication_prescriptions r JOIN medication_pens p ON p.prescription_id=r.id AND p.user_id=r.user_id AND p.medication_id=r.medication_id WHERE p.user_id=$1 AND p.kind='vial' AND r.id=$2 ORDER BY r.id",
            [owner, made.id]
          )
        ).rows
    );
    expect(rows).toHaveLength(1);
    const pairs = await admin(
      async (c) =>
        (
          await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM medication_prescriptions r JOIN medication_pens p ON p.prescription_id=r.id AND p.user_id=r.user_id AND p.medication_id=r.medication_id WHERE r.id=$1',
            [made.id]
          )
        ).rows[0]!.n
    );
    expect(pairs).toBe(1);
  });
  it('replays an operation recorded by the old server through the new server', async () => {
    const a = await medication();
    const request = legacyInput(a, { cost: '3' });
    const first = await actor(owner, () =>
      legacy.createMedicationPrescription(owner, request)
    );
    expect(await current.createMedicationPrescription(owner, request)).toEqual(
      first
    );
    const patch = {
      operation_id: randomUUID(),
      expected_version: 1,
      pharmacy: 'Synthetic pharmacy',
    };
    const saved = await actor(owner, () =>
      legacy.updateMedicationPrescription(owner, first.id, patch)
    );
    expect(
      await current.updateMedicationPrescription(owner, first.id, patch)
    ).toEqual(saved);
  });
});
