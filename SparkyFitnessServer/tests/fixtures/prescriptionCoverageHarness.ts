import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { expect } from 'vitest';
import {
  medicationPrescriptionCreateSchemaV2,
  type MedicationPrescriptionCreateV2,
} from '@workspace/shared';
import {
  dbContextStorage,
  getClient,
  getSystemClient,
} from '../../db/poolManager.js';
import * as rx from '../../models/medicationPrescriptionRepository.js';
import * as pens from '../../models/medicationPenRepository.js';
import { createMedicationCourse } from '../../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './medicationCourseFixture.js';

/** Synthetic-only helpers shared by the real-database prescription coverage tests. */
export function prescriptionCoverageHarness(label: string) {
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
  /** Runs as the application role under row security, as the given signed-in actor. */
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
        [id, `synthetic-${label}-${id}@example.test`]
      )
    );
  const setup = async () => {
    expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
    for (const id of accounts) await user(id);
    await admin((c) =>
      c.query(
        "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,'{\"can_manage_medications\":true}'::jsonb,$3,'active')",
        [owner, delegate, `synthetic-${delegate}@example.test`]
      )
    );
  };
  const teardown = async () => {
    await admin((c) =>
      c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [accounts])
    );
  };
  const medication = async (name = 'Synthetic Rx target', who = owner) =>
    admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            "INSERT INTO medications(user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,$2,'injection','subcutaneous',1,'mg',false) RETURNING id",
            [who, name]
          )
        ).rows[0]!.id
    );
  const input = (
    medication_ids: string[],
    patch: Partial<MedicationPrescriptionCreateV2> = {}
  ) =>
    medicationPrescriptionCreateSchemaV2.parse({
      ...(medication_ids.length === 1
        ? { medication_id: medication_ids[0] }
        : { medication_ids }),
      operation_id: randomUUID(),
      currency: 'AUD',
      ...patch,
    });
  const create = (
    ids: string[],
    patch: Partial<MedicationPrescriptionCreateV2> = {},
    who = owner
  ) =>
    actor(who, () => rx.createMedicationPrescription(who, input(ids, patch)));
  const version = async (id: string) =>
    (await rx.getMedicationPrescription(owner, id, undefined, 2)).version;
  /** A model 2 update that reads the current version first. */
  const edit = async (
    id: string,
    patch: Record<string, unknown>,
    expected?: number
  ) =>
    rx.updateMedicationPrescription(owner, id, {
      operation_id: randomUUID(),
      expected_version: expected ?? (await version(id)),
      ...patch,
    });
  const read = (id: string) =>
    rx.getMedicationPrescription(owner, id, undefined, 2);
  const stock = async (med: string, prescription_id?: string | null) =>
    pens.createPen(owner, med, {
      kind: 'vial',
      label: 'Synthetic Rx stock',
      label_mass_mg: '10',
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
  const coverage = async (id: string) =>
    admin(
      async (c) =>
        (
          await c.query<{
            id: string;
            medication_id: string | null;
            medication_name_snapshot: string;
            position: number;
          }>(
            'SELECT id,medication_id,medication_name_snapshot,position FROM medication_prescription_medications WHERE prescription_id=$1 ORDER BY position,created_at,id',
            [id]
          )
        ).rows
    );
  const mirror = async (id: string) =>
    admin(
      async (c) =>
        (
          await c.query<{ medication_id: string | null }>(
            'SELECT medication_id FROM medication_prescriptions WHERE id=$1',
            [id]
          )
        ).rows[0]?.medication_id
    );
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
        ).rows[0]?.prescription_id
    );
  return {
    owner,
    other,
    delegate,
    accounts,
    now,
    admin,
    actor,
    sql,
    user,
    setup,
    teardown,
    medication,
    input,
    create,
    edit,
    read,
    version,
    stock,
    course,
    coverage,
    mirror,
    binding,
  };
}
