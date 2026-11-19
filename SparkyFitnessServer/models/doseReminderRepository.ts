import {
  DEFAULT_DOSE_REMINDER_SETTINGS,
  type DoseReminderSettings,
  type WebPushSubscriptionInput,
  type WebPushSubscriptionView,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient, getSystemClient } from '../db/poolManager.js';
import { decrypt, encrypt, ENCRYPTION_KEY } from '../security/encryption.js';
import {
  generateVapidKeys,
  validVapidKeys,
  type PushTarget,
  type VapidKeys,
} from '../services/webPush.js';

/**
 * Owner reads and writes use the RLS client. Device subscriptions are written
 * through the owner pool because an endpoint identifies one browser: when a
 * different account enables reminders on the same browser it takes the device
 * over. Callers pass only the authenticated owner's id.
 */

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

export async function getSettings(
  owner: string
): Promise<DoseReminderSettings> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rows } = await client.query<DoseReminderSettings>(
      'SELECT untimed_time,nag_enabled,nag_time,include_supplements FROM medication_reminder_settings WHERE user_id=$1',
      [owner]
    );
    return rows[0] ?? { ...DEFAULT_DOSE_REMINDER_SETTINGS };
  } finally {
    client.release();
  }
}

export async function saveSettings(
  owner: string,
  settings: DoseReminderSettings
): Promise<DoseReminderSettings> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rows } = await client.query<DoseReminderSettings>(
      `INSERT INTO medication_reminder_settings(user_id,untimed_time,nag_enabled,nag_time,include_supplements)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(user_id) DO UPDATE SET untimed_time=EXCLUDED.untimed_time,nag_enabled=EXCLUDED.nag_enabled,
         nag_time=EXCLUDED.nag_time,include_supplements=EXCLUDED.include_supplements,updated_at=now()
       RETURNING untimed_time,nag_enabled,nag_time,include_supplements`,
      [
        owner,
        settings.untimed_time,
        settings.nag_enabled,
        settings.nag_time,
        settings.include_supplements,
      ]
    );
    return rows[0]!;
  } finally {
    client.release();
  }
}

type SubscriptionRow = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: Date | string;
  last_success_at: Date | string | null;
};
const view = (row: SubscriptionRow): WebPushSubscriptionView => ({
  id: row.id,
  endpoint: row.endpoint,
  user_agent: row.user_agent,
  created_at: toIso(row.created_at)!,
  last_success_at: toIso(row.last_success_at),
});

export async function listSubscriptions(
  owner: string
): Promise<WebPushSubscriptionView[]> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rows } = await client.query<SubscriptionRow>(
      'SELECT id,endpoint,user_agent,created_at,last_success_at FROM web_push_subscriptions WHERE user_id=$1 ORDER BY created_at',
      [owner]
    );
    return rows.map(view);
  } finally {
    client.release();
  }
}

export async function saveSubscription(
  owner: string,
  input: WebPushSubscriptionInput
): Promise<WebPushSubscriptionView> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND user_id<>$2',
      [input.endpoint, owner]
    );
    const { rows } = await client.query<SubscriptionRow>(
      `INSERT INTO web_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent
       RETURNING id,endpoint,user_agent,created_at,last_success_at`,
      [
        owner,
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        input.user_agent ?? null,
      ]
    );
    await client.query('COMMIT');
    return view(rows[0]!);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSubscription(
  owner: string,
  endpoint: string
): Promise<boolean> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rowCount } = await client.query(
      'DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint=$2',
      [owner, endpoint]
    );
    return (rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

// --- Scheduler side (owner pool) -------------------------------------------

export async function ownersWithSubscriptions(): Promise<string[]> {
  const client: PoolClient = await getSystemClient();
  try {
    const { rows } = await client.query<{ user_id: string }>(
      'SELECT DISTINCT user_id FROM web_push_subscriptions ORDER BY user_id'
    );
    return rows.map((row) => row.user_id);
  } finally {
    client.release();
  }
}

export async function deliveryTargets(
  owner: string
): Promise<(PushTarget & { id: string })[]> {
  const client: PoolClient = await getSystemClient();
  try {
    const { rows } = await client.query<PushTarget & { id: string }>(
      'SELECT id,endpoint,p256dh,auth FROM web_push_subscriptions WHERE user_id=$1 ORDER BY created_at',
      [owner]
    );
    return rows;
  } finally {
    client.release();
  }
}

export async function markDelivered(id: string): Promise<void> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query(
      'UPDATE web_push_subscriptions SET last_success_at=now() WHERE id=$1',
      [id]
    );
  } finally {
    client.release();
  }
}

