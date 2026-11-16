import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { remainingDrawVolume } from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import { loadInventoryForecastSnapshot } from '../models/medicationInventoryForecastRepository.js';

describe.runIf(process.env.INVENTORY_FORECAST_SNAPSHOT_INTEGRATION === '1')(
  'read-only inventory forecast snapshot PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      delegate = randomUUID(),
      reader = randomUUID();
    const now = new Date('2026-11-16T23:30:00Z');
    const admin = async <T>(fn: (client: PoolClient) => Promise<T>) => {
      const client = await getSystemClient();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    };
    const read = async (actor = owner) => {
      const client: PoolClient = await getClient(owner, actor);
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await loadInventoryForecastSnapshot(client, owner, now);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (client) => {
        for (const id of [owner, other, delegate, reader])
          await client.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `forecast-snapshot-${id}@example.test`]
          );
        for (const [actor, key] of [
          [delegate, 'can_manage_medications'],
          [reader, 'can_view_reports'],
        ])
          await client.query(
            "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,$3::jsonb,$4,'active')",
            [
              owner,
              actor,
              JSON.stringify({ [key!]: true }),
              `synthetic-${actor}@example.test`,
            ]
          );
      });
    });
    afterAll(async () => {
      await admin(async (client) => {
        await client.query(
          'DELETE FROM public."user" WHERE id=ANY($1::uuid[])',
          [[owner, other, delegate, reader]]
        );
      });
      await endPool();
    });
    const medication = async (
      user = owner,
      type = 'injection',
      route: string | null = null
    ) =>
      admin(
        async (client) =>
          (
            await client.query<{ id: string }>(
              "INSERT INTO medications(user_id,name,type_id,route_id,dose_amount,dose_unit,is_glp1) VALUES($1,'Synthetic forecast product',$2,$3,0.125,'mg',false) RETURNING id",
              [user, type, route]
            )
          ).rows[0]!.id
      );
    const stock = async (
      medicationId: string,
      options: {
        user?: string;
        prepared?: boolean;
        status?: string;
        bud?: string | null;
        budMode?: string | null;
        interval?: number | null;
        base?: string | null;
        source?: string | null;
        mass?: string;
        volume?: string;
        dose?: string | null;
        used?: number;
        expiry?: string | null;
        retired?: boolean;
      } = {}
    ) =>
      admin(async (client) => {
        const user = options.user ?? owner,
          id = randomUUID(),
          prep = options.prepared === false ? null : randomUUID(),
          mass = options.mass ?? '9.3000000000000000000000000003',
          volume = options.volume ?? '3';
        await client.query(
          "INSERT INTO medication_pens(id,user_id,medication_id,kind,concentration_mg_ml,volume_ml,doses_used,status,opened_at,expiry_date,bud_date,bud_mode,bud_interval_days,bud_base_date,bud_source,finished_at,created_at) VALUES($1,$2,$3,'vial',3.1,$4,$5,$6,'2026-11-01',$7,$8,$9,$10,$11,$12,$13,'2026-10-01T12:00:00Z')",
          [
            id,
            user,
            medicationId,
            volume,
            options.used ?? (options.dose === undefined ? 0 : 1),
            options.status ?? 'in_use',
            options.expiry ?? null,
            options.bud === undefined ? '2026-12-01' : options.bud,
            options.budMode ?? null,
            options.interval ?? null,
            options.base ?? null,
            options.source ?? null,
            options.retired ? '2026-11-15T12:00:00Z' : null,
          ]
        );
        if (prep)
          await client.query(
            "INSERT INTO medication_preparations(id,user_id,medication_id,pen_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date,created_at) VALUES($1,$2,$3,$4,'reconstituted',$5,'mg',$6,$5,$5::numeric/$6::numeric,'2026-11-01','2026-11-01T08:00:00Z')",
            [prep, user, medicationId, id, mass, volume]
          );
        if (options.dose !== undefined)
          await client.query(
            "INSERT INTO injection_entries(user_id,medication_id,pen_id,preparation_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,$4,$5,'2026-01-01','2026-01-01T08:00:00Z')",
            [user, medicationId, id, prep, options.dose]
          );
        return { id, prep };
      });
    it('uses source defaults without inserting preferences and preserves explicit zero and owner timezone', async () => {
      await admin(async (client) => {
        await client.query('DELETE FROM user_preferences WHERE user_id=$1', [
          owner,
        ]);
      });
      const missing = await read();
      expect(missing.defaults).toEqual({ lead_days: 14, buffer_days: 3 });
      expect(missing.timezone).toBe('UTC');
      expect(
        await admin(
          async (client) =>
            (
              await client.query(
                'SELECT user_id FROM user_preferences WHERE user_id=$1',
                [owner]
              )
            ).rowCount
        )
      ).toBe(0);
      await admin(async (client) => {
        await client.query(
          "INSERT INTO user_preferences(user_id,timezone,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,'Pacific/Kiritimati',0,0)",
          [owner]
        );
      });
      const zero = await read();
      expect(zero.defaults).toEqual({ lead_days: 0, buffer_days: 0 });
      expect(zero.today).toBe('2026-11-17');
    });
    it('uses exact preparation concentration and all lifetime physical history, not rounded legacy stock or report-window doses', async () => {
      const med = await medication();
      const vial = await stock(med, { dose: '0.31' });
      const snapshot = await read();
      const row = snapshot.medications.find((m) => m.id === med)!;
      const container = row.containers.find((c) => c.id === vial.id)!;
      expect(container.concentration_mcg_ml).toBe(
        '3100.0000000000000000000000001'
      );
      expect(container.remaining_ml).toBe(
        remainingDrawVolume('3100.0000000000000000000000001', '3', '0.31')
      );
      expect(container.usable_until).toBe('2026-12-01');
      expect(row.stock_limitations).toEqual([]);
      expect(row.is_glp1).toBe(false);
      expect(row.legacy_entries[0]!.entry_date).toBe('2026-01-01');
    });
    it('keeps exact legacy prepared stock evaluable with an absolute BUD but never derives interval BUD without a preparation', async () => {
      const med = await medication();
      const absolute = await stock(med, { prepared: false, dose: '0.31' });
      const interval = await stock(med, {
        prepared: false,
        bud: '2026-12-01',
        budMode: 'interval',
        interval: 30,
        base: '2026-11-01',
        source: 'Synthetic supplier',
      });
      const row = (await read()).medications.find((m) => m.id === med)!;
      expect(row.containers.find((c) => c.id === absolute.id)).toMatchObject({
        concentration_mcg_ml: '3100',
        remaining_ml: '2.9',
        usable_until: '2026-12-01',
      });
      expect(
        row.containers.find((c) => c.id === interval.id)!.usable_until
      ).toBeNull();
      expect(row.stock_limitations).toContain('unknown_bud');
    });
    it.each([{ dose: null }, { dose: '0' }, { dose: undefined, used: 1 }])(
      'refuses exact remaining volume when linked history is missing, unknown or count-mismatched: %j',
      async (options) => {
        const med = await medication();
        const vial = await stock(med, options);
        const row = (await read()).medications.find((m) => m.id === med)!;
        expect(
          row.containers.find((c) => c.id === vial.id)!.remaining_ml
        ).toBeNull();
        expect(row.stock_limitations).toContain('unknown_stock');
      }
    );
    it('requires an explicit BUD even with expiry and derives only recorded preparation interval bases, including zero', async () => {
      const med = await medication();
      const unknown = await stock(med, { bud: null, expiry: '2026-11-30' });
      const zero = await stock(med, {
        bud: null,
        budMode: 'interval',
        interval: 0,
        base: '2026-11-01',
        source: 'Synthetic explicit interval',
      });
      const clamped = await stock(med, {
        bud: '2026-12-01',
        expiry: '2026-11-20',
      });
      const row = (await read()).medications.find((m) => m.id === med)!;
      expect(
        row.containers.find((c) => c.id === unknown.id)!.usable_until
      ).toBeNull();
      expect(row.containers.find((c) => c.id === zero.id)!.usable_until).toBe(
        '2026-11-01'
      );
      expect(
        row.containers.find((c) => c.id === clamped.id)!.usable_until
      ).toBe('2026-11-20');
      expect(row.stock_limitations).toContain('unknown_bud');
    });
    it('excludes sealed unprepared and retired/finished/discarded stock without simulating opening or changing saved facts', async () => {
      const med = await medication(owner, 'nasal_spray', 'nasal');
      const sealed = await stock(med, { status: 'sealed', prepared: false });
      const prepared = await stock(med, { status: 'sealed' });
      const retired = await stock(med, { retired: true });
      const finished = await stock(med, { status: 'finished' });
      const discarded = await stock(med, { status: 'discarded' });
      const row = (await read()).medications.find((m) => m.id === med)!;
      expect(row.route_id).toBe('nasal');
      expect(row.containers.map((c) => c.id)).toEqual([prepared.id]);
      expect(row.stock_limitations).toContain('sealed_stock_excluded');
      expect(row.containers.map((c) => c.id)).not.toEqual(
        expect.arrayContaining([
          sealed.id,
          retired.id,
          finished.id,
          discarded.id,
        ])
      );
    });
    it('returns only actual saved owner/global devices and a real saved preferred ID, without choosing a first device', async () => {
      const ids = await admin(async (client) => {
        const own = (
          await client.query<{ id: string }>(
            "INSERT INTO medication_syringes(user_id,name,device_type,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES($1,'Synthetic owned device','syringe','units',100,1,100,1) RETURNING id",
            [owner]
          )
        ).rows[0]!.id;
        const global = (
          await client.query<{ id: string }>(
            "INSERT INTO medication_syringes(user_id,name,device_type,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES(NULL,'Synthetic forecast global device','syringe','units',100,1,100,1) RETURNING id"
          )
        ).rows[0]!.id;
        const foreign = (
          await client.query<{ id: string }>(
            "INSERT INTO medication_syringes(user_id,name,device_type,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES($1,'Synthetic foreign device','syringe','units',100,1,100,1) RETURNING id",
            [other]
          )
        ).rows[0]!.id;
        return { own, global, foreign };
      });
      try {
        const first = await read();
        expect(first.devices.map((d) => d.id)).toEqual(
          expect.arrayContaining([ids.own, ids.global])
        );
        expect(first.devices.some((d) => d.id === ids.foreign)).toBe(false);
        expect(first.preferred_device_id).toBeNull();
        await admin(async (client) => {
          await client.query(
            'INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_syringe_id=$2',
            [owner, ids.global]
          );
        });
        expect((await read()).preferred_device_id).toBe(ids.global);
      } finally {
        await admin(async (client) => {
          await client.query(
            'DELETE FROM medication_device_preferences WHERE user_id=$1',
            [owner]
          );
          await client.query('DELETE FROM medication_syringes WHERE id=$1', [
            ids.global,
          ]);
        });
      }
    });
    it('retains authored legacy and complete explicitly attributed course histories on the same snapshot without guessing associations', async () => {
      const med = await medication();
      const course = randomUUID(),
        revision = randomUUID(),
        rule = randomUUID(),
        legacy = randomUUID();
      await admin(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            "INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,capture_day,timezone,captured_at) VALUES($1,$2,$3,'Synthetic course snapshot','2026-01-01','UTC','2026-01-01T00:00:00Z')",
            [course, owner, med]
          );
          await client.query(
            "INSERT INTO medication_course_revisions(id,user_id,course_id,revision_no,name,start_date,dose_unit,dose_basis) VALUES($1,$2,$3,1,'Synthetic plan','2026-01-01','mg','per_injection')",
            [revision, owner, course]
          );
          await client.query(
            "INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,schedule_type_id,time_of_day,days_of_week) VALUES($1,$2,$3,0,'weekly','08:00',ARRAY[1,4])",
            [rule, owner, revision]
          );
          await client.query(
            'UPDATE medication_courses SET current_revision_id=$2 WHERE id=$1',
            [course, revision]
          );
          await client.query(
            "INSERT INTO medication_schedules(id,user_id,medication_id,schedule_type_id,dose_amount,time_of_day,start_date) VALUES($1,$2,$3,'daily',0.12345678901234567890123456789,'10:00','2026-01-01')",
            [legacy, owner, med]
          );
          await client.query(
            "INSERT INTO medication_titration_steps(user_id,medication_id,dose_mg,dose_unit,step_order,status) VALUES($1,$2,0.12345678901234567890123456789,'mg',0,'active')",
            [owner, med]
          );
          await client.query(
            "INSERT INTO medication_entries(user_id,medication_id,schedule_id,entry_date,taken_at,scheduled_for,scheduled_day,status) VALUES($1,$2,$3,'2026-01-01','2026-01-01T10:12:00Z','2026-01-01T10:00:00Z','2026-01-01','taken')",
            [owner, med, legacy]
          );
          await client.query(
            "INSERT INTO injection_entries(user_id,medication_id,course_revision_id,course_rule_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,$4,0.125,'2026-01-02','2026-01-02T08:00:00Z')",
            [owner, med, revision, rule]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      const row = (await read()).medications.find((m) => m.id === med)!;
      expect(row.courses[0]!.revisions[0]).toMatchObject({
        device_choice: 'preferred',
        device_id: null,
      });
      expect(row.actuals).toHaveLength(1);
      expect(row.actuals[0]!.course_revision_id).toBe(revision);
      expect(row.legacy_entries).toHaveLength(2);
      expect(
        row.legacy_entries.find((a) => a.source_kind === 'entry')
      ).toMatchObject({
        schedule_id: legacy,
        scheduled_day: '2026-01-01',
        scheduled_for: '2026-01-01T10:00:00.000Z',
        course_origin: null,
      });
      expect(row.legacy_schedules[0]!.dose_amount).toBe(
        '0.12345678901234567890123456789'
      );
      expect(row.legacy_titration[0]!.dose_mg).toBe(
        '0.12345678901234567890123456789'
      );
    });
    it('uses one caller-owned repeatable-read read-only transaction across stock, preferences, devices and histories', async () => {
      const med = await medication();
      await stock(med);
      const client: PoolClient = await getClient(owner);
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const before = await loadInventoryForecastSnapshot(client, owner, now);
        await admin(async (writer) => {
          await writer.query(
            'UPDATE user_preferences SET medication_reorder_lead_days=99 WHERE user_id=$1',
            [owner]
          );
        });
        await stock(med, { prepared: false, status: 'sealed' });
        const during = await loadInventoryForecastSnapshot(client, owner, now);
        expect(during).toEqual(before);
        expect(
          (await client.query('SHOW transaction_isolation')).rows[0]
            .transaction_isolation
        ).toBe('repeatable read');
        expect(
          (await client.query('SHOW transaction_read_only')).rows[0]
            .transaction_read_only
        ).toBe('on');
        await client.query('COMMIT');
        const after = await read();
        expect(after.defaults.lead_days).toBe(99);
        expect(
          after.medications.find((m) => m.id === med)!.stock_limitations
        ).toContain('sealed_stock_excluded');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('preserves existing medication read permissions and never leaks another owner stock or devices', async () => {
      const med = await medication(other);
      await stock(med, { user: other });
      const own = await read();
      const delegated = await read(delegate);
      const reports = await read(reader);
      expect(delegated.medications.map((m) => m.id)).toEqual(
        own.medications.map((m) => m.id)
      );
      expect(delegated.defaults).toEqual(own.defaults);
      expect(delegated.timezone).toBe('Pacific/Kiritimati');
      expect(delegated.today).toBe('2026-11-17');
      expect(reports.defaults).toEqual(own.defaults);
      expect(reports.medications.map((m) => m.id)).toEqual(
        own.medications.map((m) => m.id)
      );
      expect(own.medications.some((m) => m.id === med)).toBe(false);
      expect((await read(other)).medications).toEqual([]);
    });
    it('does not create or mutate preferences, devices, plans, actuals, stock or preparation metadata', async () => {
      const tables = [
        'user_preferences',
        'medication_device_preferences',
        'medications',
        'medication_pens',
        'medication_preparations',
        'medication_entries',
        'injection_entries',
        'medication_schedules',
        'medication_titration_steps',
        'medication_courses',
        'medication_course_revisions',
        'medication_course_rules',
        'medication_course_steps',
        'medication_course_activity',
        'medication_course_operations',
      ];
      const fingerprint = () =>
        admin(async (client) => {
          const result: unknown[] = [];
          for (const table of tables)
            result.push(
              (
                await client.query<{ rows: unknown }>(
                  `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE user_id=$1`,
                  [owner]
                )
              ).rows[0]!.rows
            );
          return result;
        });
      const before = await fingerprint();
      await read();
      await read();
      expect(await fingerprint()).toEqual(before);
    });
  }
);
