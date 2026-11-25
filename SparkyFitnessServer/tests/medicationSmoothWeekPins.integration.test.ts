import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import {
  listSmoothWeekPins,
  pinSmoothWeekMedication,
  unpinSmoothWeekMedication,
} from '../models/medicationSmoothWeekPinRepository.js';

describe.runIf(process.env.SMOOTH_PINS_INTEGRATION === '1')(
  'Smooth your week pins in isolated PostgreSQL',
  () => {
    const owner = randomUUID();
    const other = randomUUID();
    let ownMed: string;
    let otherMed: string;
    let doomedMed: string;

    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `pins-${id}@example.test`]
          );
        const add = async (user: string, name: string): Promise<string> =>
          (
            await c.query(
              "INSERT INTO public.medications (user_id,name,type_id) VALUES ($1,$2,'injection') RETURNING id",
              [user, name]
            )
          ).rows[0].id;
        ownMed = await add(owner, 'Synthetic pin one');
        doomedMed = await add(owner, 'Synthetic pin two');
        otherMed = await add(other, 'Synthetic pin other');
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });

    it('pins, lists, and pins again idempotently', async () => {
      expect(await listSmoothWeekPins(owner)).toEqual([]);
      expect(await pinSmoothWeekMedication(owner, ownMed)).toBe(true);
      expect(await pinSmoothWeekMedication(owner, ownMed)).toBe(true);
      expect(await listSmoothWeekPins(owner)).toEqual([ownMed]);
    });

    it('unpins, and unpinning again or an unknown id is fine', async () => {
      await unpinSmoothWeekMedication(owner, ownMed);
      await unpinSmoothWeekMedication(owner, ownMed);
      await unpinSmoothWeekMedication(owner, randomUUID());
      expect(await listSmoothWeekPins(owner)).toEqual([]);
    });

    it('keeps pins private and refuses a pin on someone else’s medication', async () => {
      expect(await pinSmoothWeekMedication(other, otherMed)).toBe(true);
      expect(await listSmoothWeekPins(owner)).toEqual([]);
      expect(await pinSmoothWeekMedication(owner, otherMed)).toBe(false);
      expect(await listSmoothWeekPins(other)).toEqual([otherMed]);
      // Unpinning another user's pin must not remove it.
      await unpinSmoothWeekMedication(owner, otherMed);
      expect(await listSmoothWeekPins(other)).toEqual([otherMed]);
    });

    it('rejects a forged row for another user at the database (RLS)', async () => {
      // Direct insert as the owner naming the other user must be blocked by the policy.
      const { getClient } = await import('../db/poolManager.js');
      const c = await getClient(owner);
      try {
        await expect(
          c.query(
            'INSERT INTO medication_smooth_week_pins (user_id, medication_id) VALUES ($1,$2)',
            [other, randomUUID()]
          )
        ).rejects.toThrow();
      } finally {
        c.release();
      }
    });

    it('drops the pin when the medication is deleted', async () => {
      expect(await pinSmoothWeekMedication(owner, doomedMed)).toBe(true);
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public.medications WHERE id=$1', [
          doomedMed,
        ]);
      } finally {
        c.release();
      }
      expect(await listSmoothWeekPins(owner)).toEqual([]);
    });
  }
);
