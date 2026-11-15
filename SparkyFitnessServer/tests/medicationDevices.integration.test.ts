import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import * as devices from '../models/medicationSyringeRepository.js';
import stock from '../models/medicationPenRepository.js';
import injections from '../models/injectionRepository.js';

describe.runIf(process.env.DEVICE_INTEGRATION === '1')(
  'prepared devices PostgreSQL scope',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      delegate = randomUUID(),
      reader = randomUUID();
    let own: string, global: string, foreign: string, loggedGlobal: string;
    const input = {
      name: 'Synthetic device',
      graduation_type: 'units' as const,
      units_per_ml: 100,
      capacity_ml: '1',
      capacity_units: 100,
      increment: '1',
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other, delegate, reader])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `device-${id}@example.test`]
          );
        for (const [actor, permission] of [
          [delegate, 'can_manage_medications'],
          [reader, 'can_view_reports'],
        ])
          await c.query(
            "INSERT INTO family_access(owner_user_id,family_user_id,is_active,access_permissions,family_email,status) VALUES($1,$2,true,$3::jsonb,$4,'active')",
            [
              owner,
              actor,
              JSON.stringify({ [permission]: true }),
              `device-${actor}@example.test`,
            ]
          );
        global = (
          await c.query(
            "INSERT INTO medication_syringes(user_id,name,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES(NULL,'Synthetic shared device','units',100,1,100,1) RETURNING id"
          )
        ).rows[0].id;
        own = (await devices.saveSyringe(owner, input)).id;
        foreign = (await devices.saveSyringe(other, input)).id;
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM medication_syringes WHERE id=$1', [global]);
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other, delegate, reader],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });

    it('lists only own/global and gives each owner an independent global preference', async () => {
      const list = await devices.listSyringes(owner);
      expect(list.syringes.some((s) => s.id === own)).toBe(true);
      expect(list.syringes.find((s) => s.id === global)?.is_shared).toBe(true);
      expect(list.syringes.some((s) => s.id === foreign)).toBe(false);
      await devices.setDefaultSyringe(owner, global);
      await devices.setDefaultSyringe(other, foreign);
      expect((await devices.listSyringes(owner)).default_syringe_id).toBe(
        global
      );
      expect((await devices.listSyringes(other)).default_syringe_id).toBe(
        foreign
      );
      await expect(devices.setDefaultSyringe(owner, foreign)).rejects.toThrow(
        'not found'
      );
      expect(await devices.saveSyringe(owner, input, global)).toBeNull();
      expect(await devices.deleteSyringe(owner, global)).toBe(false);
    });

    it('preserves existing pump and pen categories when a legacy client omits the field', async () => {
      for (const device_type of ['pen', 'pump'] as const) {
        const device = await devices.saveSyringe(owner, {
          ...input,
          device_type,
          increment: '0.1',
        });

        const edited = await devices.saveSyringe(
          owner,
          { ...input, name: 'Synthetic legacy edit', increment: '0.1' },
          device.id
        );
        expect(edited.device_type).toBe(device_type);
        if (device_type === 'pump') expect(edited.graduation_type).toBe('ml');
      }
    });

    it('previews a read-only global pump using its exact saved spray volume and stored medication route', async () => {
      const c = await getSystemClient();
      let med: string;
      try {
        await c.query(
          "UPDATE medication_syringes SET device_type='pump',graduation_type='ml',increment=0.1,capacity_units=10 WHERE id=$1",
          [global]
        );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic nasal preparation','nasal_spray') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const vial = await stock.createPen(owner, med, {
        kind: 'vial',
        preparation: {
          mode: 'reconstituted',
          mass_value: 3,
          mass_unit: 'mg',
          final_volume_ml: 3,
          prepared_date: '2026-11-15',
        },
      });
      const result = await devices.previewDraw(owner, vial.id, {
        syringe_id: global,
        dose: { value: '2', unit: 'pumps' },
      });
      expect(result).toMatchObject({
        administrationRoute: 'nasal',
        doseInputUnit: 'ml',
        targetVolumeMl: '0.2',
        device: { id: global, device_type: 'pump', increment: '0.1' },
      });
      await expect(
        devices.previewDraw(owner, vial.id, {
          syringe_id: own,
          dose: { value: '0.2', unit: 'ml' },
        })
      ).rejects.toThrow('medication route');
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        pen_id: vial.id,
        deduct_pen: true,
        site: 'Synthetic forbidden nasal site',
        calculated_draw: {
          syringe_id: global,
          dose: { value: '2', unit: 'pumps' },
        },
      });
      loggedGlobal = logged.id;
      expect(logged).toMatchObject({
        administration_route: 'nasal',
        dose_input_unit: 'ml',
        site: null,
        volume_ml: '0.2',
      });
      const changed = await getSystemClient();
      try {
        await changed.query(
          "UPDATE medications SET route_id='oral' WHERE id=$1",
          [med]
        );
      } finally {
        changed.release();
      }
      const metadata = await injections.updateInjection(owner, logged.id, {
        notes: 'Synthetic metadata edit',
        site: 'Synthetic forbidden site',
      });
      expect(metadata).toMatchObject({
        administration_route: 'nasal',
        site: null,
        volume_ml: '0.2',
      });
      const edited = await injections.updateInjection(owner, logged.id, {
        calculated_draw: {
          syringe_id: global,
          dose: { value: '3', unit: 'pumps' },
        },
      });
      expect(edited).toMatchObject({
        administration_route: 'nasal',
        site: null,
        volume_ml: '0.3',
        dose_input_unit: 'ml',
      });
    });
    it('independently enforces read-only globals, delegate write and reader read at RLS', async () => {
      for (const actor of [owner, delegate, reader, other]) {
        const c = await getClient(owner, actor);
        try {
          expect(
            (
              await c.query('SELECT id FROM medication_syringes WHERE id=$1', [
                global,
              ])
            ).rowCount
          ).toBe(1);
          expect(
            (
              await c.query(
                "UPDATE medication_syringes SET name='Forbidden global edit' WHERE id=$1",
                [global]
              )
            ).rowCount
          ).toBe(0);
          expect(
            (
              await c.query('DELETE FROM medication_syringes WHERE id=$1', [
                global,
              ])
            ).rowCount
          ).toBe(0);
          await expect(
            c.query(
              "INSERT INTO medication_syringes(name,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES('Forbidden global','units',100,1,100,1)"
            )
          ).rejects.toMatchObject({ code: '42501' });
          const expected = actor === owner || actor === delegate;
          expect(
            (
              await c.query(
                "UPDATE medication_syringes SET name='Synthetic permitted edit' WHERE id=$1",
                [own]
              )
            ).rowCount
          ).toBe(expected ? 1 : 0);
          if (expected)
            await c.query(
              'INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_syringe_id=EXCLUDED.default_syringe_id',
              [owner, global]
            );
          else
            await expect(
              c.query(
                'INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_syringe_id=EXCLUDED.default_syringe_id',
                [owner, global]
              )
            ).rejects.toMatchObject({ code: '42501' });
        } finally {
          c.release();
        }
      }
    });

    it('keeps legacy unknown route and recorded site through medication route changes and existing manual edits', async () => {
      const c = await getSystemClient();
      let med: string;
      try {
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic legacy dose','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        c.release();
      }
      const logged = await injections.createInjection(owner, {
        medication_id: med,
        dose_mg: 0.2,
        site: 'Synthetic legacy site',
      });
      const fixture = await getSystemClient();
      try {
        await fixture.query(
          'UPDATE injection_entries SET administration_route=NULL WHERE id=$1',
          [logged.id]
        );
        await fixture.query(
          "UPDATE medications SET route_id='oral' WHERE id=$1",
          [med]
        );
      } finally {
        fixture.release();
      }
      const metadata = await injections.updateInjection(owner, logged.id, {
        notes: 'Synthetic legacy metadata',
      });
      expect(metadata).toMatchObject({
        administration_route: null,
        site: 'Synthetic legacy site',
        dose_mg: 0.2,
      });
      const edited = await injections.updateInjection(owner, logged.id, {
        dose_mg: 0.3,
      });
      expect(edited).toMatchObject({
        administration_route: null,
        site: 'Synthetic legacy site',
        dose_mg: 0.3,
      });
    });

    it('rejects cross-owner pointers even with system access and immutable device ownership', async () => {
      const c = await getSystemClient();
      try {
        await expect(
          c.query(
            'UPDATE medication_device_preferences SET default_syringe_id=$1 WHERE user_id=$2',
            [foreign, owner]
          )
        ).rejects.toThrow('preference owner');
        await expect(
          c.query('UPDATE medication_syringes SET user_id=$1 WHERE id=$2', [
            other,
            own,
          ])
        ).rejects.toThrow('ownership is immutable');
      } finally {
        c.release();
      }
    });

    it('binds device guards to their intended public tables before reading related records', async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          'CREATE TEMP TABLE device_guard_probe(user_id UUID,default_syringe_id UUID,syringe_id UUID)'
        );
        for (const guard of [
          'check_medication_device_preference_scope',
          'check_medication_device_owner',
          'check_injection_syringe_scope',
        ]) {
          await c.query(
            `CREATE TRIGGER wrong_binding BEFORE INSERT ON device_guard_probe FOR EACH ROW EXECUTE FUNCTION public.${guard}()`
          );
          await expect(
            c.query('INSERT INTO device_guard_probe(user_id) VALUES($1)', [
              owner,
            ])
          ).rejects.toThrow('guard binding');
          await c.query('DROP TRIGGER wrong_binding ON device_guard_probe');
        }
      } finally {
        await c.query('DROP TABLE IF EXISTS device_guard_probe');
        c.release();
      }
    });

    it('migrates legacy defaults once, never resurrects clearing and clears deleted pointers', async () => {
      const c = await getSystemClient();
      const migration = readFileSync(
        new URL(
          '../db/migrations/20261115213000_medication_devices.sql',
          import.meta.url
        ),
        'utf8'
      );
      try {
        await c.query(
          'DELETE FROM medication_device_preferences WHERE user_id=$1',
          [owner]
        );
        await c.query(
          'UPDATE medication_syringes SET is_default=true WHERE id=$1',
          [own]
        );
        await c.query(migration);
        expect((await devices.listSyringes(owner)).default_syringe_id).toBe(
          own
        );
        await devices.setDefaultSyringe(owner, null);
        await c.query(
          'UPDATE medication_syringes SET is_default=true WHERE id=$1',
          [own]
        );
        await c.query(migration);
        expect(
          (await devices.listSyringes(owner)).default_syringe_id
        ).toBeNull();
        await devices.setDefaultSyringe(owner, own);
        await devices.deleteSyringe(owner, own);
        await c.query('DELETE FROM medication_syringes WHERE id=$1', [global]);
        const history = await c.query(
          'SELECT administration_route,dose_mg::text,volume_ml::text,dose_input_unit,syringe_id FROM injection_entries WHERE id=$1',
          [loggedGlobal]
        );
        expect(history.rows[0]).toMatchObject({
          administration_route: 'nasal',
          dose_mg: '0.3',
          volume_ml: '0.3',
          dose_input_unit: 'ml',
          syringe_id: null,
        });
        expect(
          (await devices.listSyringes(owner)).default_syringe_id
        ).toBeNull();
      } finally {
        c.release();
      }
    });
  }
);
