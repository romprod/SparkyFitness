import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';
import {
  commitPreparationCorrection,
  reviewPreparationCorrection,
} from '../models/medicationPreparationCorrectionRepository.js';
import {
  medicationPreparationInputSchema,
  previewPreparationCreation,
  type MedicationPreparationCreationInput,
  type MedicationPreparationReviewInput,
} from '@workspace/shared';

describe.runIf(process.env.PREPARATION_CORRECTION_INTEGRATION === '1')(
  'reviewed preparation corrections in isolated PostgreSQL',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    let medicationId: string;
    const input: MedicationPreparationReviewInput = {
      expected_revision: 0,
      preparation: {
        mode: 'reconstituted',
        mass_value: '8',
        mass_unit: 'mg',
        final_volume_ml: '2',
        prepared_date: '2026-11-15',
      },
    };
    beforeAll(async () => {
      const client: PoolClient = await getSystemClient();
      try {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `correction-${id}@example.test`]
          );
        medicationId = (
          await client.query(
            "INSERT INTO public.medications (user_id,name,type_id) VALUES ($1,'Synthetic correction fixture','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        client.release();
      }
    });
    afterAll(async () => {
      const client: PoolClient = await getSystemClient();
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
    async function vial() {
      return stock.createPen(owner, medicationId, {
        kind: 'vial',
        preparation: {
          mode: 'reconstituted',
          mass_value: 10,
          mass_unit: 'mg',
          final_volume_ml: 2,
          prepared_date: '2026-11-15',
          diluent: 'Preserved label',
        },
      });
    }
    async function draw(
      pen: { id: string; preparation: { id: string } },
      volume: string | null = '0.2',
      mass: string | null = '1',
      clientArg?: PoolClient
    ) {
      const client: PoolClient = clientArg ?? (await getSystemClient());
      try {
        const result = await client.query(
          `INSERT INTO public.injection_entries (user_id,medication_id,pen_id,preparation_id,dose_mg,volume_ml,dose_input_unit,syringe_units,site,notes,source)
        VALUES ($1,$2,$3,$4,$5,$6,'units',20,'left','Synthetic unchanged note','manual') RETURNING *`,
          [owner, medicationId, pen.id, pen.preparation.id, mass, volume]
        );
        await client.query(
          "UPDATE public.medication_pens SET doses_used=doses_used+1,status='in_use' WHERE id=$1",
          [pen.id]
        );
        return result.rows[0];
      } finally {
        if (!clientArg) client.release();
      }
    }
    it('recomputes exact delivered mass only, preserves all physical/metadata fields and baseline; replays once', async () => {
      const pen = await vial();
      const original = await draw(pen);
      const review = await reviewPreparationCorrection(owner, pen.id, input);
      expect(review).toMatchObject({
        can_confirm: true,
        affected_dose_count: 1,
        before: { concentration_mg_ml: '5', remaining_mg: '9' },
        after: { concentration_mg_ml: '4', remaining_mg: '7.2' },
      });
      const commit = {
        ...input,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      };
      const results = await Promise.all([
        commitPreparationCorrection(owner, pen.id, commit),
        commitPreparationCorrection(owner, pen.id, commit),
      ]);
      expect(results[0]).toEqual(results[1]);
      await expect(
        commitPreparationCorrection(owner, pen.id, {
          ...commit,
          preparation: { ...input.preparation, final_volume_ml: '3' },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      const admin: PoolClient = await getSystemClient();
      try {
        const saved = (
          await admin.query(
            'SELECT * FROM public.injection_entries WHERE id=$1',
            [original.id]
          )
        ).rows[0];
        expect(saved.dose_mg).toBe(0.8);
        expect({
          ...saved,
          dose_mg: original.dose_mg,
          updated_at: original.updated_at,
        }).toEqual(original);
        const projection = (
          await admin.query(
            'SELECT *,public.medication_preparation_snapshot(p) AS snapshot FROM public.medication_preparations p WHERE id=$1',
            [pen.preparation.id]
          )
        ).rows[0];
        expect(projection).toMatchObject({
          id: pen.preparation.id,
          revision: 1,
          concentration_mg_ml: 4,
          diluent: 'Preserved label',
        });
        const audit = (
          await admin.query(
            'SELECT * FROM public.medication_preparation_corrections WHERE preparation_id=$1',
            [pen.preparation.id]
          )
        ).rows;
        expect(audit).toHaveLength(1);
        expect(audit[0].before_snapshot).toMatchObject({
          mass_mg: '10',
          revision: 0,
        });
        expect(audit[0].after_snapshot).toEqual(projection.snapshot);
        expect(
          (
            await admin.query(
              'SELECT * FROM public.medication_preparation_dose_corrections WHERE correction_id=$1',
              [results[0]!.correction_id]
            )
          ).rows[0]
        ).toMatchObject({
          before_dose_mg: 1,
          after_dose_mg: 0.8,
          volume_ml: 0.2,
        });
        await expect(
          admin.query(
            'UPDATE public.medication_preparations SET mass_mg=100 WHERE id=$1',
            [pen.preparation.id]
          )
        ).rejects.toThrow('immutable');
        await expect(
          admin.query(
            'UPDATE public.medication_preparation_corrections SET from_revision=10 WHERE id=$1',
            [results[0]!.correction_id]
          )
        ).rejects.toThrow('immutable');
      } finally {
        admin.release();
      }
    });
    it('blocks missing physical history only for concentration changes; allows metadata and same-concentration fill with unknown stock', async () => {
      const pen = await vial();
      await draw(pen, null, null);
      expect(
        await reviewPreparationCorrection(owner, pen.id, input)
      ).toMatchObject({
        can_confirm: false,
        blocking_reason: 'INCOMPLETE_PHYSICAL_HISTORY',
        stock_unknown: true,
      });
      const unchanged: MedicationPreparationReviewInput = {
        expected_revision: 0,
        preparation: {
          mode: 'reconstituted',
          mass_value: '10',
          mass_unit: 'mg',
          final_volume_ml: '2',
          prepared_date: '2026-11-16',
        },
      };
      const review = await reviewPreparationCorrection(
        owner,
        pen.id,
        unchanged
      );
      expect(review).toMatchObject({
        can_confirm: true,
        affected_dose_count: 0,
        stock_unknown: true,
      });
      await commitPreparationCorrection(owner, pen.id, {
        ...unchanged,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      const fill: MedicationPreparationReviewInput = {
        expected_revision: 1,
        preparation: {
          mode: 'reconstituted',
          mass_unit: 'mg',
          prepared_date: '2026-11-16',
          mass_value: '15',
          final_volume_ml: '3',
        },
      };
      const fillReview = await reviewPreparationCorrection(owner, pen.id, fill);
      expect(fillReview).toMatchObject({
        can_confirm: true,
        stock_unknown: true,
        after: { remaining_mg: null, remaining_ml: null },
      });
      await commitPreparationCorrection(owner, pen.id, {
        ...fill,
        review_hash: fillReview.review_hash,
        operation_id: randomUUID(),
      });
    });
    it('accepts known zero physical draws, exposes overdraw and never reopens explicitly retired stock or rebases omitted BUD', async () => {
      const pen = await vial();
      await draw(pen, '0', '0');
      await draw(pen, '1', '5');
      const admin: PoolClient = await getSystemClient();
      try {
        await admin.query(
          "UPDATE public.medication_pens SET status='finished',finished_at=NOW(),bud_mode='date',bud_date='2026-12-01',bud_source='Synthetic label' WHERE id=$1",
          [pen.id]
        );
      } finally {
        admin.release();
      }
      const request: MedicationPreparationReviewInput = {
        expected_revision: 0,
        preparation: {
          mode: 'premixed',
          label_concentration_value: '4',
          label_concentration_unit: 'mg/ml',
          final_volume_ml: '0.5',
          prepared_date: '2026-11-15',
        },
      };
      const review = await reviewPreparationCorrection(owner, pen.id, request);
      expect(review).toMatchObject({
        can_confirm: true,
        affected_dose_count: 2,
        overdraw_warning: true,
        overdrawn_mg: '2',
        after: { remaining_mg: '0', remaining_ml: '0' },
      });
      await commitPreparationCorrection(owner, pen.id, {
        ...request,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      const saved = (await stock.listPens(owner, medicationId)).find(
        (p: { id: string }) => p.id === pen.id
      );
      expect(saved).toMatchObject({
        status: 'finished',
        bud_date: '2026-12-01',
        bud_source: 'Synthetic label',
      });
    });
    it('rejects stale review after an interleaved draw under the same vial lock and scopes owner access', async () => {
      const pen = await vial();
      const review = await reviewPreparationCorrection(owner, pen.id, input);
      await expect(
        reviewPreparationCorrection(other, pen.id, input)
      ).rejects.toMatchObject({ statusCode: 404 });
      const admin: PoolClient = await getSystemClient();
      try {
        await admin.query('BEGIN');
        await admin.query(
          'SELECT id FROM public.medication_pens WHERE id=$1 FOR UPDATE',
          [pen.id]
        );
        const pending = commitPreparationCorrection(owner, pen.id, {
          ...input,
          review_hash: review.review_hash,
          operation_id: randomUUID(),
        }).then(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error })
        );
        let blocked = false;
        for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
          await admin.query('SELECT pg_stat_clear_snapshot()');
          const waiting = await admin.query<{
            blocked: boolean;
          }>(`SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity a WHERE pg_backend_pid()=ANY(pg_blocking_pids(a.pid))
            ) AS blocked`);
          blocked = waiting.rows[0]!.blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await draw(pen, '0.1', '0.5', admin);
        await admin.query('COMMIT');
        expect(await pending).toMatchObject({
          ok: false,
          error: { statusCode: 409 },
        });
      } finally {
        await admin.query('ROLLBACK');
        admin.release();
      }
    });
    it('preserves historical numeric concentration tails for unchanged ratios with incomplete history', async () => {
      for (const preparation of [
        {
          mode: 'reconstituted' as const,
          mass_value: 10,
          mass_unit: 'mg' as const,
          final_volume_ml: 3,
          prepared_date: '2026-11-15',
        },
        {
          mode: 'premixed' as const,
          label_concentration_value: '3.3',
          label_concentration_unit: 'mg/ml' as const,
          final_volume_ml: 0.3,
          prepared_date: '2026-11-15',
        },
      ]) {
        const normalized =
          preparation.mode === 'premixed'
            ? { ...preparation, mass_value: 0.99, mass_unit: 'mg' as const }
            : preparation;
        const legacy: PoolClient = await getSystemClient();
        let pen: { id: string; preparation: { id: string } };
        try {
          const concentration =
            normalized.mass_value / normalized.final_volume_ml;
          const saved = await legacy.query(
            "INSERT INTO public.medication_pens (user_id,medication_id,kind,concentration_mg_ml,volume_ml) VALUES ($1,$2,'vial',$3,$4) RETURNING id",
            [owner, medicationId, concentration, normalized.final_volume_ml]
          );
          const prep = await legacy.query(
            `INSERT INTO public.medication_preparations (pen_id,user_id,medication_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date,label_concentration_value,label_concentration_unit)
            VALUES ($1,$2,$3,$4,$5,'mg',$6,$5,$7,'2026-11-15',$8,$9) RETURNING id`,
            [
              saved.rows[0].id,
              owner,
              medicationId,
              normalized.mode,
              normalized.mass_value,
              normalized.final_volume_ml,
              concentration,
              preparation.mode === 'premixed' ? '3.3' : null,
              preparation.mode === 'premixed' ? 'mg/ml' : null,
            ]
          );
          pen = { id: saved.rows[0].id, preparation: { id: prep.rows[0].id } };
        } finally {
          legacy.release();
        }

        await draw(pen, null, null);
        const correction: MedicationPreparationReviewInput = {
          expected_revision: 0,
          preparation:
            preparation.mode === 'premixed'
              ? {
                  mode: 'premixed',
                  label_concentration_value: '3.3',
                  label_concentration_unit: 'mg/ml',
                  final_volume_ml: '0.3',
                  prepared_date: '2026-11-16',
                }
              : {
                  mode: 'reconstituted',
                  mass_value: '10',
                  mass_unit: 'mg',
                  final_volume_ml: '3',
                  prepared_date: '2026-11-16',
                },
        };
        const review = await reviewPreparationCorrection(
          owner,
          pen.id,
          correction
        );
        expect(review).toMatchObject({
          can_confirm: true,
          affected_dose_count: 0,
          stock_unknown: true,
        });
        expect(review.after.concentration_mg_ml).toBe(
          review.before.concentration_mg_ml
        );
        await commitPreparationCorrection(owner, pen.id, {
          ...correction,
          review_hash: review.review_hash,
          operation_id: randomUUID(),
        });
      }
    });
    it('persists the exact initial creation preview for raw decimal dry/premix inputs and permits unchanged metadata with incomplete history', async () => {
      const inputs: MedicationPreparationCreationInput[] = [
        {
          mode: 'reconstituted',
          mass_value: '1.23456789123456789',
          mass_unit: 'mg',
          final_volume_ml: '3.00000000000000001',
          prepared_date: '2026-11-15',
        },
        {
          mode: 'premixed',
          label_concentration_value: '1.23456789123456789',
          label_concentration_unit: 'mg/ml',
          final_volume_ml: '0.300000000000000001',
          prepared_date: '2026-11-15',
        },
      ];
      for (const raw of inputs) {
        const preview = previewPreparationCreation(raw, null, null)!;
        const normalized = medicationPreparationInputSchema.parse(raw);
        const pen = await stock.createPen(owner, medicationId, {
          kind: 'vial',
          preparation: normalized,
        });
        expect(pen.preparation.exact).toMatchObject(preview.values);
        await draw(pen, null, null);
        const correction: MedicationPreparationReviewInput = {
          expected_revision: 0,
          preparation:
            raw.mode === 'premixed' &&
            raw.label_concentration_value !== undefined
              ? {
                  mode: 'premixed',
                  label_concentration_value: raw.label_concentration_value,
                  label_concentration_unit: 'mg/ml',
                  final_volume_ml: pen.preparation.exact.final_volume_ml,
                  prepared_date: '2026-11-16',
                }
              : {
                  mode: 'reconstituted',
                  mass_value: pen.preparation.exact.mass_value,
                  mass_unit: pen.preparation.mass_unit,
                  final_volume_ml: pen.preparation.exact.final_volume_ml,
                  prepared_date: '2026-11-16',
                },
        };
        const review = await reviewPreparationCorrection(
          owner,
          pen.id,
          correction
        );
        expect(review).toMatchObject({
          can_confirm: true,
          affected_dose_count: 0,
          stock_unknown: true,
        });
        expect(review.before.concentration_mg_ml).toBe(
          preview.values.concentration_mg_ml
        );
        expect(review.after.concentration_mg_ml).toBe(
          preview.values.concentration_mg_ml
        );
        await commitPreparationCorrection(owner, pen.id, {
          ...correction,
          review_hash: review.review_hash,
          operation_id: randomUUID(),
        });
      }
    });
    it('round-trips exact correction fields through existing API reads without rewriting a later metadata-only dose', async () => {
      const pen = await vial();
      const dose = await draw(pen);
      const correction: MedicationPreparationReviewInput = {
        expected_revision: 0,
        preparation: {
          mode: 'reconstituted',
          mass_value: '1.23456789123456789',
          mass_unit: 'mg',
          final_volume_ml: '2',
          prepared_date: '2026-11-15',
        },
      };
      const first = await reviewPreparationCorrection(
        owner,
        pen.id,
        correction
      );
      await commitPreparationCorrection(owner, pen.id, {
        ...correction,
        review_hash: first.review_hash,
        operation_id: randomUUID(),
      });
      const saved = (await stock.listPens(owner, medicationId)).find(
        (p: { id: string }) => p.id === pen.id
      );
      expect(saved.preparation.exact.mass_value).toBe('1.23456789123456789');
      await stock.updatePen(owner, pen.id, {
        notes: 'Synthetic metadata',
        concentration_mg_ml: saved.concentration_mg_ml,
        volume_ml: saved.volume_ml,
      });
      const checked: PoolClient = await getSystemClient();
      try {
        expect(
          (
            await checked.query(
              'SELECT concentration_mg_ml::text FROM public.medication_pens WHERE id=$1',
              [pen.id]
            )
          ).rows[0].concentration_mg_ml
        ).toBe(saved.preparation.exact.concentration_mg_ml);
      } finally {
        checked.release();
      }

      const metadata: MedicationPreparationReviewInput = {
        expected_revision: 1,
        preparation: {
          mode: 'reconstituted',
          mass_value: saved.preparation.exact.mass_value,
          mass_unit: saved.preparation.mass_unit,
          final_volume_ml: saved.preparation.exact.final_volume_ml,
          prepared_date: '2026-11-16',
        },
      };
      const second = await reviewPreparationCorrection(owner, pen.id, metadata);
      expect(second.affected_dose_count).toBe(0);
      expect(second.after.concentration_mg_ml).toBe(
        first.after.concentration_mg_ml
      );
      const admin: PoolClient = await getSystemClient();
      try {
        const before = (
          await admin.query(
            'SELECT dose_mg::text,volume_ml::text FROM public.injection_entries WHERE id=$1',
            [dose.id]
          )
        ).rows[0];
        await commitPreparationCorrection(owner, pen.id, {
          ...metadata,
          review_hash: second.review_hash,
          operation_id: randomUUID(),
        });
        expect(
          (
            await admin.query(
              'SELECT dose_mg::text,volume_ml::text FROM public.injection_entries WHERE id=$1',
              [dose.id]
            )
          ).rows[0]
        ).toEqual(before);
        expect(
          (await stock.listPens(owner, medicationId)).find(
            (p: { id: string }) => p.id === pen.id
          ).preparation.exact.mass_value
        ).toBe('1.23456789123456789');
      } finally {
        admin.release();
      }
    });
    it('retains both audits across dose, vial and medication deletion, with safe replay after entity deletion', async () => {
      const pen = await vial();
      const dose = await draw(pen);
      const review = await reviewPreparationCorrection(owner, pen.id, input);
      const commit = {
        ...input,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      };
      const corrected = await commitPreparationCorrection(
        owner,
        pen.id,
        commit
      );
      await injections.deleteInjection(owner, dose.id);
      await stock.deletePen(owner, pen.id);
      const admin: PoolClient = await getSystemClient();
      try {
        await admin.query('DELETE FROM public.medications WHERE id=$1', [
          medicationId,
        ]);
        expect(
          (
            await admin.query(
              'SELECT * FROM public.medication_preparation_dose_corrections WHERE correction_id=$1',
              [corrected.correction_id]
            )
          ).rows
        ).toHaveLength(1);
        expect(
          (
            await admin.query(
              'SELECT * FROM public.medication_preparation_corrections WHERE id=$1',
              [corrected.correction_id]
            )
          ).rows
        ).toHaveLength(1);
      } finally {
        admin.release();
      }
      expect(await commitPreparationCorrection(owner, pen.id, commit)).toEqual(
        corrected
      );
    });
    it('rejects same-name TEMP rebinding before parent reads for every new trigger guard', async () => {
      const admin: PoolClient = await getSystemClient();
      const contexts = [
        [
          'medication_preparation_corrections',
          'check_preparation_correction_scope',
          'INSERT',
        ],
        [
          'medication_preparation_dose_corrections',
          'check_preparation_dose_correction_scope',
          'INSERT',
        ],
        ['medication_preparations', 'protect_medication_preparation', 'UPDATE'],
        [
          'medication_preparation_corrections',
          'protect_preparation_correction_history',
          'UPDATE',
        ],
      ];
      try {
        for (const [table, fn, operation] of contexts) {
          await admin.query('BEGIN');
          await admin.query(`CREATE TEMP TABLE ${table} (id integer)`);
          await admin.query(`INSERT INTO pg_temp.${table} VALUES (1)`);
          await admin.query(
            `CREATE TRIGGER wrong_context BEFORE ${operation} ON pg_temp.${table} FOR EACH ROW EXECUTE FUNCTION public.${fn}()`
          );
          await expect(
            admin.query(
              operation === 'INSERT'
                ? `INSERT INTO pg_temp.${table} VALUES (2)`
                : `UPDATE pg_temp.${table} SET id=2`
            )
          ).rejects.toThrow('Invalid trigger context');
          await admin.query('ROLLBACK');
        }
      } finally {
        await admin.query('ROLLBACK');
        admin.release();
      }
    });
  }
);
