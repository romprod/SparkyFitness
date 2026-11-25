import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  medicationStackSetupInputSchema,
  type MedicationStackSetupRequest,
} from '@workspace/shared';
import { endPool, getSystemClient } from '../db/poolManager.js';

// Lets one test make the last write of the transaction fail, after everything before it succeeded.
const failure = vi.hoisted(() => ({ next: null as Error | null }));
vi.mock('../models/medicationStackRepository.js', async (original) => {
  const actual =
    await original<typeof import('../models/medicationStackRepository.js')>();
  return {
    ...actual,
    createStack: (...args: Parameters<typeof actual.createStack>) => {
      const error = failure.next;
      failure.next = null;
      return error ? Promise.reject(error) : actual.createStack(...args);
    },
  };
});
import { setupPremixedStack } from '../services/medicationStackSetupService.js';
import * as stacks from '../models/medicationStackRepository.js';

describe.runIf(process.env.MEDICATION_STACK_SETUP_INTEGRATION === '1')(
  'premixed stack setup PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const admin = async <T>(work: (client: PoolClient) => Promise<T>) => {
      const client: PoolClient = await getSystemClient();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    };
    const count = async (table: string, userId = owner) =>
      Number(
        (
          await admin((client) =>
            client.query(
              `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = $1`,
              [userId]
            )
          )
        ).rows[0].n
      );
    const request = (
      over: Partial<MedicationStackSetupRequest> = {}
    ): ReturnType<typeof medicationStackSetupInputSchema.parse> =>
      medicationStackSetupInputSchema.parse({
        operation_id: randomUUID(),
        name: 'Peptide stack',
        start_date: '2026-11-25',
        components: [
          {
            medication_name: 'Peptide A',
            concentration_value: 5,
            concentration_unit: 'mg/ml',
            vial_volume_ml: 5,
            quantity: 3,
            dose_volume_ml: 0.2,
          },
          {
            medication_name: 'Peptide B',
            concentration_value: 250,
            concentration_unit: 'mcg/ml',
            vial_volume_ml: 5,
            quantity: 1,
            dose_volume_ml: 0.1,
          },
        ],
        ...over,
      });

    beforeAll(async () => {
      await admin(async (client) => {
        for (const id of [owner, other])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `stack-setup-${id}@example.test`]
          );
        // Another person's medicine with the same name must never be matched.
        await client.query(
          "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Peptide A','injection')",
          [other]
        );
      });
    });
    afterAll(async () => {
      await admin((client) =>
        client.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ])
      );
      await endPool();
    });

    it('rolls everything back when the last write fails, then succeeds on a retry of the same request', async () => {
      const body = request({ name: 'Rollback stack' });
      failure.next = new Error('forced failure');
      await expect(setupPremixedStack(owner, body)).rejects.toThrow(
        'forced failure'
      );
      for (const table of [
        'medications',
        'medication_pens',
        'medication_preparations',
        'medication_courses',
        'medication_stacks',
        'medication_course_operations',
      ])
        expect(await count(table), table).toBe(0);

      // The receipt rolled back too, so the same operation id is free to run again.
      const result = await setupPremixedStack(owner, body);
      expect(result.stack.name).toBe('Rollback stack');
      await admin((client) =>
        client.query('DELETE FROM medication_stacks WHERE user_id=$1', [owner])
      );
    });

    it('creates the medicines, premixed vials, plans and stack with the right amounts', async () => {
      await admin(async (client) => {
        await client.query('DELETE FROM medications WHERE user_id=$1', [owner]);
        await client.query(
          'DELETE FROM medication_course_operations WHERE user_id=$1',
          [owner]
        );
      });
      const body = request();
      const result = await setupPremixedStack(owner, body);

      expect(result.stack.members.map((m) => m.name)).toEqual([
        'Peptide A',
        'Peptide B',
      ]);
      expect(result.components.map((c) => c.medication_created)).toEqual([
        true,
        true,
      ]);
      expect(result.components.map((c) => c.vial_ids.length)).toEqual([3, 1]);
      expect(
        result.components.map((c) => [c.dose_amount, c.dose_unit])
      ).toEqual([
        ['1', 'mg'],
        ['25', 'mcg'],
      ]);

      await admin(async (client) => {
        const medicine = await client.query(
          'SELECT name,type_id,is_active FROM medications WHERE user_id=$1 ORDER BY name',
          [owner]
        );
        expect(medicine.rows).toEqual([
          { name: 'Peptide A', type_id: 'injection', is_active: true },
          { name: 'Peptide B', type_id: 'injection', is_active: true },
        ]);
        const pens = await client.query(
          `SELECT p.status, p.kind, p.concentration_mg_ml::text AS conc, p.volume_ml::text AS vol,
                  q.mode, q.mass_mg::text AS mass_mg, q.label_concentration_value::text AS label
           FROM medication_pens p JOIN medication_preparations q ON q.pen_id = p.id
           WHERE p.user_id=$1 AND p.medication_id=$2 ORDER BY p.created_at, p.id`,
          [owner, result.components[0]!.medication_id]
        );
        expect(pens.rows.map((r) => r.status).sort()).toEqual([
          'in_use',
          'sealed',
          'sealed',
        ]);
        expect(pens.rows[0]).toMatchObject({
          kind: 'vial',
          conc: '5',
          vol: '5',
          mode: 'premixed',
          mass_mg: '25',
          label: '5',
        });
        const rule = await client.query(
          `SELECT r.dose_unit, r.target_dose::text AS target, q.schedule_type_id, q.dose_amount::text AS dose, r.start_date::text AS start
           FROM medication_courses c
           JOIN medication_course_revisions r ON r.id=c.current_revision_id
           JOIN medication_course_rules q ON q.revision_id=r.id
           WHERE c.user_id=$1 AND c.id=$2`,
          [owner, result.components[0]!.course_id]
        );
        expect(rule.rows).toEqual([
          {
            dose_unit: 'mg',
            target: '1',
            schedule_type_id: 'daily',
            dose: '1',
            start: '2026-11-25',
          },
        ]);
        const members = await client.query(
          'SELECT medication_id FROM medication_stack_members WHERE stack_id=$1 ORDER BY position',
          [result.stack.id]
        );
        expect(members.rows.map((r) => r.medication_id)).toEqual(
          result.components.map((c) => c.medication_id)
        );
      });

      // The other person's medicine of the same name was neither used nor touched.
      expect(await count('medication_pens', other)).toBe(0);
      expect(await count('medication_courses', other)).toBe(0);

      // A retry returns the first result and creates nothing.
      const before = {
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      };
      expect(await setupPremixedStack(owner, body)).toEqual(result);
      expect({
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      }).toEqual(before);
      expect((await stacks.listStacks(owner)).length).toBe(1);
    });

    it('reuses a medicine, then refuses one that already has an active plan, writing nothing', async () => {
      // "Peptide A" now has a running plan from the previous test.
      const before = {
        meds: await count('medications'),
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      };
      await expect(
        setupPremixedStack(
          owner,
          request({
            name: 'Second stack',
            components: [
              {
                medication_name: 'Peptide C',
                concentration_value: 5,
                concentration_unit: 'mg/ml',
                vial_volume_ml: 5,
                quantity: 1,
                dose_volume_ml: 0.2,
              },
              {
                medication_name: ' peptide a ',
                concentration_value: 5,
                concentration_unit: 'mg/ml',
                vial_volume_ml: 5,
                quantity: 1,
                dose_volume_ml: 0.2,
              },
            ],
          })
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          'peptide a already has an active plan. Add it to a stack from the stack list instead.',
      });
      expect({
        meds: await count('medications'),
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      }).toEqual(before);

      // A live legacy schedule refuses the request; an ended or inactive one does not.
      await admin(async (client) => {
        await client.query(
          "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Peptide L','injection')",
          [owner]
        );
        await client.query(
          `INSERT INTO medication_schedules(medication_id,user_id,schedule_type_id,active,end_date)
           SELECT id,user_id,'daily',true,NULL FROM medications WHERE user_id=$1 AND name='Peptide L'`,
          [owner]
        );
      });
      const legacyBefore = {
        meds: await count('medications'),
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      };
      const legacyRequest = (name: string) =>
        request({
          name,
          components: [
            {
              medication_name: 'peptide l',
              concentration_value: 5,
              concentration_unit: 'mg/ml',
              vial_volume_ml: 5,
              quantity: 1,
              dose_volume_ml: 0.2,
            },
          ],
        });
      await expect(
        setupPremixedStack(owner, legacyRequest('Legacy stack'))
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          'peptide l already has a schedule. Add it to a stack from the stack list instead.',
      });
      expect({
        meds: await count('medications'),
        pens: await count('medication_pens'),
        courses: await count('medication_courses'),
        stacks: await count('medication_stacks'),
      }).toEqual(legacyBefore);
      await admin((client) =>
        client.query(
          "UPDATE medication_schedules SET end_date='2020-01-01' WHERE user_id=$1",
          [owner]
        )
      );
      await expect(
        setupPremixedStack(owner, legacyRequest('Legacy stack'))
      ).resolves.toBeDefined();
      before.meds += 1;

      // A medicine with no plan is reused rather than duplicated.
      await admin((client) =>
        client.query(
          "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Peptide D','injection')",
          [owner]
        )
      );
      const reused = await setupPremixedStack(
        owner,
        request({
          name: 'Third stack',
          components: [
            {
              medication_name: 'peptide d',
              concentration_value: 5,
              concentration_unit: 'mg/ml',
              vial_volume_ml: 5,
              quantity: 1,
              dose_volume_ml: 0.2,
            },
          ],
        })
      );
      expect(reused.components[0]!.medication_created).toBe(false);
      expect(await count('medications')).toBe(before.meds + 1);

      // A stack name that exists is refused whole.
      await expect(
        setupPremixedStack(
          owner,
          request({
            name: ' third STACK ',
            components: [
              {
                medication_name: 'Peptide E',
                concentration_value: 5,
                concentration_unit: 'mg/ml',
                vial_volume_ml: 5,
                quantity: 1,
                dose_volume_ml: 0.2,
              },
            ],
          })
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await count('medications')).toBe(before.meds + 1);
    });
  }
);
