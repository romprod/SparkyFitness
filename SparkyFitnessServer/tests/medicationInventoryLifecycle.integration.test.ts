import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import {
  getSystemClient,
  endPool,
  dbContextStorage,
} from '../db/poolManager.js';
import {
  createMedicationCourse,
  getMedicationCourse as readMedicationCourse,
  editMedicationCourse,
  reviewMedicationCourse,
  reviseMedicationCourse,
  reviewMedicationCourseCreate,
} from '../services/medicationCourseService.js';
import {
  getMedicationReorderDefaults,
  saveMedicationReorderDefaults,
} from '../services/medicationReorderService.js';
import { medicationCoursePlanFixture } from './fixtures/medicationCourseFixture.js';

const getMedicationCourse = async (owner: string, id: string) =>
  (await readMedicationCourse(owner, id)).course;

describe.runIf(process.env.INVENTORY_FORECAST_LIFECYCLE_INTEGRATION === '1')(
  'inventory forecast device and owner settings PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const now = new Date('2026-11-16T12:00:00Z');
    const admin = async <T>(work: (c: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await work(c);
      } finally {
        c.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `inventory-lifecycle-${id}@example.test`]
          );
      });
    });
    afterAll(async () => {
      await admin(async (c) => {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ]);
      });
      await endPool();
    });
    const device = async (user: string | null = owner, type = 'syringe') =>
      admin(
        async (c) =>
          (
            await c.query<{ id: string }>(
              "INSERT INTO medication_syringes(user_id,name,device_type,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES($1,'Synthetic binding',$2,'units',100,1,100,1) RETURNING id",
              [user, type]
            )
          ).rows[0]!.id
      );
    const med = () =>
      admin(
        async (c) =>
          (
            await c.query<{ id: string }>(
              "INSERT INTO medications(user_id,name,type_id,route_id,is_glp1) VALUES($1,'Synthetic non-GLP peptide','injection','subcutaneous',false) RETURNING id",
              [owner]
            )
          ).rows[0]!.id
      );
    const preferred = async (id: string) =>
      admin((c) =>
        c.query(
          'INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_syringe_id=EXCLUDED.default_syringe_id',
          [owner, id]
        )
      );
    const create = async (deviceId?: string | null) => {
      const medication = await med();
      const plan = { ...medicationCoursePlanFixture(), device_id: deviceId };
      const result = await createMedicationCourse(
        owner,
        {
          ...plan,
          medication_id: medication,
          expected_version: 0,
          operation_id: randomUUID(),
          native_reminder_limitation_acknowledged: false,
        },
        now
      );
      return { medication, plan, result };
    };
    it('reads missing owner defaults without a preference insert; accepts known zero and rejects delegated writes', async () => {
      expect(await getMedicationReorderDefaults(owner)).toEqual({
        lead_days: 14,
        buffer_days: 3,
      });
      expect(
        await admin(
          async (c) =>
            (
              await c.query('SELECT 1 FROM user_preferences WHERE user_id=$1', [
                owner,
              ])
            ).rows
        )
      ).toHaveLength(0);
      expect(
        await saveMedicationReorderDefaults(owner, {
          lead_days: 0,
          buffer_days: 0,
        })
      ).toEqual({ lead_days: 0, buffer_days: 0 });
      await expect(
        dbContextStorage.run({ authenticatedUserId: other }, () =>
          saveMedicationReorderDefaults(owner, {
            lead_days: 99,
            buffer_days: 99,
          })
        )
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await getMedicationReorderDefaults(owner)).toEqual({
        lead_days: 0,
        buffer_days: 0,
      });
    });
    it('allows real owner and global devices; rejects foreign or incompatible explicit devices atomically', async () => {
      for (const user of [owner, null]) {
        const id = await device(user);
        const x = await create(id);
        expect(
          (await getMedicationCourse(owner, x.result.course_id)).revisions[0]
        ).toMatchObject({ device_id: id, device_choice: 'explicit' });
      }
      for (const id of [await device(other), await device(owner, 'pump')]) {
        const medication = await med();
        await expect(
          createMedicationCourse(
            owner,
            {
              ...medicationCoursePlanFixture(),
              device_id: id,
              medication_id: medication,
              expected_version: 0,
              operation_id: randomUUID(),
              native_reminder_limitation_acknowledged: false,
            },
            now
          )
        ).rejects.toMatchObject({ statusCode: 422 });
        expect(
          await admin(
            async (c) =>
              (
                await c.query(
                  'SELECT 1 FROM medication_courses WHERE medication_id=$1',
                  [medication]
                )
              ).rows
          )
        ).toHaveLength(0);
      }
    });
    it('deleted explicit device remains missing through omitted old-client edit and successor; explicit null chooses preferred', async () => {
      const id = await device(),
        fallback = await device();
      await preferred(fallback);
      const x = await create(id);
      const savedActual = await admin(
        async (c) =>
          (
            await c.query<{ id: string }>(
              "INSERT INTO medication_entries(user_id,medication_id,entry_date,taken_at,status,med_name_snapshot,dose_amount_snapshot,dose_unit_snapshot,course_revision_id) VALUES($1,$2,'2026-11-16','2026-11-16T12:00:00Z','taken','Synthetic recorded label',1,'mg',$3) RETURNING id",
              [owner, x.medication, x.result.revision_id]
            )
          ).rows[0]!.id
      );
      const actualSnapshot = () =>
        admin(
          async (c) =>
            (
              await c.query(
                'SELECT to_jsonb(e) AS value FROM medication_entries e WHERE id=$1',
                [savedActual]
              )
            ).rows[0]!.value
        );
      const beforeActual = await actualSnapshot();
      await admin((c) =>
        c.query('DELETE FROM medication_syringes WHERE id=$1', [id])
      );
      let course = await getMedicationCourse(owner, x.result.course_id);
      expect(course.revisions[0]).toMatchObject({
        device_id: null,
        device_choice: 'explicit',
      });
      await editMedicationCourse(
        owner,
        course.id,
        {
          ...medicationCoursePlanFixture(),
          expected_version: course.version,
          operation_id: randomUUID(),
        },
        now
      );
      course = await getMedicationCourse(owner, course.id);
      const input = {
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-20',
        expected_version: course.version,
      };
      const review = await reviewMedicationCourse(owner, course.id, input, now);
      expect(review.device_binding).toMatchObject({
        choice: 'explicit',
        device_id: null,
        source: 'missing',
      });
      expect(review.plan.device_id).toBeUndefined();
      await reviseMedicationCourse(
        owner,
        course.id,
        {
          ...input,
          review_fingerprint: review.review_fingerprint,
          operation_id: randomUUID(),
        },
        now
      );
      course = await getMedicationCourse(owner, course.id);
      expect(course.revisions.at(-1)).toMatchObject({
        device_id: null,
        device_choice: 'explicit',
      });
      await editMedicationCourse(
        owner,
        course.id,
        {
          ...input,
          device_id: null,
          expected_version: course.version,
          operation_id: randomUUID(),
        },
        now
      );
      course = await getMedicationCourse(owner, course.id);
      expect(course.revisions.at(-1)).toMatchObject({
        device_id: null,
        device_choice: 'preferred',
      });
      expect(
        (
          await reviewMedicationCourse(
            owner,
            course.id,
            { ...input, device_id: null, expected_version: course.version },
            now
          )
        ).device_binding
      ).toMatchObject({ source: 'preferred', device_id: fallback });
      expect(await actualSnapshot()).toEqual(beforeActual);
    });
    it('binds review to real preferred device geometry and rejects changed geometry at successor commit', async () => {
      const id = await device();
      await preferred(id);
      const x = await create();
      const input = {
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-21',
        expected_version: x.result.version,
      };
      const review = await reviewMedicationCourse(
        owner,
        x.result.course_id,
        input,
        now
      );
      await admin((c) =>
        c.query('UPDATE medication_syringes SET increment=2 WHERE id=$1', [id])
      );
      await expect(
        reviseMedicationCourse(
          owner,
          x.result.course_id,
          {
            ...input,
            review_fingerprint: review.review_fingerprint,
            operation_id: randomUUID(),
          },
          now
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(
        (await getMedicationCourse(owner, x.result.course_id)).version
      ).toBe(x.result.version);
    });
    it('create review reports actual preferred binding without inventing an explicit saved plan choice', async () => {
      const id = await device();
      await preferred(id);
      const medication = await med();
      const review = await reviewMedicationCourseCreate(
        owner,
        medication,
        { ...medicationCoursePlanFixture(), expected_version: 0 },
        now
      );
      expect(review.device_binding).toMatchObject({
        choice: 'preferred',
        source: 'preferred',
        device_id: id,
      });
      expect(review.plan.device_id).toBeUndefined();
    });
  }
);
