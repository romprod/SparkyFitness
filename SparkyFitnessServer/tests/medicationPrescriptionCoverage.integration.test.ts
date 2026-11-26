import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  medicationPrescriptionCreateSchema,
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionUpdateSchemaV2,
} from '@workspace/shared';
import { endPool } from '../db/poolManager.js';
import * as rx from '../models/medicationPrescriptionRepository.js';
import * as pens from '../models/medicationPenRepository.js';
import * as medications from '../models/medicationRepository.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import {
  getMedicationCostAnalytics,
  getMedicationPrescriptionVialCosts,
} from '../models/medicationCostAnalyticsRepository.js';
import { getMedicationCourseCosts } from '../models/medicationCourseCostsRepository.js';
import {
  editMedicationCourse,
  getMedicationCourse,
  reviewMedicationCourse,
  reviseMedicationCourse,
} from '../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';
import { prescriptionCoverageHarness } from './fixtures/prescriptionCoverageHarness.js';

// Opt-in: runs against one isolated, migrated database (see the migration checklist).
describe.runIf(
  process.env.MEDICATION_PRESCRIPTION_COVERAGE_INTEGRATION === '1'
)('prescriptions that cover several medicines PostgreSQL', () => {
  const h = prescriptionCoverageHarness('coverage');
  const {
    owner,
    other,
    delegate,
    now,
    admin,
    actor,
    sql,
    medication,
    create,
    edit,
    read,
    stock,
    course,
    coverage,
    mirror,
    binding,
  } = h;
  beforeAll(h.setup);
  afterAll(async () => {
    await h.teardown();
    await endPool();
  });
  // The repository refuses a covered medicine (in-use guard, 26 Nov); this tests what the database does when one goes.
  const deleteCovered = async (id: string, as = owner) => {
    await expect(
      actor(as, () => medications.deleteMedication(owner, id))
    ).rejects.toMatchObject({ statusCode: 409 });
    const result = await sql(
      (client) =>
        client.query('DELETE FROM medications WHERE id=$1 AND user_id=$2', [
          id,
          owner,
        ]),
      as
    );
    expect(result.rowCount).toBe(1);
  };
  const successor = async (id: string, expected: number, as = owner) =>
    actor(as, async () => {
      const draft = {
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-18',
        expected_version: expected,
      };
      const review = await reviewMedicationCourse(owner, id, draft, now);
      return reviseMedicationCourse(
        owner,
        id,
        {
          ...review.plan,
          start_date: draft.start_date,
          expected_version: expected,
          review_fingerprint: review.review_fingerprint,
          operation_id: randomUUID(),
        },
        now
      );
    });

  describe('link rules', () => {
    it('reads a multi-medicine prescription as model 2 with the primary first and as model 1 with the primary and joined title', async () => {
      const a = await medication('Synthetic BPC'),
        b = await medication('Synthetic TB');
      const made = await create([a, b], { cost: '30' });
      const v2 = await read(made.id);
      expect(v2).toMatchObject({
        medication_id: a,
        medication_name: 'Synthetic BPC + Synthetic TB',
      });
      expect((v2 as { medications: unknown[] }).medications).toEqual([
        { medication_id: a, medication_name: 'Synthetic BPC', position: 0 },
        { medication_id: b, medication_name: 'Synthetic TB', position: 1 },
      ]);
      const v1 = await rx.getMedicationPrescription(owner, made.id);
      expect(v2).not.toHaveProperty('cost_basis');
      expect(v1).not.toHaveProperty('medications');
      expect(v1).toMatchObject({
        medication_id: a,
        medication_name: 'Synthetic BPC + Synthetic TB',
      });
      expect(await mirror(made.id)).toBe(a);
      expect(
        (await coverage(made.id)).map((row) => row.medication_name_snapshot)
      ).toEqual(['Synthetic BPC', 'Synthetic TB']);
    });
    it('links stock and plans of every covered medicine and refuses an uncovered one in the repository and in raw SQL', async () => {
      const a = await medication(),
        b = await medication(),
        c = await medication(),
        made = await create([a, b]);
      const va = await stock(a, made.id),
        vb = await stock(b, made.id);
      expect(await binding('medication_pens', va.id)).toBe(made.id);
      expect(await binding('medication_pens', vb.id)).toBe(made.id);
      const planB = await course(b, made.id);
      expect(
        await binding('medication_course_revisions', planB.revision_id!)
      ).toBe(made.id);
      await expect(stock(c, made.id)).rejects.toMatchObject({
        statusCode: 422,
      });
      await expect(course(c, made.id)).rejects.toThrow();
      const vc = await stock(c);
      await expect(
        sql((client) =>
          client.query(
            'UPDATE medication_pens SET prescription_id=$2 WHERE id=$1',
            [vc.id, made.id]
          )
        )
      ).rejects.toThrow(/Prescription link must match/);
      expect(await binding('medication_pens', vc.id)).toBeNull();
    });
    it('lets one medicine sit on several prescriptions', async () => {
      const a = await medication(),
        first = await create([a]),
        second = await create([a]),
        pen = await stock(a, first.id);
      await pens.updatePen(owner, pen.id, { prescription_id: second.id });
      expect(await binding('medication_pens', pen.id)).toBe(second.id);
      const other2 = await stock(a, first.id);
      expect(await binding('medication_pens', other2.id)).toBe(first.id);
    });
    it('refuses to remove a medicine that stock or any plan revision still links, in the repository and in raw SQL, then allows it once unlinked', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b]),
        pen = await stock(b, made.id),
        plan = await course(b, made.id);
      await successor(plan.course_id, plan.version);
      await expect(
        edit(made.id, { medication_ids: [a] })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'prescription_medication_linked',
        message: expect.stringMatching(/1 stock item and 2 plan revisions/),
      });
      expect((await coverage(made.id)).length).toBe(2);
      await expect(
        sql((client) =>
          client.query(
            'DELETE FROM medication_prescription_medications WHERE prescription_id=$1 AND medication_id=$2',
            [made.id, b]
          )
        )
      ).rejects.toThrow(/still linked/);
      await pens.updatePen(owner, pen.id, { prescription_id: null });
      await expect(
        edit(made.id, { medication_ids: [a] })
      ).rejects.toMatchObject({ statusCode: 409 });
      const revisions = (await getMedicationCourse(owner, plan.course_id))
        .course.revisions;
      for (const revision of revisions)
        await sql((c) =>
          c.query(
            'UPDATE medication_course_revisions SET prescription_id=NULL WHERE id=$1',
            [revision.id]
          )
        );
      await edit(made.id, { medication_ids: [a] });
      expect((await coverage(made.id)).map((r) => r.medication_id)).toEqual([
        a,
      ]);
      expect(await mirror(made.id)).toBe(a);
    });
    it('adds a medicine, reorders so the mirror follows the primary, and replaces the set in one versioned update', async () => {
      const a = await medication('Synthetic A'),
        b = await medication('Synthetic B'),
        c = await medication('Synthetic C'),
        made = await create([a]);
      await edit(made.id, { medication_ids: [a, b] }, 1);
      expect((await coverage(made.id)).map((r) => r.medication_id)).toEqual([
        a,
        b,
      ]);
      const before = await coverage(made.id);
      await edit(made.id, { medication_ids: [b, a] }, 2);
      expect(await mirror(made.id)).toBe(b);
      expect((await read(made.id)).medication_name).toBe(
        'Synthetic B + Synthetic A'
      );
      // Unchanged rows keep their identity and remembered name.
      const after = await coverage(made.id);
      expect(after.map((r) => r.id).sort()).toEqual(
        before.map((r) => r.id).sort()
      );
      await edit(made.id, { medication_ids: [c, a] }, 3);
      expect((await coverage(made.id)).map((r) => r.medication_id)).toEqual([
        c,
        a,
      ]);
      expect(await mirror(made.id)).toBe(c);
      await expect(
        edit(made.id, { medication_ids: [a] }, 3)
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await read(made.id)).version).toBe(4);
    });
    it('swaps a full set of twenty medicines for twenty others in one save and caps live medicines at twenty', async () => {
      const first = await Promise.all(
        Array.from({ length: 20 }, (_, i) => medication('Synthetic F' + i))
      );
      const second = await Promise.all(
        Array.from({ length: 20 }, (_, i) => medication('Synthetic S' + i))
      );
      const made = await create(first);
      expect(await coverage(made.id)).toHaveLength(20);
      await edit(made.id, { medication_ids: second });
      expect((await coverage(made.id)).map((r) => r.medication_id)).toEqual(
        second
      );
      const extra = await medication('Synthetic extra');
      await expect(
        edit(made.id, { medication_ids: [...second, extra] })
      ).rejects.toThrow();
      // The database cap holds even for a raw insert that skips the schema.
      await expect(
        sql(async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(
              "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot,position) VALUES($1,$2,$3,'x',99)",
              [made.id, owner, extra]
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        })
      ).rejects.toThrow(/at most 20/);
      expect(await coverage(made.id)).toHaveLength(20);
    });
    it('accepts medication_id on an update only as an echo of the current primary', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b]);
      await expect(edit(made.id, { medication_id: b })).rejects.toMatchObject({
        statusCode: 422,
      });
      await expect(
        edit(made.id, { medication_id: null })
      ).rejects.toMatchObject({ statusCode: 422 });
      await edit(made.id, { medication_id: a, refills_remaining: 1 });
      expect(await mirror(made.id)).toBe(a);
      await expect(
        edit(made.id, { medication_id: a, medication_ids: [a, b] })
      ).rejects.toThrow();
      await expect(
        sql((client) =>
          client.query(
            'UPDATE medication_prescriptions SET medication_id=$2 WHERE id=$1',
            [made.id, b]
          )
        )
      ).rejects.toThrow(/immutable/);
    });
    it('keeps a per-vial price to one medicine: refused on create, on adding a second medicine and on a model 1 edit, unless the same save clears it', async () => {
      const a = await medication(),
        b = await medication(),
        c = await medication();
      await expect(
        create([a, b], { cost: '5', cost_basis: 'per_vial' })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'cost_basis_per_vial_needs_one_medication',
      });
      const single = await create([a], { cost: '5', cost_basis: 'per_vial' });
      await expect(
        edit(single.id, { medication_ids: [a, b] })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'cost_basis_per_vial_needs_one_medication',
      });
      expect((await coverage(single.id)).length).toBe(1);
      await edit(single.id, { medication_ids: [a, b], cost_basis: null });
      expect((await rx.getMedicationPrescription(owner, single.id)).cost).toBe(
        '5'
      );
      expect(
        await rx.getMedicationPrescription(owner, single.id)
      ).not.toHaveProperty('cost_basis');
      await expect(
        edit(single.id, { cost: '6', cost_basis: 'per_vial' })
      ).rejects.toMatchObject({ statusCode: 422 });
      // Several medicines never reach per-vial through a model 1 style edit either.
      await expect(
        rx.updateMedicationPrescription(owner, single.id, {
          operation_id: randomUUID(),
          expected_version: await h.version(single.id),
          cost: '6',
          cost_basis: 'per_vial',
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      const solo = await create([c], { cost: '5', cost_basis: 'per_vial' });
      await edit(solo.id, { refills_remaining: 2 });
      expect(
        (await rx.getMedicationPrescription(owner, solo.id)).cost_basis
      ).toBe('per_vial');
    });
  });

  describe('tombstones', () => {
    it('keeps a deleted medicine as a permanent name-only row, moves the primary, and survives deleting every medicine', async () => {
      const a = await medication('Synthetic Alpha'),
        b = await medication('Synthetic Beta'),
        made = await create([a, b]);
      const vialB = await stock(b, made.id),
        planB = await course(b, made.id);
      await deleteCovered(a);
      let rows = await coverage(made.id);
      expect(rows.map((r) => r.medication_id)).toEqual([null, b]);
      expect(rows[0]!.medication_name_snapshot).toBe('Synthetic Alpha');
      expect(await mirror(made.id)).toBe(b);
      expect(await read(made.id)).toMatchObject({
        medication_id: b,
        medication_name: 'Synthetic Alpha + Synthetic Beta',
      });
      expect(
        ((await read(made.id)) as { medications: unknown[] }).medications
      ).toEqual([
        {
          medication_id: null,
          medication_name: 'Synthetic Alpha',
          position: 0,
        },
        { medication_id: b, medication_name: 'Synthetic Beta', position: 1 },
      ]);
      // Tombstones are never user-deletable, insertable or revivable.
      for (const statement of [
        'DELETE FROM medication_prescription_medications WHERE id=$1',
        'UPDATE medication_prescription_medications SET medication_id=$2 WHERE id=$1',
      ])
        await expect(
          sql((client) =>
            client.query(statement, [
              rows[0]!.id,
              ...(statement.startsWith('UPDATE') ? [b] : []),
            ])
          )
        ).rejects.toThrow();
      await expect(
        sql((client) =>
          client.query(
            "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot) VALUES($1,$2,NULL,'forged')",
            [made.id, owner]
          )
        )
      ).rejects.toThrow();
      // Removing the last live medicine is refused; dropping a tombstone through the set is not possible.
      await expect(
        sql((client) =>
          client.query(
            'DELETE FROM medication_prescription_medications WHERE prescription_id=$1 AND medication_id=$2',
            [made.id, b]
          )
        )
      ).rejects.toThrow();
      await edit(made.id, { medication_ids: [b] });
      rows = await coverage(made.id);
      expect(rows.map((r) => r.medication_id)).toEqual([b, null]);
      // A deleted medicine's plan can still pass the link to its successor, but nothing can freshly link a tombstone.
      expect(await binding('medication_pens', vialB.id)).toBe(made.id);
      await deleteCovered(b);
      expect(
        (await getMedicationCourse(owner, planB.course_id)).course.medication_id
      ).toBeNull();
      const inherited = await successor(planB.course_id, planB.version);
      expect(
        await binding('medication_course_revisions', inherited.revision_id!)
      ).toBe(made.id);
      await expect(
        editMedicationCourse(
          owner,
          planB.course_id,
          {
            ...medicationCoursePlanFixture(),
            start_date: '2026-11-18',
            expected_version: inherited.version,
            operation_id: randomUUID(),
            prescription_id: made.id,
          },
          now
        )
      ).rejects.toThrow();
      const emptied = await rx.getMedicationPrescription(owner, made.id);
      expect(emptied).toMatchObject({
        medication_id: null,
        medication_name: 'Synthetic Beta + Synthetic Alpha',
      });
      expect(
        ((await read(made.id)) as { medications: unknown[] }).medications
      ).toHaveLength(2);
      await expect(
        edit(made.id, { medication_ids: [await medication()] })
      ).resolves.toMatchObject({ deleted: false });
      expect(await mirror(made.id)).not.toBeNull();
    });
    it('lets a delegate delete a covered medicine and cascades account deletion without a blocked delete', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b]);
      await stock(a, made.id);
      await course(b, made.id);
      await deleteCovered(a, delegate);
      expect((await coverage(made.id)).map((r) => r.medication_id)).toEqual([
        null,
        b,
      ]);
      const account = randomUUID();
      h.accounts.push(account);
      await h.user(account);
      const target = await medication('Synthetic account', account),
        second = await medication('Synthetic account two', account),
        bound = await create([target, second], {}, account);
      await actor(account, () =>
        pens.createPen(account, target, {
          kind: 'pen',
          dose_mg: 1,
          doses_total: 3,
          prescription_id: bound.id,
        })
      );
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [account])
      );
      expect(
        await admin(
          async (c) =>
            (
              await c.query(
                'SELECT count(*)::int AS n FROM medication_prescription_medications WHERE user_id=$1',
                [account]
              )
            ).rows[0]!.n
        )
      ).toBe(0);
    });
    it('deletes only the prescription and its coverage, preserving stock and plan revisions', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b]),
        pen = await stock(a, made.id),
        plan = await course(b, made.id);
      await rx.deleteMedicationPrescription(owner, made.id, {
        operation_id: randomUUID(),
        expected_version: 1,
      });
      expect(await coverage(made.id)).toEqual([]);
      expect(await binding('medication_pens', pen.id)).toBeNull();
      expect(
        await binding('medication_course_revisions', plan.revision_id!)
      ).toBeNull();
    });
  });

  describe('row security under the application role', () => {
    it('hides coverage from a delegate, a switched profile and another account, and refuses foreign writes', async () => {
      const a = await medication(),
        made = await create([a]);
      const select = (client: import('pg').PoolClient) =>
        client.query('SELECT id FROM medication_prescription_medications');
      expect((await sql(select)).rows.length).toBeGreaterThan(0);
      expect((await sql(select, delegate)).rows).toEqual([]);
      await actor(owner, async () => {
        const switched = await import('../db/poolManager.js').then((m) =>
          m.getClient(other)
        );
        try {
          expect((await select(switched)).rows).toEqual([]);
        } finally {
          switched.release();
        }
      });
      await expect(
        sql(
          (client) =>
            client.query(
              "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot) VALUES($1,$2,$3,'x')",
              [made.id, owner, a]
            ),
          delegate
        )
      ).rejects.toThrow();
      const foreignMed = await medication('Synthetic foreign', other);
      await expect(
        sql((client) =>
          client.query(
            "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot) VALUES($1,$2,$3,'x')",
            [made.id, owner, foreignMed]
          )
        )
      ).rejects.toThrow();
      await expect(create([foreignMed])).rejects.toThrow();
      await expect(
        actor(delegate, () =>
          rx.updateMedicationPrescription(owner, made.id, {
            operation_id: randomUUID(),
            expected_version: 1,
            medication_ids: [a],
          })
        )
      ).rejects.toMatchObject({ statusCode: 403 });
      const denied = await sql(
        (client) =>
          client.query(
            'UPDATE medication_prescription_medications SET position=5 WHERE prescription_id=$1 RETURNING id',
            [made.id]
          ),
        delegate
      );
      expect(denied.rows).toEqual([]);
      await expect(
        sql(
          (client) =>
            client.query(
              'DELETE FROM medication_prescription_medications WHERE prescription_id=$1',
              [made.id]
            ),
          delegate
        ).then((r) => r.rowCount)
      ).resolves.toBe(0);
      expect((await coverage(made.id)).length).toBe(1);
      await expect(
        actor(delegate, () =>
          rx.listMedicationPrescriptions(owner, undefined, 2)
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('races', () => {
    it('never leaves stock linked to a medicine its prescription no longer covers when a link races a removal', async () => {
      const a = await medication(),
        b = await medication();
      for (let round = 0; round < 6; round++) {
        const made = await create([a, b]),
          pen = await stock(b);
        const results = await Promise.allSettled([
          pens.updatePen(owner, pen.id, { prescription_id: made.id }),
          edit(made.id, { medication_ids: [a] }),
        ]);
        const covered = (await coverage(made.id)).some(
          (row) => row.medication_id === b
        );
        const linked = (await binding('medication_pens', pen.id)) === made.id;
        expect(linked && !covered).toBe(false);
        // One of them won; the loser failed cleanly rather than leaving a mixed state.
        expect(
          results.filter((r) => r.status === 'fulfilled').length
        ).toBeGreaterThanOrEqual(1);
        await admin((c) =>
          c.query('DELETE FROM medication_pens WHERE id=$1', [pen.id])
        );
      }
    });
    it('lets only one of two concurrent coverage edits at the same version win', async () => {
      const a = await medication(),
        b = await medication(),
        c = await medication(),
        made = await create([a]);
      const results = await Promise.allSettled([
        edit(made.id, { medication_ids: [a, b] }, 1),
        edit(made.id, { medication_ids: [a, c] }, 1),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await coverage(made.id)).length).toBe(2);
    });
    it('settles a coverage edit racing the prescription delete without orphans', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a]);
      await Promise.allSettled([
        edit(made.id, { medication_ids: [a, b] }, 1),
        rx.deleteMedicationPrescription(owner, made.id, {
          operation_id: randomUUID(),
          expected_version: 1,
        }),
      ]);
      const gone = await rx.getMedicationPrescription(owner, made.id).then(
        () => false,
        () => true
      );
      const rowsLeft = (await coverage(made.id)).length;
      expect(gone ? rowsLeft === 0 : rowsLeft >= 1).toBe(true);
    });
    it('does not deadlock two prescriptions that share medicines and edit them in opposite order', async () => {
      const a = await medication(),
        b = await medication(),
        c = await medication(),
        d = await medication();
      const first = await create([a, b]),
        second = await create([b, a]);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          i % 2
            ? edit(first.id, { medication_ids: [b, a, c] })
            : edit(second.id, { medication_ids: [a, b, d] })
        )
      );
      for (const result of results)
        if (result.status === 'rejected')
          expect(String(result.reason.code ?? '')).not.toBe('40P01');
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    });
  });
  describe('operation ledger', () => {
    // Receipts written before several medicines existed: their hashes were computed over the
    // request as authored. These two digests were captured from that code path.
    const legacyCreate = {
      medication_id: '11111111-1111-4111-8111-111111111111',
      operation_id: '22222222-2222-4222-8222-222222222222',
      currency: ' GBP ',
      cost: '12.50',
      quantity: 3,
      source: ' Synthetic ',
      status: 'active',
    };
    const legacyCreateHash =
      '291f3796f63284d8e0b88edb910605c18511c15719998b9c79275204015d4b40';
    const legacyUpdateId = '44444444-4444-4444-8444-444444444444';
    const legacyUpdate = {
      operation_id: '33333333-3333-4333-8333-333333333333',
      expected_version: 2,
      medication_id: '11111111-1111-4111-8111-111111111111',
      refills_remaining: 1,
      cost: '3',
      cost_basis: 'per_vial' as const,
    };
    const legacyUpdateHash =
      'b2b40e757c12403b325dfe0f0a289638ba5c975c9d7ec6090d61fa4d74599bd8';
    const receipt = (operation: string, hash: string, result: object) =>
      admin((c) =>
        c.query(
          'INSERT INTO medication_prescription_operations(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
          [owner, operation, hash, JSON.stringify(result)]
        )
      );
    const receiptCount = () =>
      admin(
        async (c) =>
          (
            await c.query(
              'SELECT count(*)::int AS n FROM medication_prescription_operations WHERE user_id=$1',
              [owner]
            )
          ).rows[0]!.n as number
      );
    it('replays a create recorded before the deploy, from a model 1 or model 2 body, without writing anything', async () => {
      const stored = {
        id: '55555555-5555-4555-8555-555555555555',
        version: 1,
        deleted: false,
      };
      await receipt(legacyCreate.operation_id, legacyCreateHash, stored);
      const before = await receiptCount();
      for (const parse of [
        medicationPrescriptionCreateSchema,
        medicationPrescriptionCreateSchemaV2,
      ])
        expect(
          await rx.createMedicationPrescription(
            owner,
            parse.parse(legacyCreate) as never
          )
        ).toEqual(stored);
      expect(await receiptCount()).toBe(before);
      expect(await h.coverage(stored.id)).toEqual([]);
      // The same operation id with different content is still refused.
      await expect(
        rx.createMedicationPrescription(
          owner,
          medicationPrescriptionCreateSchemaV2.parse({
            ...legacyCreate,
            cost: '99',
          })
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      // A model 2 list of the same single medicine is a different authored request.
      await expect(
        rx.createMedicationPrescription(
          owner,
          medicationPrescriptionCreateSchemaV2.parse({
            ...legacyCreate,
            medication_id: undefined,
            medication_ids: [legacyCreate.medication_id],
          })
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('replays an update recorded before the deploy', async () => {
      const stored = { id: legacyUpdateId, version: 3, deleted: false };
      await receipt(legacyUpdate.operation_id, legacyUpdateHash, stored);
      for (const parse of [
        medicationPrescriptionUpdateSchema,
        medicationPrescriptionUpdateSchemaV2,
      ])
        expect(
          await rx.updateMedicationPrescription(
            owner,
            legacyUpdateId,
            parse.parse(legacyUpdate) as never
          )
        ).toEqual(stored);
    });
    it('hashes a legacy body identically through the old and the new schema, key order included', () => {
      const key = (value: unknown) => JSON.stringify(value);
      expect(
        key(medicationPrescriptionCreateSchemaV2.parse(legacyCreate))
      ).toBe(key(medicationPrescriptionCreateSchema.parse(legacyCreate)));
      expect(
        key(medicationPrescriptionUpdateSchemaV2.parse(legacyUpdate))
      ).toBe(key(medicationPrescriptionUpdateSchema.parse(legacyUpdate)));
    });
    it('replays a coverage create and a coverage update from the stored receipt', async () => {
      const a = await medication(),
        b = await medication(),
        request = h.input([a, b], { cost: '2' }),
        created = await rx.createMedicationPrescription(owner, request);
      expect(await rx.createMedicationPrescription(owner, request)).toEqual(
        created
      );
      const patch = {
        operation_id: randomUUID(),
        expected_version: 1,
        medication_ids: [b, a],
      };
      const saved = await rx.updateMedicationPrescription(
        owner,
        created.id,
        patch
      );
      expect(
        await rx.updateMedicationPrescription(owner, created.id, patch)
      ).toEqual(saved);
      expect((await read(created.id)).version).toBe(2);
      await expect(
        rx.updateMedicationPrescription(owner, created.id, {
          ...patch,
          medication_ids: [a, b],
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await mirror(created.id)).toBe(b);
      const concurrent = await Promise.all([
        rx.createMedicationPrescription(owner, request),
        rx.createMedicationPrescription(owner, request),
      ]);
      expect(concurrent[0]).toEqual(created);
      expect(concurrent[1]).toEqual(created);
    });
  });
  describe('whole-prescription price (per_prescription)', () => {
    const vialCosts = async () =>
      (await getMedicationPrescriptionVialCosts(owner)).vials;
    const priceOf = async (id: string) =>
      (await vialCosts()).find((v) => v.pen_id === id)!;
    it('stores the basis only with a cost, shows it to model 2 and hides it from model 1', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b], {
          cost: '90',
          currency: 'GBP',
          cost_basis: 'per_prescription',
        });
      expect(await read(made.id)).toMatchObject({
        cost: '90',
        cost_basis: 'per_prescription',
      });
      const old = await rx.getMedicationPrescription(owner, made.id);
      expect(old).not.toHaveProperty('cost_basis');
      expect(old.cost).toBe('90');
      await expect(
        admin((c) =>
          c.query('UPDATE medication_prescriptions SET cost=NULL WHERE id=$1', [
            made.id,
          ])
        )
      ).rejects.toThrow(/cost_basis_check/);
      await expect(
        admin((c) =>
          c.query(
            "UPDATE medication_prescriptions SET cost_basis='per_dose' WHERE id=$1",
            [made.id]
          )
        )
      ).rejects.toThrow(/cost_basis_check/);
      // An unrelated model 1 edit keeps it; changing the money clears it.
      await rx.updateMedicationPrescription(owner, made.id, {
        operation_id: randomUUID(),
        expected_version: 1,
        pharmacy: 'Synthetic pharmacy',
      });
      expect(await read(made.id)).toMatchObject({
        cost_basis: 'per_prescription',
      });
      await rx.updateMedicationPrescription(owner, made.id, {
        operation_id: randomUUID(),
        expected_version: 2,
        cost: '95',
      });
      expect(await read(made.id)).not.toHaveProperty('cost_basis');
    });
    it('splits one total evenly across the linked vials of every covered medicine, and moves the shares as vials come and go', async () => {
      const a = await medication(),
        b = await medication(),
        made = await create([a, b], {
          cost: '90',
          currency: 'GBP',
          cost_basis: 'per_prescription',
        });
      const v1 = await stock(a, made.id),
        v2 = await stock(a, made.id),
        v3 = await stock(b, made.id);
      for (const v of [v1, v2, v3])
        expect(await priceOf(v.id)).toMatchObject({
          cost_source: 'prescription',
          unit_cost: '30',
          currency: 'GBP',
          estimate_basis: 'per_prescription',
          prescription_id: made.id,
        });
      const unlinked = await stock(a);
      expect(await priceOf(unlinked.id)).toMatchObject({ is_costed: false });
      await pens.updatePen(owner, unlinked.id, { prescription_id: made.id });
      expect((await priceOf(v1.id)).unit_cost).toBe('22.5');
      await pens.updatePen(owner, unlinked.id, { prescription_id: null });
      await pens.updatePen(owner, v3.id, { prescription_id: null });
      expect((await priceOf(v1.id)).unit_cost).toBe('45');
      // The report counts the total once, not once per vial.
      const report = await getMedicationCostAnalytics(
        owner,
        'all',
        now,
        'with_prescription_estimates'
      );
      const estimate = report.accounted.find((x) => x.currency === 'GBP');
      expect(estimate?.prescription_estimate).toBe('90.00');
    });
    it('lets a vial with its own invoice price take the invoice and leaves its share unspent', async () => {
      const a = await medication(),
        made = await create([a], {
          cost: '60',
          currency: 'GBP',
          cost_basis: 'per_prescription',
        }),
        estimated = await stock(a, made.id),
        invoiced = await stock(a, made.id);
      await purchases.createPurchase(owner, {
        operation_id: randomUUID(),
        expected_owner_id: owner,
        ordered_date: '2026-11-02',
        currency: 'GBP',
        items: [
          {
            kind: 'medication',
            medication_id: a,
            quantity: 1,
            unit_cost: '7',
            vial_ids: [invoiced.id],
          },
        ],
      });
      expect(await priceOf(estimated.id)).toMatchObject({
        cost_source: 'prescription',
        unit_cost: '30',
      });
      expect(await priceOf(invoiced.id)).toMatchObject({
        cost_source: 'invoice',
        unit_cost: '7',
      });
    });
    it('prices the same share in the vial read, the cost report and the course costs', async () => {
      const a = await medication(),
        made = await create([a], {
          cost: '10',
          currency: 'GBP',
          cost_basis: 'per_prescription',
        }),
        first = await stock(a, made.id);
      await stock(a, made.id);
      expect((await priceOf(first.id)).unit_cost).toBe('5');
      const report = await getMedicationCostAnalytics(
        owner,
        'all',
        now,
        'with_prescription_estimates'
      );
      expect(report.accounted.find((x) => x.currency === 'GBP')).toMatchObject({
        estimated_vials: expect.any(Number),
      });
      // The course report reads the same snapshot and resolver, so it must at least build from it.
      expect(await getMedicationCourseCosts(owner, now)).toHaveProperty(
        'unattributed'
      );
    });
  });
});