export async function removeGoneSubscription(id: string): Promise<void> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query('DELETE FROM web_push_subscriptions WHERE id=$1', [id]);
  } finally {
    client.release();
  }
}

export async function claimedKeys(
  owner: string,
  day: string
): Promise<Set<string>> {
  const client: PoolClient = await getSystemClient();
  try {
    const { rows } = await client.query<{ reminder_key: string }>(
      'SELECT reminder_key FROM medication_reminder_sends WHERE user_id=$1 AND reminder_day=$2',
      [owner, day]
    );
    return new Set(rows.map((row) => row.reminder_key));
  } finally {
    client.release();
  }
}

/** The atomic claim: true only for the one caller whose insert wins. */
export async function claim(
  owner: string,
  day: string,
  key: string
): Promise<boolean> {
  const client: PoolClient = await getSystemClient();
  try {
    const { rowCount } = await client.query(
      'INSERT INTO medication_reminder_sends(user_id,reminder_day,reminder_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [owner, day, key]
    );
    return (rowCount ?? 0) === 1;
  } finally {
    client.release();
  }
}

export async function completeClaim(
  owner: string,
  day: string,
  key: string,
  delivered: number
): Promise<void> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query(
      "UPDATE medication_reminder_sends SET channel='webpush',delivered=$4,sent_at=now() WHERE user_id=$1 AND reminder_day=$2 AND reminder_key=$3",
      [owner, day, key, delivered]
    );
  } finally {
    client.release();
  }
}

/** Only when nothing was delivered, so the next tick may retry in the window. */
export async function releaseClaim(
  owner: string,
  day: string,
  key: string
): Promise<void> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query(
      "DELETE FROM medication_reminder_sends WHERE user_id=$1 AND reminder_day=$2 AND reminder_key=$3 AND channel='pending'",
      [owner, day, key]
    );
  } finally {
    client.release();
  }
}

export async function pruneSends(before: string): Promise<void> {
  const client: PoolClient = await getSystemClient();
  try {
    await client.query(
      'DELETE FROM medication_reminder_sends WHERE reminder_day<$1',
      [before]
    );
  } finally {
    client.release();
  }
}

/**
 * The server's VAPID key pair. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in the
 * environment win; otherwise a pair is created once and kept in the database
 * with the private key encrypted under the server's API encryption key.
 */
export async function loadVapidKeys(): Promise<VapidKeys> {
  const fromEnv = {
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
  };
  if (fromEnv.publicKey && fromEnv.privateKey) {
    if (!validVapidKeys(fromEnv))
      throw new Error(
        'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not form a P-256 pair'
      );
    return fromEnv;
  }
  const client: PoolClient = await getSystemClient();
  try {
    const read = async () =>
      (
        await client.query<{
          public_key: string;
          private_key_encrypted: string;
          private_key_iv: string;
          private_key_tag: string;
        }>(
          'SELECT public_key,private_key_encrypted,private_key_iv,private_key_tag FROM system.web_push_vapid WHERE id=1'
        )
      ).rows[0];
    let row = await read();
    if (!row) {
      const fresh = generateVapidKeys();
      const sealed = await encrypt(fresh.privateKey, ENCRYPTION_KEY);
      await client.query(
        'INSERT INTO system.web_push_vapid(id,public_key,private_key_encrypted,private_key_iv,private_key_tag) VALUES(1,$1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
        [fresh.publicKey, sealed.encryptedText, sealed.iv, sealed.tag]
      );
      row = await read();
    }
    if (!row) throw new Error('Could not create the web push key pair');
    const privateKey = await decrypt(
      row.private_key_encrypted,
      row.private_key_iv,
      row.private_key_tag,
      ENCRYPTION_KEY
    );
    const keys = { publicKey: row.public_key, privateKey: privateKey ?? '' };
    if (!validVapidKeys(keys))
      throw new Error('Stored web push key pair is not valid');
    return keys;
  } finally {
    client.release();
  }
}
