import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  medicationPrescriptionCreateSchema,
  type MedicationPrescriptionCreate,
} from '@workspace/shared';
import {
  getClient,
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import * as rx from '../models/medicationPrescriptionRepository.js';
import * as pens from '../models/medicationPenRepository.js';
import * as medications from '../models/medicationRepository.js';
import * as entries from '../models/medicationEntryRepository.js';
import * as injections from '../models/injectionRepository.js';
import {
  createMedicationCourse,
  editMedicationCourse,
  getMedicationCourse,
  reviewMedicationCourse,
  reviseMedicationCourse,
  deleteMedicationCourseRevision,
} from '../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

// Author-only fixture: release runs this opt-in against one isolated migrated database.
describe.runIf(process.env.MEDICATION_PRESCRIPTIONS_INTEGRATION === '1')(
  'owner-private prescription lifecycle PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      delegate = randomUUID(),
      accounts = [owner, other, delegate];
    const now = new Date('2026-11-17T12:00:00Z');
    const admin = async <T>(fn: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    };
    const actor = <T>(id: string, fn: () => Promise<T>) =>
      dbContextStorage.run({ authenticatedUserId: id }, fn);
    const sql = async <T>(fn: (c: PoolClient) => Promise<T>, as = owner) =>
      actor(as, async () => {
        const c = await getClient(owner);
        try {
          return await fn(c);
        } finally {
          c.release();
        }
      });
    const user = async (id: string) =>
      admin((c) =>
        c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [id, `synthetic-rx-${id}@example.test`]
        )
      );
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      for (const id of accounts) await user(id);
      await admin((c) =>
        c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_manage_medications\":true}'::jsonb,$3,'active')",
          [owner, delegate, `synthetic-${delegate}@example.test`]
        )
      );
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          accounts,
        ])
      );
      await endPool();
    });
    const medication = async (who = owner) =>
      admin(
        async (c) =>
          (
            await c.query<{ id: string }>(
              "INSERT INTO medications(user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1,prescriber,pharmacy,rx_number) VALUES($1,'Synthetic Rx target','injection','subcutaneous',1,'mg',false,'Legacy synthetic prescriber','Legacy synthetic pharmacy','Legacy synthetic number') RETURNING id",
              [who]
            )
          ).rows[0]!.id
      );
    const input = (
      medication_id: string,
      patch: Partial<MedicationPrescriptionCreate> = {}
    ) =>
      medicationPrescriptionCreateSchema.parse({
        medication_id,
        operation_id: randomUUID(),
        currency: 'AUD',
        ...patch,
      });
    const create = async (
      med: string,
      patch: Partial<MedicationPrescriptionCreate> = {}
    ) => rx.createMedicationPrescription(owner, input(med, patch));
    const stock = async (med: string, prescription_id?: string | null) =>
      pens.createPen(owner, med, {
        kind: 'vial',
        label: 'Synthetic Rx stock',
        preparation: {
          mode: 'reconstituted',
          mass_value: 2,
          mass_unit: 'mg',
          final_volume_ml: 2,
          prepared_date: '2026-11-01',
        },
        ...(prescription_id === undefined ? {} : { prescription_id }),
      });
    const course = async (med: string, prescription_id?: string | null) =>
      createMedicationCourse(
        owner,
        {
          ...medicationCoursePlanFixture(),
          medication_id: med,
          expected_version: 0,
          operation_id: randomUUID(),
          native_reminder_limitation_acknowledged: false,
          ...(prescription_id === undefined ? {} : { prescription_id }),
        },
        now
      );
    const rows = async (table: string, stripBinding = false, who = owner) =>
      admin(
        async (c) =>
          (
            await c.query(
              `SELECT ${stripBinding ? "to_jsonb(t)-'prescription_id'" : 'to_jsonb(t)'} AS value FROM ${table} t WHERE user_id=$1 ORDER BY to_jsonb(t)::text`,
              [who]
            )
          ).rows
      );
    const children = async (stripBindings = false) => {
      const value: Record<string, unknown> = {};
      for (const table of [
        'medications',
        'medication_pens',
        'medication_preparations',
        'medication_preparation_corrections',
        'medication_preparation_dose_corrections',
        'medication_courses',
        'medication_course_revisions',
        'medication_course_rules',
        'medication_course_steps',
        'medication_course_activity',
        'medication_entries',
        'injection_entries',
        'medication_schedules',
        'user_preferences',
      ])
        value[table] = await rows(
          table,
          stripBindings &&
            ['medication_pens', 'medication_course_revisions'].includes(table)
        );
      return value;
    };
    const binding = async (
      table: 'medication_pens' | 'medication_course_revisions',
      id: string
    ) =>
      admin(
        async (c) =>
          (
            await c.query<{ prescription_id: string | null }>(
              `SELECT prescription_id FROM ${table} WHERE id=$1`,
              [id]
            )
          ).rows[0]!.prescription_id
      );
    const successor = async (id: string, version: number, as = owner) =>
      actor(as, async () => {
        const draft = {
          ...medicationCoursePlanFixture(),
          start_date: '2026-11-18',
          expected_version: version,
        };
        const review = await reviewMedicationCourse(owner, id, draft, now);
        return reviseMedicationCourse(
          owner,
          id,
          {
            ...review.plan,
            start_date: draft.start_date,
            expected_version: version,
            review_fingerprint: review.review_fingerprint,
            operation_id: randomUUID(),
          },
          now
        );
      });

    it('reapplies only the additive Rx migration twice without backfilling or changing existing legacy facts', async () => {
      const med = await medication();
      await stock(med);
      await course(med);
      await entries.createEntry(owner, {
        medication_id: med,
        entry_date: '2026-11-01',
        status: 'taken',
      });
      const before = await children(),
        beforeRx = await rows('medication_prescriptions');
      // Replay the original migration and the one that lets a prescription cover several medicines, in order.
      const migrations = await Promise.all(
        [
          '../db/migrations/20261117120000_medication_prescriptions.sql',
          '../db/migrations/20261126120000_medication_prescription_medications.sql',
        ].map((file) => readFile(new URL(file, import.meta.url), 'utf8'))
      );
      const beforeCoverage = await rows('medication_prescription_medications');
      await admin(async (c) => {
        for (const migration of [...migrations, ...migrations])
          await c.query(migration);
      });
      expect(await rows('medication_prescription_medications')).toEqual(
        beforeCoverage
      );
      expect(await children()).toEqual(before);
      expect(await rows('medication_prescriptions')).toEqual(beforeRx);
    });
    it('round-trips encrypted synthetic text, exact money and explicit zero separately from unknown manual facts', async () => {
      const med = await medication(),
        known = await create(med, {
          source: 'Synthetic private source',
          prescriber: 'Synthetic private prescriber',
          pharmacy: 'Synthetic private pharmacy',
          dose_instructions: 'Synthetic private instructions',
          cost: '12345678901234567890.00000000000000000001',
          currency: 'GBP',
          quantity: 0,
          refills_authorized: 0,
          refills_remaining: 0,
          lead_time_days: 0,
          date_written: '2026-11-17',
          next_refill: '2026-10-01',
          expiration: '2026-11-01',
          status: 'cancelled',
        }),
        unknown = await create(med),
        zero = await create(med, { cost: '0' });
      expect(await rx.getMedicationPrescription(owner, known.id)).toMatchObject(
        {
          source: 'Synthetic private source',
          prescriber: 'Synthetic private prescriber',
          pharmacy: 'Synthetic private pharmacy',
          dose_instructions: 'Synthetic private instructions',
          cost: '12345678901234567890.00000000000000000001',
          currency: 'GBP',
          quantity: 0,
          refills_authorized: 0,
          refills_remaining: 0,
          lead_time_days: 0,
          date_written: '2026-11-17',
          next_refill: '2026-10-01',
          expiration: '2026-11-01',
          status: 'cancelled',
        }
      );
      expect(
        await rx.getMedicationPrescription(owner, unknown.id)
      ).toMatchObject({
        source: null,
        cost: null,
        quantity: null,
        refills_authorized: null,
        refills_remaining: null,
        lead_time_days: null,
        currency: 'AUD',
        status: 'active',
      });
      expect((await rx.getMedicationPrescription(owner, zero.id)).cost).toBe(
        '0'
      );
      const stored = await admin(
        async (c) =>
          (
            await c.query(
              'SELECT source_encrypted,prescriber_encrypted,pharmacy_encrypted,dose_instructions_encrypted FROM medication_prescriptions WHERE id=$1',
              [known.id]
            )
          ).rows[0]!
      );
      for (const envelope of Object.values(stored)) {
        expect(envelope).toMatchObject({
          encryptedText: expect.any(String),
          iv: expect.any(String),
          tag: expect.any(String),
        });
        expect(JSON.stringify(envelope)).not.toContain('Synthetic private');
      }
      const before = await rows('medication_prescriptions');
      await rx.listMedicationPrescriptions(owner);
      expect(await rows('medication_prescriptions')).toEqual(before);
    });
    it('enforces owner-only actor and RLS reads/writes even for an authorised medication delegate', async () => {
      const med = await medication(),
        record = await create(med),
        foreignMed = await medication(other);
      await expect(
        actor(delegate, () => rx.listMedicationPrescriptions(owner))
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        actor(delegate, () =>
          rx.createMedicationPrescription(owner, input(med))
        )
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        rx.getMedicationPrescription(owner, record.id, other)
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(create(foreignMed)).rejects.toThrow();
      // Actor-owned rows must also be hidden when another profile is active.
      await actor(owner, async () => {
        const switched = await getClient(other);
        try {
          expect(
            (await switched.query('SELECT id FROM medication_prescriptions'))
              .rows
          ).toEqual([]);
          expect(
            (
              await switched.query(
                'SELECT operation_id FROM medication_prescription_operations'
              )
            ).rows
          ).toEqual([]);
        } finally {
          switched.release();
        }
      });
      expect(
        await sql(
          async (c) =>
            (
              await c.query(
                'SELECT id FROM medication_prescriptions WHERE user_id=$1',
                [owner]
              )
            ).rows,
          delegate
        )
      ).toEqual([]);
      expect(
        await sql(
          async (c) =>
            (
              await c.query(
                "UPDATE medication_prescriptions SET status='expired' WHERE id=$1 RETURNING id",
                [record.id]
              )
            ).rows,
          delegate
        )
      ).toEqual([]);
      expect(
        (await rx.getMedicationPrescription(owner, record.id)).status
      ).toBe('active');
    });
    it('rejects immutable target/owner changes and cross-owner or cross-medication stock and course links', async () => {
      const med = await medication(),
        second = await medication(),
        foreign = await medication(other),
        record = await create(med);
      await expect(
        rx.updateMedicationPrescription(owner, record.id, {
          operation_id: randomUUID(),
          expected_version: 1,
          medication_id: second,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      await expect(
        rx.updateMedicationPrescription(owner, record.id, {
          operation_id: randomUUID(),
          expected_version: 1,
          medication_id: null,
        })
      ).rejects.toMatchObject({ statusCode: 422 });
      await expect(
        sql((c) =>
          c.query(
            'UPDATE medication_prescriptions SET medication_id=$2 WHERE id=$1',
            [record.id, second]
          )
        )
      ).rejects.toThrow();
      await expect(
        sql((c) =>
          c.query(
            'UPDATE medication_prescriptions SET user_id=$2 WHERE id=$1',
            [record.id, other]
          )
        )
      ).rejects.toThrow();
      await expect(stock(second, record.id)).rejects.toThrow();
      await expect(course(second, record.id)).rejects.toThrow();
      const mismatched = await stock(second);
      await expect(
        sql((c) =>
          c.query('UPDATE medication_pens SET prescription_id=$2 WHERE id=$1', [
            mismatched.id,
            record.id,
          ])
        )
      ).rejects.toThrow();
      await expect(
        sql((c) =>
          c.query(
            "UPDATE medication_prescriptions SET medication_name_snapshot='forged' WHERE id=$1",
            [record.id]
          )
        )
      ).rejects.toThrow();
      const boundPen = await stock(med, record.id);
      await expect(
        admin((c) =>
          c.query('UPDATE medication_pens SET user_id=$2 WHERE id=$1', [
            boundPen.id,
            other,
          ])
        )
      ).rejects.toThrow();
      expect(await binding('medication_pens', boundPen.id)).toBe(record.id);
      expect(
        await admin(
          async (c) =>
            (
              await c.query<{ user_id: string }>(
                'SELECT user_id FROM medication_pens WHERE id=$1',
                [boundPen.id]
              )
            ).rows[0]!.user_id
        )
      ).toBe(owner);
      const foreignRecord = await actor(other, () =>
        rx.createMedicationPrescription(other, input(foreign))
      );
      await expect(stock(med, foreignRecord.id)).rejects.toThrow();
      await expect(course(med, foreignRecord.id)).rejects.toThrow();
      expect(
        (await rx.getMedicationPrescription(owner, record.id)).medication_id
      ).toBe(med);
    });
    it('serializes operation retries and CAS, rejects changed-payload reuse and never resurrects a deleted replay', async () => {
      const med = await medication(),
        request = input(med, { cost: '0' }),
        created = await Promise.all([
          rx.createMedicationPrescription(owner, request),
          rx.createMedicationPrescription(owner, request),
        ]);
      expect(created[1]).toEqual(created[0]);
      const id = created[0]!.id;
      await expect(
        rx.createMedicationPrescription(owner, { ...request, cost: '1' })
      ).rejects.toMatchObject({ statusCode: 409 });
      const updates = await Promise.allSettled([
        rx.updateMedicationPrescription(owner, id, {
          operation_id: randomUUID(),
          expected_version: 1,
          refills_remaining: 0,
        }),
        rx.updateMedicationPrescription(owner, id, {
          operation_id: randomUUID(),
          expected_version: 1,
          refills_remaining: 2,
        }),
      ]);
      expect(updates.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(updates.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const deletion = { operation_id: randomUUID(), expected_version: 2 },
        deleted = await rx.deleteMedicationPrescription(owner, id, deletion);
      expect(
        await rx.deleteMedicationPrescription(owner, id, deletion)
      ).toEqual(deleted);
      expect(await rx.createMedicationPrescription(owner, request)).toEqual(
        created[0]
      );
      await expect(
        rx.getMedicationPrescription(owner, id)
      ).rejects.toMatchObject({ statusCode: 404 });
      const savedReceipt = () =>
        sql(
          async (c) =>
            (
              await c.query(
                'SELECT to_jsonb(o) AS receipt FROM medication_prescription_operations o WHERE user_id=$1 AND operation_id=$2',
                [owner, request.operation_id]
              )
            ).rows[0]
        );
      const beforeReceipt = await savedReceipt();
      expect(beforeReceipt).toBeDefined();
      const denied = await sql((c) =>
        c.query(
          "UPDATE medication_prescription_operations SET request_hash='forged' WHERE user_id=$1 AND operation_id=$2 RETURNING operation_id",
          [owner, request.operation_id]
        )
      );
      expect(denied.rowCount).toBe(0);
      expect(denied.rows).toEqual([]);
      expect(await savedReceipt()).toEqual(beforeReceipt);
    });
    it('preserves omitted stock links through old and delegated updates, redacts private bindings, and explicitly unlinks only the relation', async () => {
      const med = await medication(),
        record = await create(med),
        pen = await stock(med, record.id);
      await pens.updatePen(owner, pen.id, { notes: 'Synthetic owner note' });
      expect(await binding('medication_pens', pen.id)).toBe(record.id);
      const delegated = await actor(delegate, () => pens.listPens(owner, med));
      expect(
        delegated.find((p: { id: string }) => p.id === pen.id)
      ).not.toHaveProperty('prescription_id');
      await actor(delegate, () =>
        pens.updatePen(owner, pen.id, { notes: 'Synthetic delegate note' })
      );
      expect(await binding('medication_pens', pen.id)).toBe(record.id);
      await expect(
        actor(delegate, () =>
          pens.updatePen(owner, pen.id, { prescription_id: null })
        )
      ).rejects.toThrow();
      await expect(
        actor(delegate, () =>
          pens.updatePen(owner, pen.id, { prescription_id: record.id })
        )
      ).rejects.toThrow();
      const before = await admin(
        async (c) =>
          (
            await c.query(
              "SELECT to_jsonb(p)-'prescription_id'-'updated_at' AS value FROM medication_pens p WHERE id=$1",
              [pen.id]
            )
          ).rows[0]
      );
      await pens.updatePen(owner, pen.id, { prescription_id: null });
      expect(await binding('medication_pens', pen.id)).toBeNull();
      // Ordinary stock updates timestamp their metadata; physical/preparation snapshots stay unchanged.
      const physical = async () =>
        admin(
          async (c) =>
            (
              await c.query(
                'SELECT concentration_mg_ml::text,volume_ml::text,doses_used,status,opened_at,finished_at FROM medication_pens WHERE id=$1',
                [pen.id]
              )
            ).rows[0]
        );
      expect(await physical()).toMatchObject({
        concentration_mg_ml: '1',
        volume_ml: '2',
        doses_used: 0,
        status: 'sealed',
        opened_at: null,
        finished_at: null,
      });
      expect(
        await admin(
          async (c) =>
            (
              await c.query(
                "SELECT to_jsonb(p)-'prescription_id'-'updated_at' AS value FROM medication_pens p WHERE id=$1",
                [pen.id]
              )
            ).rows[0]
        )
      ).toEqual(before);
    });
    it('preserves and inherits omitted course bindings through owner Edit and delegated Revise, with explicit owner unlink', async () => {
      const med = await medication(),
        record = await create(med),
        made = await course(med, record.id);
      await editMedicationCourse(
        owner,
        made.course_id,
        {
          ...medicationCoursePlanFixture(),
          notes: 'Synthetic edit',
          expected_version: 1,
          operation_id: randomUUID(),
        },
        now
      );
      expect(
        await binding('medication_course_revisions', made.revision_id!)
      ).toBe(record.id);
      const hidden = await actor(delegate, () =>
        getMedicationCourse(owner, made.course_id)
      );
      for (const revision of hidden.course.revisions)
        expect(revision).not.toHaveProperty('prescription_id');
      const next = await successor(made.course_id, 2, delegate);
      expect(
        await binding('medication_course_revisions', next.revision_id!)
      ).toBe(record.id);
      const current = (
        await getMedicationCourse(owner, made.course_id)
      ).course.revisions.find((r) => r.id === next.revision_id)!;
      await expect(
        actor(delegate, () =>
          editMedicationCourse(
            owner,
            made.course_id,
            {
              ...medicationCoursePlanFixture(),
              start_date: current.start_date,
              expected_version: next.version,
              operation_id: randomUUID(),
              prescription_id: null,
            },
            now
          )
        )
      ).rejects.toThrow();
      await editMedicationCourse(
        owner,
        made.course_id,
        {
          ...medicationCoursePlanFixture(),
          start_date: current.start_date,
          expected_version: next.version,
          operation_id: randomUUID(),
          prescription_id: null,
        },
        now
      );
      expect(
        await binding('medication_course_revisions', next.revision_id!)
      ).toBeNull();
      expect(
        await binding('medication_course_revisions', made.revision_id!)
      ).toBe(record.id);
    });
    it('deletes only Rx links and private record while preserving stock, preparations, doses and immutable tombstoned course facts', async () => {
      const med = await medication(),
        record = await create(med, {
          refills_authorized: 5,
          refills_remaining: 2,
        }),
        pen = await stock(med, record.id),
        made = await course(med, record.id),
        next = await successor(made.course_id, 1);
      await entries.createEntry(owner, {
        medication_id: med,
        course_revision_id: made.revision_id,
        entry_date: '2026-11-05',
        status: 'taken',
      });
      await injections.createInjection(owner, {
        medication_id: med,
        pen_id: pen.id,
        course_revision_id: made.revision_id,
        dose_mg: 0.25,
        entry_date: '2026-11-05',
        injected_at: '2026-11-05T08:01:00Z',
        deduct_pen: true,
      });
      await deleteMedicationCourseRevision(
        owner,
        made.course_id,
        made.revision_id,
        { expected_version: next.version, operation_id: randomUUID() },
        now
      );
      expect(
        (await rx.getMedicationPrescription(owner, record.id)).refills_remaining
      ).toBe(2);
      const before = await children(true);
      await rx.deleteMedicationPrescription(owner, record.id, {
        operation_id: randomUUID(),
        expected_version: 1,
      });
      expect(await children(true)).toEqual(before);
      for (const id of [made.revision_id!, next.revision_id!])
        expect(await binding('medication_course_revisions', id)).toBeNull();
      expect(await binding('medication_pens', pen.id)).toBeNull();
      await expect(
        rx.getMedicationPrescription(owner, record.id)
      ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('permits genuine medication and account cleanup without losing known orphan names or blocking cascades', async () => {
      const med = await medication(),
        record = await create(med),
        made = await course(med, record.id);
      expect(await medications.deleteMedication(owner, med)).toBe(true);
      expect(
        (await getMedicationCourse(owner, made.course_id)).course.medication_id
      ).toBeNull();
      const inherited = await successor(made.course_id, made.version);
      expect(
        await binding('medication_course_revisions', inherited.revision_id!)
      ).toBe(record.id);
      expect(
        await binding('medication_course_revisions', made.revision_id!)
      ).toBe(record.id);
      const newTarget = await medication();
      await expect(stock(newTarget, record.id)).rejects.toThrow();
      await expect(course(newTarget, record.id)).rejects.toThrow();
      expect(
        await rx.getMedicationPrescription(owner, record.id)
      ).toMatchObject({
        medication_id: null,
        medication_name: 'Synthetic Rx target',
      });
      await expect(
        rx.updateMedicationPrescription(owner, record.id, {
          operation_id: randomUUID(),
          expected_version: 1,
          medication_id: await medication(),
        })
      ).rejects.toThrow();
      const account = randomUUID();
      accounts.push(account);
      await user(account);
      const target = await medication(account),
        bound = await actor(account, () =>
          rx.createMedicationPrescription(account, input(target))
        );
      await actor(account, () =>
        pens.createPen(account, target, {
          kind: 'pen',
          dose_mg: 1,
          doses_total: 3,
          prescription_id: bound.id,
        })
      );
      await actor(account, () =>
        createMedicationCourse(
          account,
          {
            ...medicationCoursePlanFixture(),
            medication_id: target,
            prescription_id: bound.id,
            expected_version: 0,
            operation_id: randomUUID(),
            native_reminder_limitation_acknowledged: false,
          },
          now
        )
      );
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [account])
      );
      for (const table of [
        'medication_prescriptions',
        'medication_prescription_operations',
        'medication_pens',
        'medication_courses',
        'medication_course_revisions',
      ])
        expect(await rows(table, false, account)).toEqual([]);
    });
    it('serializes concurrent link versus Rx delete without dangling links or physical mutation', async () => {
      const med = await medication(),
        record = await create(med),
        pen = await stock(med);
      const before = await admin(
        async (c) =>
          (
            await c.query(
              "SELECT to_jsonb(p)-'prescription_id'-'updated_at' AS value FROM medication_pens p WHERE id=$1",
              [pen.id]
            )
          ).rows[0]
      );
      const results = await Promise.allSettled([
        pens.updatePen(owner, pen.id, { prescription_id: record.id }),
        rx.deleteMedicationPrescription(owner, record.id, {
          operation_id: randomUUID(),
          expected_version: 1,
        }),
      ]);
      expect(results[1]!.status).toBe('fulfilled');
      expect(await binding('medication_pens', pen.id)).toBeNull();
      expect(
        await admin(
          async (c) =>
            (
              await c.query(
                "SELECT to_jsonb(p)-'prescription_id'-'updated_at' AS value FROM medication_pens p WHERE id=$1",
                [pen.id]
              )
            ).rows[0]
        )
      ).toEqual(before);
    });
  }
);
