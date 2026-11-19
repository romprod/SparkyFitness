import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getClient, getSystemClient } from '../db/poolManager.js';
import * as repo from '../models/doseReminderRepository.js';
import { validVapidKeys } from '../services/webPush.js';

describe.runIf(process.env.DOSE_REMINDERS_INTEGRATION === '1')(
  'dose reminder storage PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const admin = async <T>(work: (c: PoolClient) => Promise<T>) => {
      const c: PoolClient = await getSystemClient();
      try {
        return await work(c);
      } finally {
        c.release();
      }
    };
    const device = (id: string) => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      keys: { p256dh: 'BKey', auth: 'AuthSecret' },
      user_agent: 'Test browser',
    });

    beforeAll(async () => {
      await admin(async (c) => {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `reminders-${id}@example.test`]
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

    it('returns defaults until settings are saved, then the saved values', async () => {
      expect(await repo.getSettings(owner)).toEqual({
        untimed_time: '08:00',
        nag_enabled: true,
        nag_time: '18:00',
        include_supplements: true,
      });
      const saved = await repo.saveSettings(owner, {
        untimed_time: '07:30',
        nag_enabled: false,
        nag_time: '20:15',
        include_supplements: false,
      });
      expect(saved.untimed_time).toBe('07:30');
      expect(await repo.getSettings(owner)).toEqual(saved);
      expect((await repo.getSettings(other)).untimed_time).toBe('08:00');
      await expect(
        admin((c) =>
          c.query(
            "INSERT INTO medication_reminder_settings(user_id,untimed_time) VALUES($1,'25:00')",
            [other]
          )
        )
      ).rejects.toThrow();
    });

    it('keeps devices private and moves a browser to the account that last enabled it', async () => {
      await repo.saveSubscription(owner, device('a'));
      await repo.saveSubscription(owner, device('a'));
      expect(await repo.listSubscriptions(owner)).toHaveLength(1);
      expect(await repo.listSubscriptions(other)).toHaveLength(0);
      // RLS: another owner's client cannot see or delete the row.
      const c: PoolClient = await getClient(other);
      try {
        const { rows } = await c.query('SELECT id FROM web_push_subscriptions');
        expect(rows).toHaveLength(0);
      } finally {
        c.release();
      }
      expect(await repo.deleteSubscription(other, device('a').endpoint)).toBe(
        false
      );
      await repo.saveSubscription(other, device('a'));
      expect(await repo.listSubscriptions(owner)).toHaveLength(0);
      expect(await repo.ownersWithSubscriptions()).toContain(other);
      expect(await repo.deleteSubscription(other, device('a').endpoint)).toBe(
        true
      );
    });

    it('claims each reminder once per day and releases only pending claims', async () => {
      const day = '2026-11-19';
      expect(await repo.claim(owner, day, 'due@09:00')).toBe(true);
      expect(await repo.claim(owner, day, 'due@09:00')).toBe(false);
      expect(await repo.claim(owner, '2026-11-20', 'due@09:00')).toBe(true);
      await repo.releaseClaim(owner, day, 'due@09:00');
      expect(await repo.claim(owner, day, 'due@09:00')).toBe(true);
      await repo.completeClaim(owner, day, 'due@09:00', 2);
      await repo.releaseClaim(owner, day, 'due@09:00');
      expect(await repo.claimedKeys(owner, day)).toEqual(
        new Set(['due@09:00'])
      );
      await repo.pruneSends('2026-11-20');
      expect(await repo.claimedKeys(owner, day)).toEqual(new Set());
      expect(await repo.claimedKeys(owner, '2026-11-20')).toEqual(
        new Set(['due@09:00'])
      );
    });

    it('creates one server key pair, stores the private key encrypted and reuses it', async () => {
      await admin((c) => c.query('DELETE FROM system.web_push_vapid'));
      const first = await repo.loadVapidKeys();
      const second = await repo.loadVapidKeys();
      expect(validVapidKeys(first)).toBe(true);
      expect(second).toEqual(first);
      const stored = await admin((c) =>
        c.query('SELECT private_key_encrypted FROM system.web_push_vapid')
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].private_key_encrypted).not.toBe(first.privateKey);
    });
  }
);
