import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';

// Explicit opt-in: run only against an isolated synthetic database, never production.
describe.runIf(process.env.PREPARATION_INTEGRATION === '1')(
  'preparation records in PostgreSQL',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    let medicationId: string;
    const preparation = {
      mode: 'reconstituted' as const,
      mass_value: 12000,
      mass_unit: 'mcg' as const,
      final_volume_ml: 3,
      prepared_date: '2026-11-15',
      diluent: 'Synthetic label',
    };
    beforeAll(async () => {
      const client = await getSystemClient();
      try {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `preparation-${id}@example.test`]
          );
        const result = await client.query(
          "INSERT INTO medications (user_id,name,type_id) VALUES ($1,'Synthetic preparation fixture','injection') RETURNING id",
          [owner]
        );
        medicationId = result.rows[0].id;
      } finally {
        client.release();
      }
    });
    afterAll(async () => {
      const client = await getSystemClient();
      try {
        await client.query(
          'DELETE FROM public."user" WHERE id=ANY($1::uuid[])',
          [[owner, other]]
        );
      } finally {
        client.release();
        await endPool();
      }
    });
    it('round-trips canonical snapshot, protects provenance and scopes owners', async () => {
      const pen = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        preparation,
      });
      expect(pen.preparation.mass_mg).toBe(12);
      expect(pen.preparation.concentration_mg_ml).toBe(4);
      const logged = await injections.createInjection(owner, {
        medication_id: medicationId,
        pen_id: pen.id,
        deduct_pen: true,
        dose_mg: 1,
      });
      expect(logged.preparation_id).toBe(pen.preparation.id);
      await expect(stock.deletePen(owner, pen.id)).rejects.toThrow(
        'cannot be removed'
      );
      const admin = await getSystemClient();
      try {
        await expect(
          admin.query(
            'UPDATE medication_preparations SET mass_value=13 WHERE id=$1',
            [pen.preparation.id]
          )
        ).rejects.toThrow('immutable');
        await expect(
          admin.query('DELETE FROM medication_preparations WHERE id=$1', [
            pen.preparation.id,
          ])
        ).rejects.toThrow('cannot be removed');
        const foreign = await admin.query(
          "INSERT INTO medication_pens (user_id,medication_id,kind) VALUES ($1,$2,'vial') RETURNING id",
          [other, medicationId]
        );
        await expect(
          admin.query(
            "INSERT INTO medication_preparations (pen_id,user_id,medication_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date) VALUES ($1,$2,$3,'premixed',12,'mg',3,12,4,'2026-11-15')",
            [foreign.rows[0].id, owner, medicationId]
          )
        ).rejects.toThrow();
        await expect(
          admin.query(
            'UPDATE injection_entries SET preparation_id=$1, pen_id=$2 WHERE id=$3',
            [pen.preparation.id, foreign.rows[0].id, logged.id]
          )
        ).rejects.toThrow('does not belong');
      } finally {
        admin.release();
      }

      await expect(
        stock.createPen(other, medicationId, { kind: 'vial', preparation })
      ).rejects.toThrow('Medication not found');
    });
    it.each([false, true])(
      'links preparation committed while injection waits, auto=%s',
      async (auto) => {
        // A separate medication makes the automatic candidate deterministic.
        const client = await getSystemClient();
        let pending: ReturnType<typeof injections.createInjection> | undefined;
        try {
          const med = await client.query(
            "INSERT INTO medications (user_id,name,type_id) VALUES ($1,'Synthetic concurrency fixture','injection') RETURNING id",
            [owner]
          );
          const medId = med.rows[0].id as string;
          const pen = await stock.createPen(owner, medId, { kind: 'vial' });
          await client.query('BEGIN');
          await client.query(
            'SELECT id FROM medication_pens WHERE id=$1 FOR UPDATE',
            [pen.id]
          );
          const pid = (await client.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid as number;
          const saved = await client.query(
            "INSERT INTO medication_preparations (pen_id,user_id,medication_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date) VALUES ($1,$2,$3,'reconstituted',12,'mg',3,12,4,'2026-11-15') RETURNING id",
            [pen.id, owner, medId]
          );
          pending = injections.createInjection(owner, {
            medication_id: medId,
            ...(auto ? {} : { pen_id: pen.id }),
            deduct_pen: true,
            dose_mg: 1,
          });
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const result = await client.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
              [pid]
            );
            if (result.rows[0].blocked) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(blocked).toBe(true);
          await client.query('COMMIT');
          expect((await pending).preparation_id).toBe(saved.rows[0].id);
        } finally {
          await client.query('ROLLBACK');
          client.release();
          if (pending) await pending.catch(() => {});
        }
      }
    );
  }
);
