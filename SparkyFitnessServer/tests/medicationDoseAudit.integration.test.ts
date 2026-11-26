import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getClient, getSystemClient } from '../db/poolManager.js';
import medications from '../models/medicationRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';
import entries from '../models/medicationEntryRepository.js';
import * as packs from '../models/medicationPackRepository.js';
import { saveSyringe } from '../models/medicationSyringeRepository.js';
import {
  commitPreparationCorrection,
  reviewPreparationCorrection,
} from '../models/medicationPreparationCorrectionRepository.js';
import customNutrientService from '../services/customNutrientService.js';
import {
  createMedicationCourse,
  deleteMedicationCourseRevision,
  getMedicationCourse,
} from '../services/medicationCourseService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

// The trigger runs below every writer, so these tests call the real repository
// functions against a real database. Explicit opt-in, isolated synthetic database
// only, never production.
const MIGRATION = fileURLToPath(
  new URL(
    '../db/migrations/20261126170000_medication_dose_audit.sql',
    import.meta.url
  )
);

// What the audit snapshot leaves out on purpose.
const BOOKKEEPING = [
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'custom_fields',
  'nutrients_snapshot',
  'pack_id',
  'pack_units_deducted',
  'course_revision_id',
  'course_rule_id',
  'course_step_id',
  'course_slot_key',
  'course_origin',
  'scheduled_day',
  'phase_family_id',
];

