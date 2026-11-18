import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { addDays } from '@workspace/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import entries from '../models/medicationEntryRepository.js';
import * as packs from '../models/medicationPackRepository.js';

describe.runIf(process.env.MEDICATION_PACKS_INTEGRATION === '1')(
  'tablet and capsule pack stock PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      med = randomUUID();
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const used = async (packId: string) =>
      (
        await admin((c) =>
          c.query(
            'SELECT units_used::text AS used, status, opened_at::text AS opened, finished_at FROM medication_packs WHERE id=$1',
            [packId]
          )
        )
      ).rows[0] as {
        used: string;
        status: string;
        opened: string | null;
        finished_at: Date | null;
      };
    const newPack = (
      over: Partial<Parameters<typeof packs.createPack>[2]> = {}
    ) =>
      packs.createPack(owner, med, {
        unit_label: 'tablets',
        units_total: 60,
        ...over,
      });
    const log = (
      over: Record<string, unknown> = {}
    ): ReturnType<typeof entries.createEntry> =>
      entries.createEntry(owner, {
        medication_id: med,
        status: 'taken',
        dose_amount_snapshot: 2,
        dose_unit_snapshot: 'tablet',
        ...over,
      } as never);
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `synthetic-packs-${id}@example.test`]
          );
        await c.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'UTC',14,3)",
          [owner]
        );
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,dose_amount,dose_unit,is_supplement) VALUES($1,$2,'Synthetic tablet','tablet',2,'tablet',false)",
          [med, owner]
        );
      });
    });
    afterAll(async () => {
      await admin((c) =>
        c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });

    it('deducts a taken dose from the open pack, and restores it exactly on delete', async () => {
      const open = (await newPack({ status: 'in_use' }))!;
      const entry = await log();
      expect(entry.pack_deduction).toMatchObject({
        deducted: true,
        pack_id: open,
      });
      expect((await used(open)).used).toBe('2.000');
      expect(entry.pack_units_deducted).toBe('2.000');
      await entries.deleteEntry(owner, entry.id);
      expect((await used(open)).used).toBe('0.000');
      await packs.deletePack(owner, open);
    });

    it('takes nothing for other units, skipped doses or an opt-out, and says why', async () => {
      const open = (await newPack({ status: 'in_use' }))!;
      expect((await log({ dose_unit_snapshot: 'mg' })).pack_deduction).toEqual({
        deducted: false,
        reason: 'unit_mismatch',
      });
      expect((await log({ status: 'skipped' })).pack_deduction).toEqual({
        deducted: false,
        reason: 'not_taken',
      });
      expect((await log({ deduct_pack: false })).pack_deduction).toEqual({
        deducted: false,
        reason: 'opted_out',
      });
      expect((await used(open)).used).toBe('0.000');
      await packs.deletePack(owner, open);
    });

    it('follows a status change in both directions', async () => {
      const open = (await newPack({ status: 'in_use' }))!;
      const entry = await log();
      expect((await used(open)).used).toBe('2.000');
      await entries.updateEntry(owner, entry.id, { status: 'skipped' });
      expect((await used(open)).used).toBe('0.000');
      const back = await entries.updateEntry(owner, entry.id, {
        status: 'taken',
      });
      expect((await used(open)).used).toBe('2.000');
      expect(back?.pack_id).toBe(open);
      await entries.deleteEntry(owner, entry.id);
      await packs.deletePack(owner, open);
    });

    it('opens the oldest sealed pack when none is open and prefers an explicit pack', async () => {
      const sealed = (await newPack())!;
      const second = (await newPack())!;
      const first = await log();
      expect(first.pack_deduction).toMatchObject({ pack_id: sealed });
      const afterOpen = await used(sealed);
      expect(afterOpen.status).toBe('in_use');
      expect(afterOpen.opened).not.toBeNull();
      const explicit = await log({ pack_id: second });
      expect(explicit.pack_deduction).toMatchObject({ pack_id: second });
      await expect(log({ pack_id: randomUUID() })).rejects.toMatchObject({
        statusCode: 422,
      });
      await entries.deleteEntry(owner, first.id);
      await entries.deleteEntry(owner, explicit.id);
      await packs.deletePack(owner, sealed);
      await packs.deletePack(owner, second);
    });

    it('finishes a pack at zero and reopens it when that dose is removed; overdraw is shown', async () => {
      const small = (await newPack({ status: 'in_use', units_total: 2 }))!;
      const emptying = await log();
      expect((await used(small)).status).toBe('finished');
      await entries.deleteEntry(owner, emptying.id);
      const reopened = await used(small);
      expect(reopened).toMatchObject({ status: 'in_use', used: '0.000' });
      expect(reopened.finished_at).toBeNull();
      await packs.deletePack(owner, small);

      const tiny = (await newPack({ status: 'in_use', units_total: 1 }))!;
      const over = await log();
      const view = (await packs.listPacks(owner)).packs.find(
        (p) => p.id === tiny
      )!;
      expect(view).toMatchObject({
        units_remaining: '-1.000',
        overdrawn: true,
        status: 'finished',
      });
      await entries.deleteEntry(owner, over.id);
      await packs.deletePack(owner, tiny);
    });

    it('derives doses left, a low flag and the observed pace', async () => {
      // Earlier cases leave taken entries that never touched a pack; start clean.
      await admin((c) =>
        c.query('DELETE FROM medication_entries WHERE medication_id = $1', [
          med,
        ])
      );
      const open = (await newPack({
        status: 'in_use',
        units_total: 30,
        reorder_threshold_units: 28,
      }))!;
      const made: string[] = [];
      for (let i = 0; i < 4; i++) made.push((await log()).id);
      const view = (await packs.listPacks(owner)).packs.find(
        (p) => p.id === open
      )!;
      expect(view.units_remaining).toBe('22.000');
      expect(view.doses_left).toBe('11');
      expect(view.low).toBe(true);
      // 8 units over the 14 day window, 22 left: 22 / (8/14) = 38 days.
      expect(view.observed_days_left).toBe(38);
      for (const id of made) await entries.deleteEntry(owner, id);
      await packs.deletePack(owner, open);
    });

    it('keeps the combined entries and injections listing working with pack columns', async () => {
      const open = (await newPack({ status: 'in_use' }))!;
      const entry = await log();
      const listed = await entries.listEntriesWithInjections(owner, {});
      const found = listed.find((row) => row.id === entry.id);
      expect(found).toMatchObject({
        pack_id: open,
        pack_units_deducted: '2.000',
      });
      await entries.deleteEntry(owner, entry.id);
      await packs.deletePack(owner, open);
    });

    it('requires an explicit lifecycle action for status changes', async () => {
      const id = (await newPack())!;
      await expect(
        packs.updatePack(owner, id, { status: 'in_use' })
      ).rejects.toMatchObject({ statusCode: 422 });
      await packs.updatePack(owner, id, {
        status: 'in_use',
        lifecycle_intent: true,
      });
      expect((await used(id)).status).toBe('in_use');
      await packs.deletePack(owner, id);
    });

    it('forecasts run-out from the medication schedule, per pack in draw order, and flags only the last pack', async () => {
      const planMed = randomUUID();
      await admin(async (c) => {
        await c.query(
          "INSERT INTO medications(id,user_id,name,type_id,dose_amount,dose_unit,is_supplement) VALUES($1,$2,'Synthetic scheduled tablet','tablet',2,'tablet',false)",
          [planMed, owner]
        );
        await c.query(
          "INSERT INTO medication_schedules(medication_id,user_id,schedule_type_id,start_date) VALUES($1,$2,'daily','2020-01-01')",
          [planMed, owner]
        );
      });
      const open = (await packs.createPack(owner, planMed, {
        unit_label: 'tablets',
        units_total: 20,
        status: 'in_use',
      }))!;
      let list = (await packs.listPacks(owner)).packs.find(
        (p) => p.id === open
      )!;
      // 2 tablets a day from today: 20 tablets last ten days, empty on the tenth dose day.
      expect(list.planned_days_left).toBe(9);
      expect(list.planned_empty_date).toBe(
        addDays((await packs.listPacks(owner)).today, 9)
      );
      expect(list.low).toBe(true);
      const spare = (await packs.createPack(owner, planMed, {
        unit_label: 'tablets',
        units_total: 60,
        status: 'sealed',
      }))!;
      const both = (await packs.listPacks(owner)).packs;
      list = both.find((p) => p.id === open)!;
      expect(list.planned_days_left).toBe(9);
      expect(list.low).toBe(false);
      expect(both.find((p) => p.id === spare)!.planned_days_left).toBe(39);
      // A pack in another unit family is never planned.
      const mg = (await packs.createPack(owner, planMed, {
        unit_label: 'mg',
        units_total: 500,
        status: 'sealed',
      }))!;
      expect(
        (await packs.listPacks(owner)).packs.find((p) => p.id === mg)!
          .planned_days_left
      ).toBeNull();
      await admin((c) =>
        c.query('DELETE FROM medications WHERE id=$1', [planMed])
      );
    });

    it('keeps one account from seeing or using another account pack', async () => {
      const mine = (await newPack({ status: 'in_use' }))!;
      expect((await packs.listPacks(other)).packs).toEqual([]);
      expect(await packs.deletePack(other, mine)).toBe(false);
      expect(await packs.updatePack(other, mine, { notes: 'not yours' })).toBe(
        false
      );
      await packs.deletePack(owner, mine);
    });
  }
);
