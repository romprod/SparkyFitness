import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import {
  loadInventoryDashboardStock,
  loadInventoryForecastSnapshot,
} from '../models/medicationInventoryForecastRepository.js';
import { classifyInventoryPreparation } from '../services/medicationInventoryDashboardClassification.js';

describe.runIf(process.env.INVENTORY_DASHBOARD_SNAPSHOT_INTEGRATION === '1')(
  'inventory preparation queue raw snapshot PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      delegate = randomUUID(),
      reader = randomUUID();
    const now = new Date('2026-11-16T12:00:00Z');
    const admin = async <T>(fn: (client: PoolClient) => Promise<T>) => {
      const c = await getSystemClient();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    };
    const read = async (actor = owner, id?: string) => {
      const c: PoolClient = await getClient(owner, actor);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const rows = await loadInventoryDashboardStock(c, owner, id);
        await c.query('COMMIT');
        return rows;
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    };
    beforeAll(async () => {
      expect(process.env.SPARKY_FITNESS_DB_NAME).toMatch(/test/);
      await admin(async (c) => {
        for (const id of [owner, other, delegate, reader])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `dashboard-snapshot-${id}@example.test`]
          );
        for (const [actor, key] of [
          [delegate, 'can_manage_medications'],
          [reader, 'can_view_reports'],
        ])
          await c.query(
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
      await admin(async (c) => {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other, delegate, reader],
        ]);
      });
      await endPool();
    });
    const stock = async (
      options: {
        user?: string;
        type?: string;
        route?: string | null;
        kind?: string;
        status?: string;
        opened?: string | null;
        finished?: string | null;
        concentration?: string | null;
        volume?: string | null;
        used?: number;
        dose?: string | null;
        total?: number | null;
      } = {}
    ) =>
      admin(async (c) => {
        const user = options.user ?? owner;
        const med = (
          await c.query<{ id: string }>(
            "INSERT INTO medications(user_id,name,type_id,route_id,is_glp1) VALUES($1,'Synthetic queue medication',$2,$3,false) RETURNING id",
            [user, options.type ?? 'injection', options.route ?? null]
          )
        ).rows[0]!.id;
        const id = (
          await c.query<{ id: string }>(
            "INSERT INTO medication_pens(user_id,medication_id,kind,label,label_mass_mg,dose_mg,doses_total,doses_used,status,opened_at,finished_at,concentration_mg_ml,volume_ml,expiry_date,bud_date) VALUES($1,$2,$3::text,'Synthetic sealed label',CASE WHEN $3::text='vial' THEN 10.12345678901234567890123456789 ELSE NULL END,$4,$5,$6,$7,$8,$9,$10,$11,'2027-01-01','2026-12-01') RETURNING id",
            [
              user,
              med,
              options.kind ?? 'vial',
              options.dose ?? null,
              options.total ?? null,
              options.used ?? 0,
              options.status ?? 'sealed',
              options.opened ?? null,
              options.finished ?? null,
              options.concentration ?? null,
              options.volume ?? null,
            ]
          )
        ).rows[0]!.id;
        return { id, med, user };
      });
    const preparation = async (f: Awaited<ReturnType<typeof stock>>) =>
      admin(
        async (c) =>
          (
            await c.query<{ id: string }>(
              "INSERT INTO medication_preparations(user_id,medication_id,pen_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date) VALUES($1,$2,$3,'reconstituted',10,'mg',2,10,5,'2026-11-01') RETURNING id",
              [f.user, f.med, f.id]
            )
          ).rows[0]!.id
      );
    it('preserves exact label and strict null physical facts while nominal dose/count metadata remains eligible', async () => {
      const f = await stock({ dose: '2.5000000000000000000001', total: 8 });
      const row = (await read(owner, f.id))[0]!;
      expect(row).toMatchObject({
        id: f.id,
        medication_id: f.med,
        type_id: 'injection',
        route_id: null,
        kind: 'vial',
        label: 'Synthetic sealed label',
        label_mass_mg: '10.12345678901234567890123456789',
        dose_mg: '2.5000000000000000000001',
        doses_total: 8,
        status: 'sealed',
        finished_at: null,
        opened_at: null,
        doses_used: 0,
        concentration_mg_ml: null,
        volume_ml: null,
        current_preparation_id: null,
        prior_preparation: false,
        linked_actual_count: '0',
        expiry_date: '2027-01-01',
        bud_date: '2026-12-01',
      });
      expect(classifyInventoryPreparation(row)).toBe('needs_preparation');
      const c: PoolClient = await getClient(owner);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const snapshot = await loadInventoryForecastSnapshot(c, owner, now);
        expect(snapshot.dashboard_stock.find((s) => s.id === f.id)).toEqual(
          row
        );
        expect(
          snapshot.medications.find((m) => m.id === f.med)!.containers
        ).toEqual([]);
        expect(
          snapshot.medications.find((m) => m.id === f.med)!.stock_limitations
        ).toContain('sealed_stock_excluded');
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    });
    it('never interprets in-use unknown stock or an opened sealed row as an unprepared queue entry', async () => {
      const used = await stock({ status: 'in_use' }),
        opened = await stock({ opened: '2026-11-01' });
      expect(
        classifyInventoryPreparation((await read(owner, used.id))[0]!)
      ).toBe('unknown');
      expect(
        classifyInventoryPreparation((await read(owner, opened.id))[0]!)
      ).toBe('unknown');
    });
    it.each([
      { concentration: '0' },
      { volume: '0' },
      { concentration: '5' },
      { volume: '2' },
    ])(
      'keeps non-null physical values distinct from absence: %j',
      async (options) => {
        const f = await stock(options);
        const row = (await read(owner, f.id))[0]!;
        expect(row.concentration_mg_ml).toBe(options.concentration ?? null);
        expect(row.volume_ml).toBe(options.volume ?? null);
        expect(classifyInventoryPreparation(row)).toBe('unknown');
      }
    );
    it('retains all-time linked actual evidence even when mass is unknown or the dose counter says zero', async () => {
      const f = await stock();
      await admin(async (c) => {
        await c.query(
          "INSERT INTO injection_entries(user_id,medication_id,pen_id,dose_mg,entry_date,injected_at) VALUES($1,$2,$3,NULL,'2020-01-01','2020-01-01T08:00:00Z')",
          [owner, f.med, f.id]
        );
      });
      const row = (await read(owner, f.id))[0]!;
      expect(row.doses_used).toBe(0);
      expect(row.linked_actual_count).toBe('1');
      expect(classifyInventoryPreparation(row)).toBe(
        'used_without_preparation'
      );
      const countOnly = await stock({ used: 1 });
      expect(
        classifyInventoryPreparation((await read(owner, countOnly.id))[0]!)
      ).toBe('used_without_preparation');
    });
    it('distinguishes known legacy physical stock and compatible nasal vials without applying a GLP-1 filter', async () => {
      const physical = await stock({ concentration: '5', volume: '2' }),
        nasal = await stock({ type: 'nasal_spray', route: 'nasal' }),
        pen = await stock({ kind: 'pen' }),
        oral = await stock({ type: 'tablet', route: 'oral' });
      expect(
        classifyInventoryPreparation((await read(owner, physical.id))[0]!)
      ).toBe('legacy_physical');
      expect(
        classifyInventoryPreparation((await read(owner, nasal.id))[0]!)
      ).toBe('needs_preparation');
      expect(
        classifyInventoryPreparation((await read(owner, pen.id))[0]!)
      ).toBe('not_applicable');
      expect(
        classifyInventoryPreparation((await read(owner, oral.id))[0]!)
      ).toBe('not_applicable');
    });
    it('keeps current preparation identity and retained prior preparation audits separate and owner scoped', async () => {
      const current = await stock();
      const id = await preparation(current);
      expect((await read(owner, current.id))[0]!.current_preparation_id).toBe(
        id
      );
      expect(
        classifyInventoryPreparation((await read(owner, current.id))[0]!)
      ).toBe('prepared');
      const old = await stock();
      const oldPrep = await preparation(old);
      const correction = randomUUID();
      await admin(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(
            `INSERT INTO medication_preparation_corrections(id,user_id,preparation_id,pen_id,medication_id,from_revision,to_revision,operation_id,request_hash,before_snapshot,after_snapshot,before_bud,after_bud,result)
        SELECT $1::uuid,p.user_id,p.id,p.pen_id,p.medication_id,p.revision,p.revision+1,$2,'synthetic-proof',medication_preparation_snapshot(p),
          medication_preparation_snapshot(jsonb_populate_record(NULL::medication_preparations,to_jsonb(p)||jsonb_build_object('revision',p.revision+1,'current_correction_id',$1::uuid,'prepared_date','2026-11-02'))),'{}'::jsonb,'{}'::jsonb,'{}'::jsonb
        FROM medication_preparations p WHERE p.id=$3`,
            [correction, randomUUID(), oldPrep]
          );
          await c.query(
            "UPDATE medication_preparations SET revision=revision+1,current_correction_id=$2,prepared_date='2026-11-02' WHERE id=$1",
            [oldPrep, correction]
          );
          await c.query('DELETE FROM medication_preparations WHERE id=$1', [
            oldPrep,
          ]);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
      const prior = (await read(owner, old.id))[0]!;
      expect(prior.current_preparation_id).toBeNull();
      expect(prior.prior_preparation).toBe(true);
      expect(prior.linked_actual_count).toBe('0');
      expect(classifyInventoryPreparation(prior)).toBe('unknown');
      expect((await read(delegate, old.id))[0]!.prior_preparation).toBe(true);
    });
    it('filters active snapshot rows but explicit ID reads retain stale terminal or nonfinite-retirement facts', async () => {
      const finished = await stock({ status: 'finished' }),
        discarded = await stock({ status: 'discarded' }),
        retired = await stock({ finished: '2026-11-15T12:00:00Z' }),
        infinite = await stock({ finished: 'infinity' });
      const active = await read();
      for (const f of [finished, discarded, retired, infinite]) {
        expect(active.some((s) => s.id === f.id)).toBe(false);
        expect(
          classifyInventoryPreparation((await read(owner, f.id))[0]!)
        ).toBe('not_applicable');
      }
      expect((await read(owner, infinite.id))[0]!.finished_at).not.toBeNull();
    });
    it('respects existing medication delegation/report reads and rejects foreign stock even by explicit ID', async () => {
      const foreign = await stock({ user: other });
      expect(await read(owner, foreign.id)).toEqual([]);
      const own = await read();
      expect(await read(delegate)).toEqual(own);
      expect(await read(reader)).toEqual(own);
      expect(await read(other)).toEqual([]);
    });
    it('shares the caller read-only repeatable-read transaction and never alters raw facts or I06 forecast projections', async () => {
      const f = await stock();
      const c: PoolClient = await getClient(owner);
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const first = await loadInventoryForecastSnapshot(c, owner, now);
        const before = first.dashboard_stock.find((s) => s.id === f.id)!;
        await admin(async (writer) => {
          await writer.query(
            "UPDATE medication_pens SET status='in_use',opened_at='2026-11-16',updated_at=NOW() WHERE id=$1",
            [f.id]
          );
        });
        const again = await loadInventoryForecastSnapshot(c, owner, now);
        expect(again).toEqual(first);
        expect(await loadInventoryDashboardStock(c, owner, f.id)).toEqual([
          before,
        ]);
        expect(
          (await c.query('SHOW transaction_isolation')).rows[0]
            .transaction_isolation
        ).toBe('repeatable read');
        expect(
          (await c.query('SHOW transaction_read_only')).rows[0]
            .transaction_read_only
        ).toBe('on');
        await c.query('COMMIT');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect(classifyInventoryPreparation((await read(owner, f.id))[0]!)).toBe(
        'unknown'
      );
      const fingerprint = () =>
        admin(async (client) => {
          const rows: unknown[] = [];
          for (const table of [
            'medication_pens',
            'medication_preparations',
            'medication_preparation_corrections',
            'injection_entries',
            'user_preferences',
          ])
            rows.push(
              (
                await client.query<{ data: unknown }>(
                  `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM ${table} t WHERE user_id=$1`,
                  [owner]
                )
              ).rows[0]!.data
            );
          return rows;
        });
      const before = await fingerprint();
      await read();
      await read(delegate);
      expect(await fingerprint()).toEqual(before);
    });
  }
);