type AuditRow = {
  action: string;
  actor_user_id: string | null;
  user_id: string;
  entity_kind: string;
  entity_id: string;
  medication_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

describe.runIf(process.env.MEDICATION_DOSE_AUDIT_INTEGRATION === '1')(
  'dose audit log in isolated PostgreSQL',
  () => {
    const owner = randomUUID();
    const caregiver = randomUUID();
    const reportsOnly = randomUUID();
    const doomed = [randomUUID(), randomUUID()];
    const allUsers = [owner, caregiver, reportsOnly, ...doomed];
    let tabletMed: string;

    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const asApp = async <T>(
      userId: string,
      authenticatedUserId: string | undefined,
      work: (client: PoolClient) => Promise<T>
    ) => {
      const client = await getClient(userId, authenticatedUserId);
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const auditOf = async (entityId: string) =>
      (
        await admin((c) =>
          c.query(
            `SELECT action, actor_user_id, user_id, entity_kind, entity_id, medication_id, old_values, new_values
               FROM medication_dose_audit WHERE entity_id=$1 ORDER BY changed_at, id`,
            [entityId]
          )
        )
      ).rows as AuditRow[];
    const auditCount = async (userId: string) =>
      (
        await admin((c) =>
          c.query(
            'SELECT count(*)::int n FROM medication_dose_audit WHERE user_id=$1',
            [userId]
          )
        )
      ).rows[0].n as number;
    const penUsed = async (penId: string) =>
      (
        await admin((c) =>
          c.query('SELECT doses_used FROM medication_pens WHERE id=$1', [penId])
        )
      ).rows[0].doses_used as number;
    const rawEntry = (
      client: PoolClient,
      userId: string = owner,
      name = 'raw'
    ) =>
      client.query(
        `INSERT INTO medication_entries (user_id,status,med_name_snapshot) VALUES ($1,'taken',$2) RETURNING id`,
        [userId, name]
      );

    async function injectionFixture(
      kind: 'manual' | 'prepared' | 'calculated',
      dose: Record<string, unknown> = {}
    ) {
      const medication = await medications.createMedication(owner, {
        name: 'Synthetic audit fixture',
        type_id: 'injection',
      });
      const vial = await stock.createPen(owner, medication.id, {
        kind: 'vial',
        ...(kind === 'manual'
          ? {}
          : {
              preparation: {
                mode: 'reconstituted' as const,
                mass_value: 10,
                mass_unit: 'mg' as const,
                final_volume_ml: 2,
                prepared_date: '2026-11-15',
              },
            }),
      });
      const syringe = await saveSyringe(owner, {
        name: 'Synthetic audit syringe',
        graduation_type: 'units',
        units_per_ml: 100,
        capacity_ml: '1',
        capacity_units: 100,
        increment: '1',
      });
      const log = await injections.createInjection(owner, {
        medication_id: medication.id,
        pen_id: vial.id,
        deduct_pen: true,
        injected_at: '2026-11-15T12:34:56.789Z',
        entry_date: '2026-11-14',
        notes: 'Synthetic note',
        site: 'Synthetic site A',
        ...(kind === 'calculated'
          ? {
              calculated_draw: {
                syringe_id: syringe.id,
                dose: { value: '1', unit: 'mg' as const },
              },
            }
          : { dose_mg: 0.1 }),
        ...dose,
      } as never);
      return { medication, vial, syringe, log };
    }

    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of allUsers)
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `dose-audit-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'UTC',14,3)",
          [owner]
        );
        for (const [user, perms] of [
          [caregiver, { can_manage_medications: true }],
          [reportsOnly, { can_view_reports: true }],
        ] as const)
          await c.query(
            `INSERT INTO public.family_access (owner_user_id,family_user_id,family_email,access_permissions,is_active,status)
             VALUES ($1,$2,$3,$4::jsonb,true,'active')`,
            [
              owner,
              user,
              `dose-audit-fam-${user}@example.test`,
              JSON.stringify(perms),
            ]
          );
        tabletMed = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id,dose_amount,dose_unit,is_supplement) VALUES($1,'Synthetic audit tablet','tablet',2,'tablet',false) RETURNING id",
            [owner]
          )
        ).rows[0].id;
      });
    });
    afterAll(async () => {
      await admin(async (c) => {
        await c.query(
          'ALTER TABLE public.medication_dose_audit DROP CONSTRAINT IF EXISTS zz_force_audit_failure'
        );
        await c.query(
          'ALTER TABLE public.medication_entries ENABLE TRIGGER medication_dose_audit_entry'
        );
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          allUsers,
        ]);
      });
      await endPool();
    });

    it('1. applying the migration again leaves one of each function, the four triggers and the two indexes', async () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      await admin(async (c) => {
        await c.query(sql);
        await c.query(sql);
        const fns = await c.query(
          `SELECT proname, count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace
            AND proname IN ('record_medication_dose_audit','protect_medication_dose_audit','medication_dose_audit_snapshot','medication_dose_audit_text')
            GROUP BY proname ORDER BY proname`
        );
        expect(fns.rows).toEqual([
          { proname: 'medication_dose_audit_snapshot', n: 1 },
          { proname: 'medication_dose_audit_text', n: 1 },
          { proname: 'protect_medication_dose_audit', n: 1 },
          { proname: 'record_medication_dose_audit', n: 1 },
        ]);
        const triggers = await c.query(
          `SELECT tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'medication_dose_audit_%' ORDER BY tgname`
        );
        expect(triggers.rows).toEqual([
          { tgname: 'medication_dose_audit_entry', tgenabled: 'O' },
          { tgname: 'medication_dose_audit_immutable', tgenabled: 'O' },
          { tgname: 'medication_dose_audit_injection', tgenabled: 'O' },
          { tgname: 'medication_dose_audit_insert_guard', tgenabled: 'O' },
        ]);
        const indexes = await c.query(
          `SELECT indexname FROM pg_indexes WHERE tablename='medication_dose_audit' ORDER BY indexname`
        );
        expect(indexes.rows.map((r) => r.indexname)).toEqual([
          'medication_dose_audit_entity',
          'medication_dose_audit_pkey',
          'medication_dose_audit_recent',
        ]);
        const rls = await c.query(
          `SELECT relrowsecurity FROM pg_class WHERE oid='public.medication_dose_audit'::regclass`
        );
        expect(rls.rows[0].relrowsecurity).toBe(true);
      });
    });

    it('2. createInjection writes one create row with the dose fields, not the bookkeeping ones, and the pen counter moves as before', async () => {
      const { medication, vial, log } = await injectionFixture('manual');
      expect(await penUsed(vial.id)).toBe(1);
      const rows = await auditOf(log.id);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({
        action: 'create',
        actor_user_id: owner,
        user_id: owner,
        entity_kind: 'injection',
        entity_id: log.id,
        medication_id: medication.id,
        old_values: null,
      });
      const values = row.new_values!;
      expect(values).toMatchObject({
        medication_id: medication.id,
        pen_id: vial.id,
        site: 'Synthetic site A',
        notes: 'Synthetic note',
        source: 'manual',
        entry_date: '2026-11-14',
        // numbers are written as text, and times in UTC whatever the session says
        dose_mg: '0.1',
        injected_at: '2026-11-15T12:34:56.789+00:00',
      });
      for (const key of ['preparation_id', 'syringe_id', 'volume_ml'])
        expect(values).toHaveProperty(key);
      for (const key of BOOKKEEPING) expect(values).not.toHaveProperty(key);

      // a session in another time zone still writes the instant in UTC
      const zoned = await asApp(owner, undefined, async (c) => {
        await c.query("SET TIME ZONE 'America/New_York'");
        try {
          return (
            await c.query(
              `INSERT INTO injection_entries (user_id,medication_id,dose_mg,site,injected_at)
               VALUES ($1,$2,0.1,'s','2026-11-15T07:34:56.789-05:00') RETURNING id`,
              [owner, medication.id]
            )
          ).rows[0].id as string;
        } finally {
          await c.query('RESET TIME ZONE');
        }
      });
      expect((await auditOf(zoned))[0].new_values!.injected_at).toBe(
        '2026-11-15T12:34:56.789+00:00'
      );
    });

    it('3. updateInjection: a site change writes only the site, a note change one row, no-ops none', async () => {
      const { log } = await injectionFixture('manual');
      await injections.updateInjection(owner, log.id, {});
      expect(await auditOf(log.id)).toHaveLength(1);

      await injections.updateInjection(owner, log.id, {
        site: 'Synthetic site B',
      });
      let rows = await auditOf(log.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        action: 'edit',
        actor_user_id: owner,
        old_values: { site: 'Synthetic site A' },
        new_values: { site: 'Synthetic site B' },
      });

      await injections.updateInjection(owner, log.id, {
        notes: 'Changed note',
      });
      rows = await auditOf(log.id);
      expect(rows).toHaveLength(3);
      expect(rows[2].old_values).toEqual({ notes: 'Synthetic note' });
      expect(rows[2].new_values).toEqual({ notes: 'Changed note' });

      // the same value again touches only updated_at: nothing to record
      await injections.updateInjection(owner, log.id, {
        site: 'Synthetic site B',
      });
      // custom fields are bookkeeping
      await injections.updateInjection(owner, log.id, {
        custom_fields: { synthetic: 'value' },
      });
      expect(await auditOf(log.id)).toHaveLength(3);
    });

    it('4. editCalculatedInjection: a changed dose is one row; a note alone is one row with only the note', async () => {
      const { log, syringe } = await injectionFixture('calculated');
      const created = (await auditOf(log.id))[0].new_values!;
      expect(Number(created.dose_mg)).toBe(1);
      expect(Number(created.volume_ml)).toBeCloseTo(0.2);

      await injections.updateInjection(owner, log.id, {
        calculated_draw: {
          syringe_id: syringe.id,
          dose: { value: '2', unit: 'mg' },
        },
      } as never);
      let rows = await auditOf(log.id);
      expect(rows).toHaveLength(2);
      expect(rows[1].action).toBe('edit');
      expect(Number(rows[1].old_values!.dose_mg)).toBe(1);
      expect(Number(rows[1].new_values!.dose_mg)).toBe(2);
      expect(Number(rows[1].new_values!.volume_ml)).toBeCloseTo(0.4);
      expect(Object.keys(rows[1].new_values!)).not.toContain('updated_at');

      await injections.updateInjection(owner, log.id, {
        calculated_draw: {
          syringe_id: syringe.id,
          dose: { value: '2', unit: 'mg' },
        },
        notes: 'Calculated note only',
      } as never);
      rows = await auditOf(log.id);
      expect(rows).toHaveLength(3);
      expect(rows[2].old_values).toEqual({ notes: 'Synthetic note' });
      expect(rows[2].new_values).toEqual({ notes: 'Calculated note only' });
    });

    it('5. deleteInjection writes one delete row holding the whole dose, which outlives it, and the pen is credited back', async () => {
      const { vial, log } = await injectionFixture('manual');
      const before = (
        await admin((c) =>
          c.query(
            'SELECT dose_mg::text, site, notes, injected_at, pen_id, medication_id FROM injection_entries WHERE id=$1',
            [log.id]
          )
        )
      ).rows[0];
      expect(await injections.deleteInjection(owner, log.id)).toBe(true);
      expect(await penUsed(vial.id)).toBe(0);
      const rows = await auditOf(log.id);
      expect(rows.map((r) => r.action)).toEqual(['create', 'delete']);
      expect(rows[1].new_values).toBeNull();
      expect(rows[1].old_values).toMatchObject({
        dose_mg: before.dose_mg,
        site: before.site,
        notes: before.notes,
        pen_id: before.pen_id,
        medication_id: before.medication_id,
      });
      expect(rows[1].old_values).toEqual(rows[0].new_values);
      expect(
        (
          await admin((c) =>
            c.query('SELECT 1 FROM injection_entries WHERE id=$1', [log.id])
          )
        ).rowCount
      ).toBe(0);
      // a second delete finds nothing and writes nothing
      expect(await injections.deleteInjection(owner, log.id)).toBe(false);
      expect(await auditOf(log.id)).toHaveLength(2);
    });

    it('6. createEntry, updateEntry and deleteEntry write create, edit and delete rows', async () => {
      const entry = await entries.createEntry(owner, {
        medication_id: tabletMed,
        status: 'taken',
        dose_amount_snapshot: 1,
        dose_unit_snapshot: 'tablet',
        deduct_pack: false,
        notes: 'Synthetic entry note',
      } as never);
      let rows = await auditOf(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'create',
        entity_kind: 'entry',
        actor_user_id: owner,
        medication_id: tabletMed,
        old_values: null,
        new_values: {
          status: 'taken',
          med_name_snapshot: 'Synthetic audit tablet',
          dose_unit_snapshot: 'tablet',
          notes: 'Synthetic entry note',
          source: 'manual',
        },
      });
      for (const key of BOOKKEEPING)
        expect(rows[0].new_values).not.toHaveProperty(key);

      await entries.updateEntry(owner, entry.id, {
        status: 'skipped',
      } as never);
      rows = await auditOf(entry.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        action: 'edit',
        old_values: { status: 'taken' },
        new_values: { status: 'skipped' },
      });

      await entries.updateEntry(owner, entry.id, { notes: 'Edited' } as never);
      expect(await auditOf(entry.id)).toHaveLength(3);

      expect(await entries.deleteEntry(owner, entry.id)).toBe(true);
      rows = await auditOf(entry.id);
      expect(rows.map((r) => r.action)).toEqual([
        'create',
        'edit',
        'edit',
        'delete',
      ]);
      expect(rows[3].new_values).toBeNull();
      expect(rows[3].old_values).toMatchObject({
        status: 'skipped',
        notes: 'Edited',
      });
    });

    it('7. bookkeeping writes no row: pack link set and cleared, nutrient history purge, course link clears, custom fields', async () => {
      // pack deduction sets pack_id after the INSERT; a status change clears it
      const pack = (await packs.createPack(owner, tabletMed, {
        unit_label: 'tablets',
        units_total: 60,
        status: 'in_use',
      }))!;
      const taken = await entries.createEntry(owner, {
        medication_id: tabletMed,
        status: 'taken',
        dose_amount_snapshot: 2,
        dose_unit_snapshot: 'tablet',
      } as never);
      expect(taken.pack_deduction).toMatchObject({ deducted: true });
      const linked = (
        await admin((c) =>
          c.query(
            'SELECT pack_id, pack_units_deducted::text u FROM medication_entries WHERE id=$1',
            [taken.id]
          )
        )
      ).rows[0];
      expect(linked.pack_id).toBe(pack);
      let rows = await auditOf(taken.id);
      expect(rows).toHaveLength(1);
      await entries.updateEntry(owner, taken.id, {
        status: 'skipped',
      } as never);
      expect(
        (
          await admin((c) =>
            c.query('SELECT pack_id FROM medication_entries WHERE id=$1', [
              taken.id,
            ])
          )
        ).rows[0].pack_id
      ).toBeNull();
      rows = await auditOf(taken.id);
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[1].new_values!)).toEqual(['status']);
      await entries.deleteEntry(owner, taken.id);
      await packs.deletePack(owner, pack);

      // purge of a custom nutrient from the supplement snapshots
      const supplement = (
        await admin((c) =>
          c.query(
            `INSERT INTO medications(user_id,name,type_id,dose_amount,dose_unit,is_supplement,nutrients)
             VALUES($1,'Synthetic audit supplement','tablet',1,'tablet',true,$2::jsonb) RETURNING id`,
            [
              owner,
              JSON.stringify({
                calories: 0,
                custom_nutrients: { 'Audit Zinc': 5 },
              }),
            ]
          )
        )
      ).rows[0].id;
      const nutrientId = (
        await admin((c) =>
          c.query(
            "INSERT INTO user_custom_nutrients(user_id,name,unit) VALUES($1,'Audit Zinc','mg') RETURNING id",
            [owner]
          )
        )
      ).rows[0].id;
      const supp = await entries.createEntry(owner, {
        medication_id: supplement,
        status: 'taken',
        dose_amount_snapshot: 1,
        dose_unit_snapshot: 'tablet',
        deduct_pack: false,
      } as never);
      const snapshotOf = async () =>
        (
          await admin((c) =>
            c.query(
              'SELECT nutrients_snapshot FROM medication_entries WHERE id=$1',
              [supp.id]
            )
          )
        ).rows[0].nutrients_snapshot;
      expect(JSON.stringify(await snapshotOf())).toContain('Audit Zinc');
      expect(
        await customNutrientService.deleteCustomNutrient(
          owner,
          nutrientId,
          true
        )
      ).toBe(true);
      expect(JSON.stringify(await snapshotOf())).not.toContain('Audit Zinc');
      expect(await auditOf(supp.id)).toHaveLength(1);

      // a real course revision is deleted: the course code clears the links on the doses
      const { log } = await injectionFixture('manual');
      const courseMed = (
        await admin((c) =>
          c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic audit course medicine','injection') RETURNING id",
            [owner]
          )
        )
      ).rows[0].id;
      const created = await createMedicationCourse(
        owner,
        {
          ...medicationCoursePlanFixture(),
          medication_id: courseMed,
          operation_id: randomUUID(),
          expected_version: 0,
          native_reminder_limitation_acknowledged: false,
        },
        new Date('2026-11-01T00:00:00Z')
      );
      const linked2 = await admin(async (c) => {
        const e = await c.query(
          "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,status,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id) VALUES($1,$2,'2026-11-05','2026-11-05T08:00:00Z','taken','Synthetic course dose',1,'mg',$3) RETURNING id",
          [owner, courseMed, created.revision_id]
        );
        const i = await c.query(
          "INSERT INTO injection_entries(user_id,medication_id,dose_mg,site,entry_date,injected_at,course_revision_id) VALUES($1,$2,1,'s','2026-11-06','2026-11-06T08:00:00Z',$3) RETURNING id",
          [owner, courseMed, created.revision_id]
        );
        return {
          entry: e.rows[0].id as string,
          injection: i.rows[0].id as string,
        };
      });
      const course = (await getMedicationCourse(owner, created.course_id))
        .course;
      await deleteMedicationCourseRevision(
        owner,
        created.course_id,
        created.revision_id!,
        { operation_id: randomUUID(), expected_version: course.version },
        new Date('2026-11-16T12:03:00Z')
      );
      const links = await admin((c) =>
        c.query(
          `SELECT (SELECT course_revision_id FROM medication_entries WHERE id=$1) e,
                  (SELECT course_revision_id FROM injection_entries WHERE id=$2) i`,
          [linked2.entry, linked2.injection]
        )
      );
      expect(links.rows[0]).toEqual({ e: null, i: null });
      expect((await auditOf(linked2.entry)).map((r) => r.action)).toEqual([
        'create',
      ]);
      expect((await auditOf(linked2.injection)).map((r) => r.action)).toEqual([
        'create',
      ]);
      expect((await auditOf(linked2.entry))[0].new_values).not.toHaveProperty(
        'course_revision_id'
      );

      // numbers equal in value (1.0 and 1.00) are not a change
      const scale = (
        await admin((c) =>
          c.query(
            `INSERT INTO injection_entries (user_id,medication_id,dose_mg,site) VALUES ($1,$2,1.0,'s') RETURNING id`,
            [owner, log.medication_id]
          )
        )
      ).rows[0].id;
      await admin((c) =>
        c.query('UPDATE injection_entries SET dose_mg=1.00 WHERE id=$1', [
          scale,
        ])
      );
      expect(await auditOf(scale)).toHaveLength(1);
      await admin((c) =>
        c.query('UPDATE injection_entries SET dose_mg=1.5 WHERE id=$1', [scale])
      );
      const after = await auditOf(scale);
      expect(after).toHaveLength(2);
      expect(after[1].new_values).toEqual({ dose_mg: '1.5' });
    });

    async function rawEntryAs(user: string) {
      return (await admin((c) => rawEntry(c, user))).rows[0] as { id: string };
    }

    it('8. real indirect changes are recorded: a preparation correction, and a syringe that goes away', async () => {
      const { vial, syringe, log, medication } =
        await injectionFixture('calculated');
      const input = {
        expected_revision: 0,
        preparation: {
          mode: 'reconstituted' as const,
          mass_value: '8',
          mass_unit: 'mg' as const,
          final_volume_ml: '2',
          prepared_date: '2026-11-15',
        },
      };
      const review = await reviewPreparationCorrection(owner, vial.id, input);
      await commitPreparationCorrection(owner, vial.id, {
        ...input,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      let rows = await auditOf(log.id);
      expect(rows.map((r) => r.action)).toEqual(['create', 'edit']);
      expect(Object.keys(rows[1].new_values!)).toEqual(['dose_mg']);
      expect(Number(rows[1].old_values!.dose_mg)).toBe(1);
      expect(Number(rows[1].new_values!.dose_mg)).toBeCloseTo(0.8);
      expect(rows[1].actor_user_id).toBe(owner);

      await admin((c) =>
        c.query('DELETE FROM medication_syringes WHERE id=$1', [syringe.id])
      );
      rows = await auditOf(log.id);
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({
        action: 'edit',
        actor_user_id: null,
        old_values: { syringe_id: syringe.id },
        new_values: { syringe_id: null },
      });

      // a medicine that goes away (its vial goes with it) likewise: one edit row per column
      await admin((c) =>
        c.query('DELETE FROM medications WHERE id=$1', [medication.id])
      );
      rows = await auditOf(log.id);
      const edits = rows.slice(3);
      expect(edits.length).toBeGreaterThan(0);
      expect(
        edits.every((r) => r.action === 'edit' && r.actor_user_id === null)
      ).toBe(true);
      expect(edits.map((r) => r.old_values)).toContainEqual(
        expect.objectContaining({ medication_id: medication.id })
      );
      expect(edits.map((r) => r.new_values)).toContainEqual(
        expect.objectContaining({ medication_id: null })
      );
      expect(edits.map((r) => r.old_values)).toContainEqual({
        pen_id: vial.id,
      });
      // the dose row survived, and so did the audit trail
      expect(
        (
          await admin((c) =>
            c.query('SELECT 1 FROM injection_entries WHERE id=$1', [log.id])
          )
        ).rowCount
      ).toBe(1);
    });

    it('9. the actor is the owner, the caregiver acting for them, or NULL on the owner pool', async () => {
      const own = await asApp(owner, undefined, async (c) => rawEntry(c));
      const forOwner = await asApp(owner, caregiver, async (c) => rawEntry(c));
      const system = await admin((c) => rawEntry(c));
      const actors = async (id: string) =>
        (await auditOf(id)).map((r) => r.actor_user_id);
      expect(await actors(own.rows[0].id)).toEqual([owner]);
      expect(await actors(forOwner.rows[0].id)).toEqual([caregiver]);
      expect(await actors(system.rows[0].id)).toEqual([null]);
      // user_id is still the owner for the caregiver's row
      expect((await auditOf(forOwner.rows[0].id))[0].user_id).toBe(owner);
      // and an edit and a delete by the caregiver
      await asApp(owner, caregiver, async (c) => {
        await c.query(
          "UPDATE medication_entries SET notes='by caregiver' WHERE id=$1",
          [forOwner.rows[0].id]
        );
        await c.query('DELETE FROM medication_entries WHERE id=$1', [
          forOwner.rows[0].id,
        ]);
      });
      expect(await actors(forOwner.rows[0].id)).toEqual([
        caregiver,
        caregiver,
        caregiver,
      ]);
    });

    it('10. a failing audit insert rolls back the dose and the pen counter; a rolled-back save leaves no row', async () => {
      const { medication, vial } = await injectionFixture('manual');
      await admin((c) =>
        c.query(
          'ALTER TABLE public.medication_dose_audit ADD CONSTRAINT zz_force_audit_failure CHECK (false) NOT VALID'
        )
      );
      try {
        const doses = async () =>
          (
            await admin((c) =>
              c.query(
                'SELECT count(*)::int n FROM injection_entries WHERE medication_id=$1',
                [medication.id]
              )
            )
          ).rows[0].n;
        const before = await doses();
        const used = await penUsed(vial.id);
        await expect(
          injections.createInjection(owner, {
            medication_id: medication.id,
            pen_id: vial.id,
            deduct_pen: true,
            dose_mg: 0.1,
            site: 'Synthetic fail',
          } as never)
        ).rejects.toThrow(/zz_force_audit_failure/);
        expect(await doses()).toBe(before);
        expect(await penUsed(vial.id)).toBe(used);
        await expect(
          entries.createEntry(owner, {
            medication_id: tabletMed,
            status: 'taken',
            notes: 'Synthetic fail entry',
            deduct_pack: false,
          } as never)
        ).rejects.toThrow(/zz_force_audit_failure/);
        expect(
          (
            await admin((c) =>
              c.query(
                "SELECT 1 FROM medication_entries WHERE notes='Synthetic fail entry'"
              )
            )
          ).rowCount
        ).toBe(0);
      } finally {
        await admin((c) =>
          c.query(
            'ALTER TABLE public.medication_dose_audit DROP CONSTRAINT zz_force_audit_failure'
          )
        );
      }
      // a rolled-back dose leaves no audit row
      const id = await asApp(owner, undefined, async (c) => {
        await c.query('BEGIN');
        const made = (await rawEntry(c, owner, 'rolled back')).rows[0].id;
        await c.query('ROLLBACK');
        return made as string;
      });
      expect(await auditOf(id)).toHaveLength(0);
    });

    it('11. nobody can write, change or remove audit rows directly, owner or delegate', async () => {
      const entry = await rawEntryAs(owner);
      const [row] = await auditOf(entry.id);
      expect(row).toBeDefined();
      const rowId = (
        await admin((c) =>
          c.query('SELECT id FROM medication_dose_audit WHERE entity_id=$1', [
            entry.id,
          ])
        )
      ).rows[0].id;
      const attempt = async (
        actor: string | undefined,
        sql: string,
        params: unknown[]
      ) =>
        asApp(owner, actor, async (c) => {
          await c.query('BEGIN');
          try {
            const res = await c.query(sql, params);
            return { ok: true, rowCount: res.rowCount ?? 0 };
          } catch (error) {
            return { ok: false, message: (error as Error).message };
          } finally {
            await c.query('ROLLBACK');
          }
        });
      const insert = `INSERT INTO medication_dose_audit (user_id,entity_kind,entity_id,action,new_values) VALUES ($1,'entry',$2,'create','{}'::jsonb)`;
      for (const actor of [undefined, caregiver]) {
        expect(
          await attempt(actor, insert, [owner, randomUUID()])
        ).toMatchObject({
          ok: false,
          message: expect.stringMatching(/written by the database only/),
        });
        expect(
          await attempt(
            actor,
            "UPDATE medication_dose_audit SET action='delete' WHERE id=$1",
            [rowId]
          )
        ).toMatchObject({
          ok: false,
          message: expect.stringMatching(/immutable/),
        });
        expect(
          await attempt(
            actor,
            "UPDATE medication_dose_audit SET new_values='{}'::jsonb WHERE id=$1",
            [rowId]
          )
        ).toMatchObject({
          ok: false,
          message: expect.stringMatching(/immutable/),
        });
        expect(
          await attempt(
            actor,
            'DELETE FROM medication_dose_audit WHERE id=$1',
            [rowId]
          )
        ).toMatchObject({
          ok: false,
          message: expect.stringMatching(/immutable/),
        });
      }
      // a delegate who may only view reports reads it, but cannot see a way to change it
      const viewOnly = async (sql: string, params: unknown[]) =>
        attempt(reportsOnly, sql, params);
      expect(await viewOnly(insert, [owner, randomUUID()])).toMatchObject({
        ok: false,
      });
      expect(
        await viewOnly(
          "UPDATE medication_dose_audit SET action='delete' WHERE id=$1",
          [rowId]
        )
      ).toEqual({ ok: true, rowCount: 0 });
      expect(
        await viewOnly('DELETE FROM medication_dose_audit WHERE id=$1', [rowId])
      ).toEqual({
        ok: true,
        rowCount: 0,
      });
      expect(
        await asApp(
          owner,
          reportsOnly,
          async (c) =>
            (
              await c.query(
                'SELECT id FROM medication_dose_audit WHERE id=$1',
                [rowId]
              )
            ).rowCount
        )
      ).toBe(1);
      // nothing moved
      expect((await auditOf(entry.id))[0]).toEqual(row);
    });

    it('12. deleting an account removes its doses and audit rows without error', async () => {
      const [first, second] = doomed;
      await admin(async (c) => {
        for (const user of doomed) {
          const med = (
            await c.query(
              "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic doomed','injection') RETURNING id",
              [user]
            )
          ).rows[0].id;
          await c.query(
            "INSERT INTO injection_entries(user_id,medication_id,dose_mg,site) VALUES($1,$2,0.5,'s')",
            [user, med]
          );
          await rawEntry(c, user);
          await c.query(
            "UPDATE medication_entries SET notes='edited' WHERE user_id=$1",
            [user]
          );
        }
      });
      expect(await auditCount(first)).toBe(3);
      // one account through the app role's own cascade shape, one in a single statement
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [first])
      );
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=$1', [second])
      );
      const left = await admin((c) =>
        c.query(
          `SELECT (SELECT count(*) FROM medication_dose_audit WHERE user_id=ANY($1::uuid[]))::int a,
                  (SELECT count(*) FROM injection_entries WHERE user_id=ANY($1::uuid[]))::int i,
                  (SELECT count(*) FROM medication_entries WHERE user_id=ANY($1::uuid[]))::int e`,
          [doomed]
        )
      );
      expect(left.rows[0]).toEqual({ a: 0, i: 0, e: 0 });
    });

    it('13. two concurrent dose saves for one owner both succeed without waiting on the user row', async () => {
      const one = await getClient(owner);
      const two = await getClient(owner);
      try {
        await one.query('BEGIN');
        await two.query('BEGIN');
        await two.query("SET LOCAL lock_timeout='2s'");
        const a = await rawEntry(one, owner, 'concurrent one');
        const b = await rawEntry(two, owner, 'concurrent two');
        // an ordinary update of the owner's row is not blocked by either open save
        await admin(async (c) => {
          await c.query("SET lock_timeout='2s'");
          await c.query(
            'UPDATE public."user" SET updated_at=now() WHERE id=$1',
            [owner]
          );
        });
        await one.query('COMMIT');
        await two.query('COMMIT');
        expect(await auditOf(a.rows[0].id)).toHaveLength(1);
        expect(await auditOf(b.rows[0].id)).toHaveLength(1);
      } finally {
        one.release();
        two.release();
      }
    });

    it('14. timing smoke: 1,000 inserts with and without the trigger (printed, not a gate)', async () => {
      const run = async () =>
        admin(async (c) => {
          const started = performance.now();
          await c.query(
            `INSERT INTO medication_entries (user_id,status,med_name_snapshot)
             SELECT $1,'taken','timing '||g FROM generate_series(1,1000) g`,
            [owner]
          );
          return performance.now() - started;
        });
      let without: number;
      await admin((c) =>
        c.query(
          'ALTER TABLE public.medication_entries DISABLE TRIGGER medication_dose_audit_entry'
        )
      );
      try {
        without = await run();
      } finally {
        await admin((c) =>
          c.query(
            'ALTER TABLE public.medication_entries ENABLE TRIGGER medication_dose_audit_entry'
          )
        );
      }
      const withTrigger = await run();
      const audited = (
        await admin((c) =>
          c.query(
            "SELECT count(*)::int n FROM medication_dose_audit a WHERE a.user_id=$1 AND a.new_values->>'med_name_snapshot' LIKE 'timing %'",
            [owner]
          )
        )
      ).rows[0].n;
      // only the second batch was audited
      expect(audited).toBe(1000);
      console.log(
        `dose audit timing: 1000 inserts without trigger ${without.toFixed(0)} ms, with trigger ${withTrigger.toFixed(0)} ms, ratio ${(withTrigger / without).toFixed(2)}`
      );
    }, 60_000);
  }
);
