import type { MedicationPen } from '@workspace/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { previewMedicationDraw } from '../services/medicationDrawReviewService.js';
import * as devices from '../models/medicationSyringeRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';

describe.runIf(process.env.DRAW_REVIEW_INTEGRATION === '1')(
  'reviewed raw dose PostgreSQL',
  () => {
    const owner = randomUUID();
    let med: string;
    let device: string;
    const prep = {
      mode: 'reconstituted' as const,
      mass_value: 3,
      mass_unit: 'mg' as const,
      final_volume_ml: 3,
      prepared_date: '2026-11-15',
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
          [owner, `draw-${owner}@example.test`]
        );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic raw draw','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      device = (
        await devices.saveSyringe(owner, {
          name: 'Synthetic device',
          graduation_type: 'units',
          units_per_ml: 100,
          capacity_ml: '1',
          capacity_units: 100,
          increment: '0.0000000000000001',
        })
      ).id;
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=$1', [owner]);
      } finally {
        c.release();
        await endPool();
      }
    });
    const input = (
      value: string,
      unit: 'mg' | 'mcg' | 'ml' | 'units' = 'mg'
    ) => ({ syringe_id: device, dose: { value, unit } });
    it('reviews four raw units with original credit and preserves omitted timestamps and exact delivered mass', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const first = input('0.123456789123456789');
      const preview = await previewMedicationDraw(owner, vial.id, first);
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: {
          ...first,
          review_intent: true,
          expected_preview_state: preview.review.state,
        },
        injected_at: '2026-11-14T12:13:14.123Z',
        entry_date: '2026-11-14',
      });
      expect(logged.dose_mg_exact).toBe('0.123456789123456789');
      for (const [value, unit] of [
        ['200', 'mcg'],
        ['0.3', 'ml'],
        ['40', 'units'],
        ['0.5', 'mg'],
      ] as const) {
        const target = input(value, unit);
        const review = await previewMedicationDraw(owner, vial.id, {
          ...target,
          editing_injection_id: logged.id,
        });
        expect(review.review.remainingAfterMl).toBe(
          String(3 - Number(review.deliveredVolumeMl))
        );
        const edited = await injections.updateInjection(owner, logged.id, {
          calculated_draw: {
            ...target,
            review_intent: true,
            expected_preview_state: review.review.state,
          },
        });
        expect(edited.dose_input_unit).toBe(unit);
        expect(edited.injected_at.toISOString()).toBe(
          '2026-11-14T12:13:14.123Z'
        );
        expect(edited.entry_date).toBe('2026-11-14');
      }
    });
    it('rejects stale and duplicate confirmations without extra deductions, including zero delivered draws', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const target = input('0');
      const preview = await previewMedicationDraw(owner, vial.id, target);
      const calculated_draw = {
        ...target,
        review_intent: true,
        expected_preview_state: preview.review.state,
      };
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          injections.createInjection(owner, {
            medication_id: med,
            pen_id: vial.id,
            deduct_pen: true,
            calculated_draw,
          })
        )
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { statusCode: 409 },
      });
      expect(
        (await stock.listPens(owner, med)).find(
          (p: MedicationPen) => p.id === vial.id
        )?.doses_used
      ).toBe(1);
    });
    it('binds a review to raw target and old entry while legacy authoritative edits remain compatible', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: input('0.2'),
      });
      const review = await previewMedicationDraw(owner, vial.id, {
        ...input('0.3'),
        editing_injection_id: logged.id,
      });
      await expect(
        injections.updateInjection(owner, logged.id, {
          calculated_draw: {
            ...input('0.4'),
            review_intent: true,
            expected_preview_state: review.review.state,
          },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        injections.updateInjection(owner, logged.id, { dose_mg: 0.3 })
      ).resolves.toMatchObject({ dose_mg: 0.3 });
      await expect(
        injections.updateInjection(owner, logged.id, {
          calculated_draw: { ...input('0.3'), review_intent: true },
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
    it('retains known original route and site across medication route changes, metadata edits and raw correction', async () => {
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: prep,
      });
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        calculated_draw: input('0.2'),
        site: 'abdomen',
      });
      expect(logged.administration_route).toBe('injection');
      const c = await getSystemClient();
      try {
        await c.query("UPDATE medications SET route_id='nasal' WHERE id=$1", [
          med,
        ]);
      } finally {
        c.release();
      }
      try {
        expect(
          await injections.updateInjection(owner, logged.id, {
            notes: 'Synthetic metadata',
          })
        ).toMatchObject({ administration_route: 'injection', site: 'abdomen' });
        const target = input('0.3');
        const preview = await previewMedicationDraw(owner, vial.id, {
          ...target,
          editing_injection_id: logged.id,
        });
        expect(preview.administrationRoute).toBe('injection');
        expect(
          await injections.updateInjection(owner, logged.id, {
            calculated_draw: {
              ...target,
              review_intent: true,
              expected_preview_state: preview.review.state,
            },
          })
        ).toMatchObject({ administration_route: 'injection', site: 'abdomen' });
      } finally {
        const reset = await getSystemClient();
        try {
          await reset.query(
            'UPDATE medications SET route_id=NULL WHERE id=$1',
            [med]
          );
        } finally {
          reset.release();
        }
      }
    });
  }
);
