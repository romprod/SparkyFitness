import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  medicationPreparationInputSchema,
  type MedicationPreparationReviewInput,
} from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import stock from '../models/medicationPenRepository.js';
import {
  commitPreparationCorrection,
  reviewPreparationCorrection,
} from '../models/medicationPreparationCorrectionRepository.js';

describe.runIf(process.env.VIAL_LABEL_MASS_INTEGRATION === '1')(
  'vial label metadata in isolated PostgreSQL',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    let medicationId: string;
    beforeAll(async () => {
      const client: PoolClient = await getSystemClient();
      try {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `label-${id}@example.test`]
          );
        medicationId = (
          await client.query(
            "INSERT INTO public.medications(user_id,name,type_id) VALUES ($1,'Synthetic printed label fixture','injection') RETURNING id",
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
    const preparation = {
      mode: 'reconstituted' as const,
      mass_value: '10',
      mass_unit: 'mg' as const,
      final_volume_ml: '2',
      prepared_date: '2026-11-15',
    };
    async function snapshot(id: string) {
      const client: PoolClient = await getSystemClient();
      try {
        return (
          await client.query(
            `SELECT to_jsonb(v)-'label_mass_mg'-'updated_at' AS stock,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.medication_preparations p WHERE p.pen_id=v.id) AS preparations,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.injection_entries i WHERE i.pen_id=v.id) AS doses
    FROM public.medication_pens v WHERE id=$1`,
            [id]
          )
        ).rows[0];
      } finally {
        client.release();
      }
    }
    it('has no label default, never derives known preparation content and reapplies without changing legacy rows', async () => {
      const vial = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        preparation: medicationPreparationInputSchema.parse(preparation),
      });
      expect(vial.label_mass_mg).toBeNull();
      const before = await snapshot(vial.id);
      const client: PoolClient = await getSystemClient();
      try {
        const column = (
          await client.query(
            "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='medication_pens' AND column_name='label_mass_mg'"
          )
        ).rows[0];
        expect(column.column_default).toBeNull();
        await client.query(
          await readFile(
            new URL(
              '../db/migrations/20261115233000_medication_vial_label_mass.sql',
              import.meta.url
            ),
            'utf8'
          )
        );
        expect(
          (
            await client.query(
              'SELECT label_mass_mg::text FROM public.medication_pens WHERE id=$1',
              [vial.id]
            )
          ).rows[0].label_mass_mg
        ).toBeNull();
      } finally {
        client.release();
      }
      expect(await snapshot(vial.id)).toEqual(before);
    });
    it('round-trips new-vial review metadata exactly and label remains distinct from preparation mass', async () => {
      const amount = '1.23456789123456789123456789';
      const vial = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        label_mass_mg: amount,
        preparation: medicationPreparationInputSchema.parse(preparation),
      });
      expect(vial.label_mass_mg).toBe(amount);
      expect(vial.preparation.exact.mass_mg).toBe('10');
      const request: MedicationPreparationReviewInput = {
        expected_revision: 0,
        preparation,
      };
      const review = await reviewPreparationCorrection(owner, vial.id, request);
      expect(review.before).toMatchObject({
        concentration_mg_ml: '5',
        remaining_mg: '10',
      });
      await commitPreparationCorrection(owner, vial.id, {
        ...request,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      const reread = (await stock.listPens(owner, medicationId)).find(
        (p: { id: string }) => p.id === vial.id
      );
      expect(reread.label_mass_mg).toBe(amount);
      expect(reread.preparation.exact.mass_mg).toBe('10');
    });
    it('edits and clears used-vial labels without altering quantities, preparation, history or terminal status', async () => {
      const vial = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        dose_mg: 1,
        label_mass_mg: '12',
        preparation: medicationPreparationInputSchema.parse(preparation),
      });
      const client: PoolClient = await getSystemClient();
      try {
        await client.query(
          `INSERT INTO public.injection_entries(user_id,medication_id,pen_id,preparation_id,dose_mg,volume_ml,dose_input_unit,syringe_units,site,notes)
        VALUES ($1,$2,$3,$4,1,0.2,'units',20,'left','Synthetic preserved note')`,
          [owner, medicationId, vial.id, vial.preparation.id]
        );
        await client.query(
          "UPDATE public.medication_pens SET doses_used=1,status='finished',finished_at=NOW() WHERE id=$1",
          [vial.id]
        );
      } finally {
        client.release();
      }
      const before = await snapshot(vial.id);
      expect(
        (
          await stock.updatePen(owner, vial.id, {
            label_mass_mg: '9.87654321987654321',
          })
        ).label_mass_mg
      ).toBe('9.87654321987654321');
      expect(await snapshot(vial.id)).toEqual(before);
      await stock.updatePen(owner, vial.id, {
        notes: 'Synthetic metadata edit',
      });
      const preserved = (await stock.listPens(owner, medicationId)).find(
        (p: { id: string }) => p.id === vial.id
      );
      expect(preserved.label_mass_mg).toBe('9.87654321987654321');
      expect(preserved.status).toBe('finished');
      const beforeClear = await snapshot(vial.id);
      expect(
        (await stock.updatePen(owner, vial.id, { label_mass_mg: null }))
          .label_mass_mg
      ).toBeNull();
      expect(await snapshot(vial.id)).toEqual(beforeClear);
    });
    it('preserves label during actual preparation-content correction and never uses it in depletion math', async () => {
      const vial = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        label_mass_mg: '999',
        preparation: medicationPreparationInputSchema.parse(preparation),
      });
      const request: MedicationPreparationReviewInput = {
        expected_revision: 0,
        preparation: { ...preparation, mass_value: '8' },
      };
      const review = await reviewPreparationCorrection(owner, vial.id, request);
      expect(review.after).toMatchObject({
        concentration_mg_ml: '4',
        remaining_mg: '8',
      });
      await commitPreparationCorrection(owner, vial.id, {
        ...request,
        review_hash: review.review_hash,
        operation_id: randomUUID(),
      });
      const saved = (await stock.listPens(owner, medicationId)).find(
        (p: { id: string }) => p.id === vial.id
      );
      expect(saved.label_mass_mg).toBe('999');
      expect(saved.preparation.exact.mass_mg).toBe('8');
      expect(saved.stock.remainingMg).toBe(8);
    });
    it('scopes ownership and requires explicit clear before changing a labelled vial to a pen', async () => {
      const vial = await stock.createPen(owner, medicationId, {
        kind: 'vial',
        label_mass_mg: '10',
        dose_mg: 2,
      });
      const before = await snapshot(vial.id);
      expect(
        await stock.updatePen(other, vial.id, { label_mass_mg: '50' })
      ).toBeNull();
      await expect(
        stock.updatePen(owner, vial.id, {
          kind: 'pen',
          label: 'Must roll back',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(await snapshot(vial.id)).toEqual(before);
      await expect(
        stock.createPen(owner, medicationId, {
          kind: 'pen',
          label_mass_mg: '10',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      const saved = await stock.updatePen(owner, vial.id, {
        kind: 'pen',
        label_mass_mg: null,
      });
      expect(saved.kind).toBe('pen');
      expect(saved.label_mass_mg).toBeNull();
      expect(saved.dose_mg).toBe(2);
    });
    it('rejects raw nonfinite/nonpositive labels and labels on pens at the database boundary', async () => {
      const vial = await stock.createPen(owner, medicationId, { kind: 'vial' });
      const pen = await stock.createPen(owner, medicationId, { kind: 'pen' });
      const client: PoolClient = await getSystemClient();
      try {
        for (const amount of ['NaN', 'Infinity', '-Infinity', '0', '-1'])
          await expect(
            client.query(
              'UPDATE public.medication_pens SET label_mass_mg=$2 WHERE id=$1',
              [vial.id, amount]
            )
          ).rejects.toThrow('medication_pens_vial_label_mass_check');
        await expect(
          client.query(
            'UPDATE public.medication_pens SET label_mass_mg=10 WHERE id=$1',
            [pen.id]
          )
        ).rejects.toThrow('medication_pens_vial_label_mass_check');
      } finally {
        client.release();
      }
    });
  }
);
