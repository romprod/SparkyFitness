import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { medicationPrescriptionCreateSchema } from '@workspace/shared';
import { endPool } from '../db/poolManager.js';
import * as current from '../models/medicationPrescriptionRepository.js';
import * as pens from '../models/medicationPenRepository.js';
import * as purchases from '../models/medicationPurchaseRepository.js';
import * as medications from '../models/medicationRepository.js';
import {
  getMedicationCostAnalytics,
  getMedicationPrescriptionVialCosts,
} from '../models/medicationCostAnalyticsRepository.js';
import { getMedicationCourseCosts } from '../models/medicationCourseCostsRepository.js';
import { createMedicationCourse } from '../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';
import * as legacy from './fixtures/legacy/medicationPrescriptionRepository.legacy.js';
import { prescriptionCoverageHarness } from './fixtures/prescriptionCoverageHarness.js';

// Replays the migration over legacy-shaped data and proves nothing is lost and no cost figure moves.
describe.runIf(
  process.env.MEDICATION_PRESCRIPTION_COVERAGE_INTEGRATION === '1'
)('prescription coverage migration PostgreSQL', () => {
  const h = prescriptionCoverageHarness('migration');
  const { owner, now, admin, actor, sql, medication, stock, coverage } = h;
  beforeAll(h.setup);
  afterAll(async () => {
    await h.teardown();
    await endPool();
  });
  const migration = () =>
    readFile(
      new URL(
        '../db/migrations/20261126120000_medication_prescription_medications.sql',
        import.meta.url
      ),
      'utf8'
    );
  const legacyCreate = (medication_id: string, patch = {}) =>
    actor(owner, () =>
      legacy.createMedicationPrescription(
        owner,
        medicationPrescriptionCreateSchema.parse({
          medication_id,
          operation_id: randomUUID(),
          currency: 'GBP',
          ...patch,
        })
      )
    );
  /** Everything the migration must leave untouched. */
  const fingerprint = () =>
    admin(async (c) => {
      const one = async (query: string) =>
        (await c.query<{ v: unknown }>(query, [owner])).rows.map((r) => r.v);
      return {
        prescriptions: await one(
          'SELECT to_jsonb(t) AS v FROM medication_prescriptions t WHERE user_id=$1 ORDER BY id'
        ),
        pens: await one(
          'SELECT jsonb_build_array(id,prescription_id) AS v FROM medication_pens WHERE user_id=$1 ORDER BY id'
        ),
        revisions: await one(
          'SELECT jsonb_build_array(id,prescription_id) AS v FROM medication_course_revisions WHERE user_id=$1 ORDER BY id'
        ),
      };
    });
  /** Every cost figure a person can read. */
  const costReads = async () => ({
    prescriptions: await current.listMedicationPrescriptions(owner),
    vialCosts: await getMedicationPrescriptionVialCosts(owner),
    analyticsWithEstimates: await getMedicationCostAnalytics(
      owner,
      'all',
      now,
      'with_prescription_estimates'
    ),
    analyticsInvoiceOnly: await getMedicationCostAnalytics(owner, 'all', now),
    courseCosts: await getMedicationCourseCosts(owner, now),
    invoiceVials: await purchases.getVialCosts(owner),
  });
  const wipeCoverage = () =>
    admin(async (c) => {
      await c.query('BEGIN');
      await c.query(
        'ALTER TABLE medication_prescription_medications DISABLE TRIGGER USER'
      );
      await c.query(
        'DELETE FROM medication_prescription_medications WHERE user_id=$1',
        [owner]
      );
      await c.query(
        'ALTER TABLE medication_prescription_medications ENABLE TRIGGER USER'
      );
      await c.query('COMMIT');
    });
  const mismatches = () =>
    admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            'SELECT p.id FROM medication_prescriptions p WHERE p.medication_id IS DISTINCT FROM public.medication_prescription_first_live(p.id) OR NOT EXISTS(SELECT 1 FROM medication_prescription_medications j WHERE j.prescription_id=p.id)'
          )
        ).rows
    );

  it('replays over legacy-shaped data twice: every prescription gets exactly one coverage row, orphans become named tombstones, and no fact or cost figure changes', async () => {
    const a = await medication('Synthetic Legacy A'),
      b = await medication('Synthetic Legacy B'),
      gone = await medication('Synthetic Legacy Gone');
    const withBasis = await legacyCreate(a, {
        cost: '40',
        date_written: '2026-11-01',
        cost_basis: 'per_vial',
      }),
      generic = await legacyCreate(a, { cost: '17.50', quantity: 2 }),
      free = await legacyCreate(b, { cost: '0', cost_basis: 'per_vial' }),
      orphan = await legacyCreate(gone, { cost: '9', cost_basis: 'per_vial' }),
      bare = await legacyCreate(b);
    const v1 = await stock(a, withBasis.id),
      v2 = await stock(a, withBasis.id);
    await stock(a, generic.id);
    await stock(b, free.id);
    await stock(gone, orphan.id);
    await stock(b);
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
          unit_cost: '12.34',
          vial_ids: [v2.id],
        },
      ],
    });
    await createMedicationCourse(
      owner,
      {
        ...medicationCoursePlanFixture(),
        medication_id: a,
        prescription_id: withBasis.id,
        expected_version: 0,
        operation_id: randomUUID(),
        native_reminder_limitation_acknowledged: false,
      },
      now
    );
    await createMedicationCourse(
      owner,
      {
        ...medicationCoursePlanFixture(),
        medication_id: gone,
        prescription_id: orphan.id,
        expected_version: 0,
        operation_id: randomUUID(),
        native_reminder_limitation_acknowledged: false,
      },
      now
    );
    await admin((c) =>
      c.query(
        "INSERT INTO injection_entries(user_id,medication_id,pen_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,1,'2026-11-17','2026-11-17T08:00:00Z')",
        [owner, a, v1.id]
      )
    );
    await medications.deleteMedication(owner, gone);
    // Every figure a person can read, taken while the legacy-shaped data is whole.
    const wasCovered = await coverage(orphan.id);
    expect(wasCovered).toHaveLength(1);
    const before = await fingerprint(),
      costsBefore = await costReads();
    expect(JSON.stringify(costsBefore.vialCosts)).toContain(
      '"cost_source":"prescription"'
    );
    // Pre-migration state: the old server never wrote coverage rows.
    await wipeCoverage();
    expect(await coverage(withBasis.id)).toEqual([]);
    const sqlText = await migration();
    await admin((c) => c.query(sqlText));
    const once = await coverage(withBasis.id);
    await admin((c) => c.query(sqlText));
    for (const rx of [withBasis, generic, free, orphan, bare]) {
      const rows = await coverage(rx.id);
      expect(rows).toHaveLength(1);
    }
    expect(await coverage(withBasis.id)).toEqual(once);
    expect((await coverage(withBasis.id))[0]).toMatchObject({
      medication_id: a,
      position: 0,
    });
    expect((await coverage(orphan.id))[0]).toMatchObject({
      medication_id: null,
      medication_name_snapshot: 'Synthetic Legacy Gone',
    });
    expect(await fingerprint()).toEqual(before);
    // The deep-equality gate: every number a person can read is identical.
    expect(await costReads()).toEqual(costsBefore);
    expect(await mismatches()).toEqual([]);
    expect(
      (await current.getMedicationPrescription(owner, orphan.id))
        .medication_name
    ).toBe('Synthetic Legacy Gone');
  });
  it('aborts the whole transaction instead of continuing when the mirror or a stock link does not line up', async () => {
    const a = await medication(),
      b = await medication(),
      made = await legacyCreate(a),
      other = await legacyCreate(b),
      pen = await stock(a, made.id);
    const sqlText = await migration();
    const triggersOff = (statement: string, params: unknown[]) =>
      admin(async (c) => {
        await c.query('BEGIN');
        await c.query(
          'ALTER TABLE medication_prescriptions DISABLE TRIGGER USER'
        );
        await c.query('ALTER TABLE medication_pens DISABLE TRIGGER USER');
        await c.query(statement, params);
        await c.query(
          'ALTER TABLE medication_prescriptions ENABLE TRIGGER USER'
        );
        await c.query('ALTER TABLE medication_pens ENABLE TRIGGER USER');
        await c.query('COMMIT');
      });
    await triggersOff(
      'UPDATE medication_prescriptions SET medication_id=$2 WHERE id=$1',
      [made.id, b]
    );
    await expect(admin((c) => c.query(sqlText))).rejects.toThrow(
      /primary medicine mismatch/
    );
    // Nothing from the failed run stuck.
    expect(await h.mirror(made.id)).toBe(b);
    await triggersOff(
      'UPDATE medication_prescriptions SET medication_id=$2 WHERE id=$1',
      [made.id, a]
    );
    await triggersOff(
      'UPDATE medication_pens SET prescription_id=$2 WHERE id=$1',
      [pen.id, other.id]
    );
    await expect(admin((c) => c.query(sqlText))).rejects.toThrow(
      /stock link lost its prescription coverage/
    );
    await triggersOff(
      'UPDATE medication_pens SET prescription_id=$2 WHERE id=$1',
      [pen.id, made.id]
    );
    await admin((c) => c.query(sqlText));
    expect(await mismatches()).toEqual([]);
  });
  it('rejects duplicate live coverage, a coverage row for another owner, and any forged identity change', async () => {
    const a = await medication(),
      made = await legacyCreate(a);
    const [row] = await coverage(made.id);
    await expect(
      sql((c) =>
        c.query(
          "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot) VALUES($1,$2,$3,'dup')",
          [made.id, owner, a]
        )
      )
    ).rejects.toThrow(/duplicate key|unique/i);
    for (const statement of [
      "UPDATE medication_prescription_medications SET medication_name_snapshot='forged' WHERE id=$1",
      'UPDATE medication_prescription_medications SET prescription_id=gen_random_uuid() WHERE id=$1',
      'UPDATE medication_prescription_medications SET user_id=gen_random_uuid() WHERE id=$1',
    ])
      await expect(sql((c) => c.query(statement, [row!.id]))).rejects.toThrow();
    await expect(
      admin((c) =>
        c.query(
          "INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot) VALUES($1,$2,$3,'x')",
          [made.id, h.other, a]
        )
      )
    ).rejects.toThrow();
    expect(await coverage(made.id)).toHaveLength(1);
    void pens;
  });
});
