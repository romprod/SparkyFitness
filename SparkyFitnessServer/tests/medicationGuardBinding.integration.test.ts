import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import medications from '../models/medicationRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';

// Explicit opt-in for an isolated synthetic database; no production identities.
describe.runIf(process.env.MEDICATION_GUARD_BINDING_INTEGRATION === '1')(
  'medication guard functions are bound to their intended contexts',
  () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    let medicationId: string;
    let vialId: string;
    let preparationId: string;
    let injectionId: string;
    beforeAll(async () => {
      const admin = await getSystemClient();
      try {
        for (const id of [owner, attacker])
          await admin.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `guard-binding-${id}@example.test`]
          );
      } finally {
        admin.release();
      }
      const medication = await medications.createMedication(owner, {
        name: 'Synthetic guard context fixture',
        type_id: 'injection',
      });
      const vial = await stock.createPen(owner, medication.id, {
        kind: 'vial',
        preparation: {
          mode: 'reconstituted',
          mass_value: 3,
          mass_unit: 'mg',
          final_volume_ml: 3,
          prepared_date: '2026-11-15',
        },
      });
      const log = await injections.createInjection(owner, {
        medication_id: medication.id,
        pen_id: vial.id,
        deduct_pen: true,
        dose_mg: 0.1,
      });
      medicationId = medication.id;
      vialId = vial.id;
      preparationId = vial.preparation.id;
      injectionId = log.id;
    });
    afterAll(async () => {
      const admin = await getSystemClient();
      try {
        await admin.query(
          'DELETE FROM public."user" WHERE id=ANY($1::uuid[])',
          [[owner, attacker]]
        );
      } finally {
        admin.release();
        await endPool();
      }
    });

    it('rejects temp-table preparation probes uniformly before parent reads', async () => {
      const app = await getClient(attacker);
      try {
        expect(
          (
            await app.query(
              'SELECT 1 FROM public.medication_preparations WHERE id=$1',
              [preparationId]
            )
          ).rows
        ).toHaveLength(0);
        await app.query(
          'CREATE TEMP TABLE guard_scope_probe(user_id uuid,medication_id uuid,pen_id uuid,preparation_id uuid)'
        );
        await app.query(`CREATE TRIGGER guard_scope_probe BEFORE INSERT ON guard_scope_probe
          FOR EACH ROW EXECUTE FUNCTION public.check_injection_preparation_scope()`);
        for (const id of [preparationId, randomUUID()])
          await expect(
            app.query('INSERT INTO guard_scope_probe VALUES($1,$2,$3,$4)', [
              owner,
              medicationId,
              vialId,
              id,
            ])
          ).rejects.toThrow(
            'Invalid trigger context for preparation history guard'
          );
        expect(
          (await app.query('SELECT 1 FROM guard_scope_probe')).rows
        ).toHaveLength(0);
      } finally {
        app.release();
      }
    });

    it('rejects temp-table used-vial probes uniformly before physical existence checks', async () => {
      const app = await getClient(attacker);
      try {
        expect(
          (
            await app.query('SELECT 1 FROM public.medications WHERE id=$1', [
              medicationId,
            ])
          ).rows
        ).toHaveLength(0);
        await app.query(
          'CREATE TEMP TABLE guard_vial_probe(id uuid,user_id uuid,medication_id uuid,doses_used int)'
        );
        await app.query(`CREATE TRIGGER guard_vial_probe BEFORE DELETE ON guard_vial_probe
          FOR EACH ROW EXECUTE FUNCTION public.protect_used_medication_vial()`);
        for (const id of [medicationId, randomUUID()]) {
          const rowId = randomUUID();
          await app.query('INSERT INTO guard_vial_probe VALUES($1,$2,$3,1)', [
            rowId,
            owner,
            id,
          ]);
          await expect(
            app.query('DELETE FROM guard_vial_probe WHERE id=$1', [rowId])
          ).rejects.toThrow(
            'Invalid trigger context for used medication stock guard'
          );
        }
        expect(
          (await app.query('SELECT 1 FROM guard_vial_probe')).rows
        ).toHaveLength(2);
      } finally {
        app.release();
      }
    });

    it.each([
      ['check_injection_preparation_scope', 'INSERT'],
      ['protect_used_medication_vial', 'DELETE'],
    ] as const)(
      'rejects wrong-shaped table attachment for %s before reading NEW or OLD',
      async (functionName, operation) => {
        const app = await getClient(attacker);
        try {
          await app.query('BEGIN');
          await app.query(
            'CREATE TEMP TABLE guard_shape_probe(id int) ON COMMIT DROP'
          );
          if (operation === 'DELETE')
            await app.query('INSERT INTO guard_shape_probe VALUES(1)');
          await app.query(`CREATE TRIGGER guard_shape_probe BEFORE ${operation} ON guard_shape_probe
            FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
          await expect(
            app.query(
              operation === 'INSERT'
                ? 'INSERT INTO guard_shape_probe VALUES(1)'
                : 'DELETE FROM guard_shape_probe'
            )
          ).rejects.toThrow('Invalid trigger context');
        } finally {
          await app.query('ROLLBACK');
          app.release();
        }
      }
    );

    it('rejects the preparation function on the correct relation with the wrong operation', async () => {
      const admin = await getSystemClient();
      try {
        await admin.query('BEGIN');
        await admin.query(`CREATE TRIGGER guard_wrong_scope_operation BEFORE DELETE ON public.injection_entries
          FOR EACH ROW EXECUTE FUNCTION public.check_injection_preparation_scope()`);
        await expect(
          admin.query('DELETE FROM public.injection_entries WHERE id=$1', [
            injectionId,
          ])
        ).rejects.toThrow('Invalid trigger context');
      } finally {
        await admin.query('ROLLBACK');
        admin.release();
      }
    });

    it('rejects the vial function on its correct relation with the wrong operation', async () => {
      const admin = await getSystemClient();
      try {
        await admin.query('BEGIN');
        await admin.query(`CREATE TRIGGER guard_wrong_vial_operation BEFORE INSERT ON public.medication_pens
          FOR EACH ROW EXECUTE FUNCTION public.protect_used_medication_vial()`);
        await expect(
          admin.query(
            'INSERT INTO public.medication_pens(user_id,medication_id) VALUES($1,$2)',
            [owner, medicationId]
          )
        ).rejects.toThrow('Invalid trigger context');
      } finally {
        await admin.query('ROLLBACK');
        admin.release();
      }
    });
  }
);
