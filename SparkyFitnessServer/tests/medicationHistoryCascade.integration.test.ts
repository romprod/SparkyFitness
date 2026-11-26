import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import medications from '../models/medicationRepository.js';
import { createMedicationPrescription } from '../models/medicationPrescriptionRepository.js';
import { medicationPrescriptionCreateSchemaV2 } from '@workspace/shared';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';
import { saveSyringe } from '../models/medicationSyringeRepository.js';

// The repository refuses a medicine that is in use, so tests of what the database does
// when one goes (cascades, SET NULL, retained history) delete it directly.
async function rawDeleteMedication(id: string) {
  const client = await getSystemClient();
  try {
    const result = await client.query('DELETE FROM medications WHERE id=$1', [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

// Explicit opt-in for a fresh isolated synthetic database only, never production.
describe.runIf(process.env.MEDICATION_CASCADE_INTEGRATION === '1')(
  'medication history FK cleanup and preparation scope',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    const cleanupOwner = randomUUID();
    const preparation = {
      mode: 'reconstituted' as const,
      mass_value: 3,
      mass_unit: 'mg' as const,
      final_volume_ml: 3,
      prepared_date: '2026-11-15',
    };
    beforeAll(async () => {
      const client = await getSystemClient();
      try {
        for (const id of [owner, other, cleanupOwner])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `cascade-${id}@example.test`]
          );
      } finally {
        client.release();
      }
    });
    afterAll(async () => {
      const client = await getSystemClient();
      try {
        await client.query(
          'DELETE FROM public."user" WHERE id=ANY($1::uuid[])',
          [[owner, other, cleanupOwner]]
        );
      } finally {
        client.release();
        await endPool();
      }
    });

    async function fixture(
      kind: 'manual' | 'prepared' | 'calculated',
      userId = owner
    ) {
      const medication = await medications.createMedication(userId, {
        name: 'Synthetic cascade fixture',
        type_id: 'injection',
      });
      const vial = await stock.createPen(userId, medication.id, {
        kind: 'vial',
        ...(kind === 'manual' ? {} : { preparation }),
      });
      const syringe = await saveSyringe(userId, {
        name: 'Synthetic syringe',
        graduation_type: 'units',
        units_per_ml: 100,
        capacity_ml: '1',
        capacity_units: 100,
        increment: '1',
      });
      const log = await injections.createInjection(userId, {
        medication_id: medication.id,
        pen_id: vial.id,
        deduct_pen: true,
        injected_at: '2026-11-15T12:34:56.789Z',
        entry_date: '2026-11-14',
        notes: 'Synthetic preserved history',
        site: 'Synthetic site',
        ...(kind === 'calculated'
          ? {
              calculated_draw: {
                syringe_id: syringe.id,
                dose: { value: '0.1', unit: 'mg' as const },
              },
            }
          : { dose_mg: 0.1 }),
      });
      return { medication, vial, syringe, log };
    }
    async function history(userId: string, id: string) {
      const client = await getClient(userId);
      try {
        return (
          await client.query(
            `SELECT id,user_id,medication_id,pen_id,preparation_id,
             dose_mg::text,volume_ml::text,syringe_units::text,dose_input_unit,
             syringe_id,injected_at::text,entry_date::text,site,notes
             FROM injection_entries WHERE id=$1 AND user_id=$2`,
            [id, userId]
          )
        ).rows[0];
      } finally {
        client.release();
      }
    }

    it('the repository refuses a medicine with a logged dose and deletes an unused one', async () => {
      const { medication, log } = await fixture('manual');
      await expect(
        medications.deleteMedication(owner, medication.id)
      ).rejects.toMatchObject({
        statusCode: 409,
        in_use: {
          stock: 1,
          plans: 0,
          schedules: 0,
          prescriptions: 0,
          doses: 1,
        },
      });
      expect((await history(owner, log.id)).medication_id).toBe(medication.id);
      const unused = await medications.createMedication(owner, {
        name: 'Synthetic unused medicine',
        type_id: 'injection',
      });
      expect(await medications.deleteMedication(owner, unused.id)).toBe(true);
    });
    it('refuses a medicine covered only as the second medicine on a prescription, and deletes it once it is off', async () => {
      const first = await medications.createMedication(owner, {
        name: 'Synthetic first covered medicine',
        type_id: 'injection',
      });
      const second = await medications.createMedication(owner, {
        name: 'Synthetic second covered medicine',
        type_id: 'injection',
      });
      const made = await createMedicationPrescription(
        owner,
        medicationPrescriptionCreateSchemaV2.parse({
          medication_ids: [first.id, second.id],
          operation_id: randomUUID(),
          currency: 'AUD',
        })
      );
      // The deprecated primary column only mirrors the first medicine, so this
      // medicine is on the prescription through its coverage row alone.
      await expect(
        medications.deleteMedication(owner, second.id)
      ).rejects.toMatchObject({
        statusCode: 409,
        in_use: {
          stock: 0,
          plans: 0,
          schedules: 0,
          prescriptions: 1,
          doses: 0,
        },
      });
      const client = await getClient(owner);
      try {
        const left = await client.query(
          'SELECT 1 FROM medications WHERE id=$1 AND user_id=$2',
          [second.id, owner]
        );
        expect(left.rowCount).toBe(1);
        // Taken off the prescription (as its owner), it is no longer in use.
        await client.query(
          'DELETE FROM medication_prescription_medications WHERE prescription_id=$1 AND medication_id=$2',
          [made.id, second.id]
        );
      } finally {
        client.release();
      }
      expect(await medications.deleteMedication(owner, second.id)).toBe(true);
    });
    it.each(['manual', 'prepared', 'calculated'] as const)(
      'normal medication deletion preserves %s injection history and clears only nullable links',
      async (kind) => {
        const { medication, vial, log } = await fixture(kind);
        const before = await history(owner, log.id);
        expect(await rawDeleteMedication(medication.id)).toBe(true);
        const after = await history(owner, log.id);
        expect(after).toEqual({
          ...before,
          medication_id: null,
          pen_id: null,
          preparation_id: null,
        });
        const client = await getSystemClient();
        try {
          expect(
            (
              await client.query('SELECT 1 FROM medication_pens WHERE id=$1', [
                vial.id,
              ])
            ).rows
          ).toHaveLength(0);
          expect(
            (
              await client.query(
                'SELECT 1 FROM medication_preparations WHERE pen_id=$1',
                [vial.id]
              )
            ).rows
          ).toHaveLength(0);
        } finally {
          client.release();
        }
      }
    );

    it('allows unused vial removal but rejects direct used-vial and used-preparation removal', async () => {
      const { medication, vial, log } = await fixture('calculated');
      const before = await history(owner, log.id);
      const unused = await stock.createPen(owner, medication.id, {
        kind: 'vial',
        preparation,
      });
      expect(await stock.deletePen(owner, unused.id)).toBe(true);
      await expect(stock.deletePen(owner, vial.id)).rejects.toThrow(
        'cannot be removed'
      );
      const client = await getClient(owner);
      try {
        await expect(
          client.query('DELETE FROM medication_pens WHERE id=$1', [vial.id])
        ).rejects.toThrow('cannot be removed');
        await expect(
          client.query('DELETE FROM medication_preparations WHERE id=$1', [
            before.preparation_id,
          ])
        ).rejects.toThrow('cannot be removed');
      } finally {
        client.release();
      }
      expect(await history(owner, log.id)).toEqual(before);
    });

    it('rejects ordinary preparation/stock detachment and forged owner, medication or vial relationships', async () => {
      const { medication, vial, log } = await fixture('calculated');
      const foreign = await fixture('calculated', other);
      const wrongMedication = await fixture('calculated');
      const wrongVial = await stock.createPen(owner, medication.id, {
        kind: 'vial',
        preparation,
      });
      const before = await history(owner, log.id);
      const client = await getClient(owner);
      try {
        for (const field of [
          'preparation_id',
          'pen_id',
          'medication_id',
        ] as const)
          await expect(
            client.query(
              `UPDATE injection_entries SET ${field}=NULL WHERE id=$1`,
              [log.id]
            )
          ).rejects.toThrow('cannot be detached');
        for (const [field, id] of [
          ['preparation_id', foreign.log.preparation_id],
          ['preparation_id', wrongMedication.log.preparation_id],
          ['medication_id', wrongMedication.medication.id],
          ['pen_id', wrongVial.id],
          ['user_id', other],
        ])
          await expect(
            client.query(
              `UPDATE injection_entries SET ${field}=$2 WHERE id=$1`,
              [log.id, id]
            )
          ).rejects.toThrow();
        await expect(
          client.query(
            `INSERT INTO injection_entries(medication_id,user_id,pen_id,preparation_id,dose_mg)
             VALUES($1,$2,$3,$4,1)`,
            [medication.id, owner, vial.id, foreign.log.preparation_id]
          )
        ).rejects.toThrow('does not belong');
      } finally {
        client.release();
      }
      expect(await history(owner, log.id)).toEqual(before);
    });

    it('does not treat arbitrary nested trigger execution as proof of parent deletion', async () => {
      const { log } = await fixture('calculated');
      const before = await history(owner, log.id);
      const client = await getClient(owner);
      try {
        await client.query('BEGIN');
        await client.query(
          'CREATE TEMP TABLE preparation_cleanup_probe(id uuid) ON COMMIT DROP'
        );
        await client.query(`CREATE FUNCTION pg_temp.preparation_cleanup_probe() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            UPDATE public.injection_entries SET pen_id=NULL WHERE id=NEW.id;
            RETURN NEW;
          END $$`);
        await client.query(`CREATE TRIGGER preparation_cleanup_probe AFTER INSERT ON preparation_cleanup_probe
          FOR EACH ROW EXECUTE FUNCTION pg_temp.preparation_cleanup_probe()`);
        await expect(
          client.query('INSERT INTO preparation_cleanup_probe(id) VALUES($1)', [
            log.id,
          ])
        ).rejects.toThrow('cannot be detached');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await history(owner, log.id)).toEqual(before);
    });

    it('allows real account deletion cascades and does not leave linked records behind', async () => {
      const { medication, vial, log } = await fixture(
        'calculated',
        cleanupOwner
      );
      const client = await getSystemClient();
      try {
        await client.query('DELETE FROM public."user" WHERE id=$1', [
          cleanupOwner,
        ]);
        for (const [table, id] of [
          ['medications', medication.id],
          ['medication_pens', vial.id],
          ['injection_entries', log.id],
        ])
          expect(
            (await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id]))
              .rows
          ).toHaveLength(0);
      } finally {
        client.release();
      }
    });

    it('pins a fixed search path and a definer role able to see physical parents', async () => {
      const client = await getSystemClient();
      try {
        const result =
          await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,r.rolsuper,r.rolbypassrls,
          NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (
            'public.medications'::regclass,'public.medication_pens'::regclass,
            'public.medication_preparations'::regclass,'public."user"'::regclass,
            'public.injection_entries'::regclass)
            AND (c.relowner<>p.proowner OR c.relforcerowsecurity)) AS owns_non_forced_parents
          FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
          WHERE p.oid IN ('public.check_injection_preparation_scope()'::regprocedure,
                        'public.protect_used_medication_vial()'::regprocedure)`);
        expect(result.rows).toHaveLength(2);
        for (const row of result.rows) {
          expect(row.prosecdef).toBe(true);
          expect(
            row.rolsuper || row.rolbypassrls || row.owns_non_forced_parents
          ).toBe(true);
          expect(row.proconfig).toContain(
            'search_path=pg_catalog, public, pg_temp'
          );
        }
      } finally {
        client.release();
      }
    });
  }
);
