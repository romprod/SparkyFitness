import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import * as stacks from '../models/medicationStackRepository.js';

describe.runIf(process.env.MEDICATION_STACKS_INTEGRATION === '1')(
  'medication stacks PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    let a: string, b: string, c: string, foreign: string;
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client: PoolClient = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const med = async (userId: string, name: string, supplement = false) =>
      (
        await admin((client) =>
          client.query(
            'INSERT INTO medications(user_id,name,type_id,is_supplement) VALUES($1,$2,$3,$4) RETURNING id',
            [userId, name, supplement ? 'softgel' : 'tablet', supplement]
          )
        )
      ).rows[0].id as string;

    beforeAll(async () => {
      await admin(async (client) => {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `stacks-${id}@example.test`]
          );
      });
      a = await med(owner, 'Omega 3', true);
      b = await med(owner, 'Magnesium', true);
      c = await med(owner, 'Sertraline');
      foreign = await med(other, 'Foreign');
    });
    afterAll(async () => {
      await admin((client) =>
        client.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });

    it('creates a stack and lists its members in the chosen order', async () => {
      const id = await stacks.createStack(owner, {
        name: 'Morning stack',
        notes: null,
        medication_ids: [b, a, c],
      });
      const [stack] = await stacks.listStacks(owner);
      expect(stack).toMatchObject({ id, name: 'Morning stack', notes: null });
      expect(stack!.members.map((m) => m.name)).toEqual([
        'Magnesium',
        'Omega 3',
        'Sertraline',
      ]);
      expect(stack!.members.map((m) => m.is_supplement)).toEqual([
        true,
        true,
        false,
      ]);
      expect(await stacks.listStacks(other)).toEqual([]);
    });

    it('replaces members and name on update, and reports a missing stack', async () => {
      const [stack] = await stacks.listStacks(owner);
      expect(
        await stacks.updateStack(owner, stack!.id, {
          name: 'Morning',
          notes: 'with breakfast',
          medication_ids: [c, a],
        })
      ).toBe(true);
      const [after] = await stacks.listStacks(owner);
      expect(after).toMatchObject({ name: 'Morning', notes: 'with breakfast' });
      expect(after!.members.map((m) => m.name)).toEqual([
        'Sertraline',
        'Omega 3',
      ]);
      expect(
        await stacks.updateStack(owner, randomUUID(), {
          name: 'Nope',
          notes: null,
          medication_ids: [a],
        })
      ).toBe(false);
      expect(
        await stacks.updateStack(other, stack!.id, {
          name: 'Stolen',
          notes: null,
          medication_ids: [foreign],
        })
      ).toBe(false);
    });

    it('rejects other people’s medications and duplicate names, leaving data unchanged', async () => {
      await expect(
        stacks.createStack(owner, {
          name: 'Bad',
          notes: null,
          medication_ids: [foreign],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        stacks.createStack(owner, {
          name: '  morning ',
          notes: null,
          medication_ids: [a],
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await stacks.listStacks(owner)).map((s) => s.name)).toEqual([
        'Morning',
      ]);
      await expect(
        admin((client) =>
          client.query(
            'INSERT INTO medication_stack_members(stack_id,user_id,medication_id,position) SELECT id,user_id,$1,9 FROM medication_stacks WHERE user_id=$2',
            [foreign, owner]
          )
        )
      ).rejects.toThrow(/owner's medications/);
    });

    it('drops a deleted medication from its stacks and keeps medications when a stack is deleted', async () => {
      await admin((client) =>
        client.query('DELETE FROM medications WHERE id=$1', [c])
      );
      const [stack] = await stacks.listStacks(owner);
      expect(stack!.members.map((m) => m.name)).toEqual(['Omega 3']);
      expect(await stacks.deleteStack(owner, stack!.id)).toBe(true);
      expect(await stacks.deleteStack(owner, stack!.id)).toBe(false);
      const left = await admin((client) =>
        client.query(
          'SELECT count(*)::int AS n FROM medications WHERE user_id=$1',
          [owner]
        )
      );
      expect(left.rows[0].n).toBe(2);
      expect(await stacks.listStacks(owner)).toEqual([]);
    });
  }
);
