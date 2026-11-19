import { addDays, planDoseReminders } from '@workspace/shared';
import { log } from '../config/logging.js';
import * as repo from '../models/doseReminderRepository.js';
import { getMedicationCalendarWeek } from './medicationCalendarService.js';
import { scheduleJob, type ScheduledTask } from './scheduledJobs.js';
import { sendWebPush, type VapidKeys } from './webPush.js';

/**
 * Dose reminders: every few minutes, for each owner with at least one device
 * enabled, plan the reminders due now from the dose calendar and deliver each
 * one to every enabled device.
 *
 * Exactly-once per (owner, local day, key): the ledger insert is the claim and
 * happens before sending. When every device cleanly refused, the claim is
 * released so a later tick in the window can retry. When a send throws, the
 * outcome is unknown and the claim stands: never sending twice beats retrying.
 */

const TICK = '*/5 * * * *';
const KEEP_LEDGER_DAYS = 14;

export function vapidSubject(): string {
  const explicit = process.env.VAPID_SUBJECT?.trim();
  if (explicit) return explicit;
  try {
    const origin = new URL(process.env.SPARKY_FITNESS_FRONTEND_URL ?? '')
      .origin;
    if (origin.startsWith('https://')) return origin;
  } catch {
    // fall through
  }
  return 'mailto:admin@localhost';
}

export interface Delivery {
  delivered: number;
  devices: number;
}

/** Sends one message to every device of the owner. Throws only when no send could be attempted cleanly. */
export async function deliverToOwner(
  owner: string,
  message: object,
  keys: VapidKeys
): Promise<Delivery> {
  const targets = await repo.deliveryTargets(owner);
  let delivered = 0;
  let failure: unknown = null;
  for (const target of targets) {
    try {
      const result = await sendWebPush(target, message, keys, vapidSubject());
      if (result.ok) {
        delivered++;
        await repo.markDelivered(target.id).catch(() => undefined);
      } else if (result.gone) {
        await repo.removeGoneSubscription(target.id).catch(() => undefined);
        log(
          'info',
          `[REMINDERS] Removed expired push subscription ${target.id}`
        );
      } else {
        log(
          'warn',
          `[REMINDERS] Push service refused ${target.id}: ${result.status}`
        );
      }
    } catch (error) {
      failure = error;
      log('error', `[REMINDERS] Push send failed for ${target.id}:`, error);
    }
  }
  // A thrown send may still have delivered; let the caller keep the claim.
  if (failure && delivered === 0) throw failure;
  return { delivered, devices: targets.length };
}

export async function runDoseRemindersForOwner(
  owner: string,
  now: Date,
  keys: VapidKeys
): Promise<number> {
  const settings = await repo.getSettings(owner);
  const week = await getMedicationCalendarWeek(owner, undefined, now);
  const plan = planDoseReminders(week, now, settings);
  if (plan.events.length === 0) return 0;
  const claimed = await repo.claimedKeys(owner, plan.day);
  let sent = 0;
  for (const event of plan.events) {
    if (claimed.has(event.key)) continue;
    if (!(await repo.claim(owner, plan.day, event.key))) continue;
    let outcome: Delivery;
    try {
      outcome = await deliverToOwner(
        owner,
        {
          title: event.title,
          body: event.body,
          tag: event.tag,
          url: event.url,
        },
        keys
      );
    } catch (error) {
      log(
        'error',
        `[REMINDERS] "${event.key}" delivery unknown; not retrying.`,
        error
      );
      continue;
    }
    if (outcome.delivered > 0) {
      await repo.completeClaim(owner, plan.day, event.key, outcome.delivered);
      sent++;
    } else {
      await repo.releaseClaim(owner, plan.day, event.key);
    }
  }
  return sent;
}

export async function runDoseReminders(
  now: Date = new Date()
): Promise<number> {
  const owners = await repo.ownersWithSubscriptions();
  if (owners.length === 0) return 0;
  const keys = await repo.loadVapidKeys();
  let sent = 0;
  for (const owner of owners) {
    try {
      sent += await runDoseRemindersForOwner(owner, now, keys);
    } catch (error) {
      log('error', `[REMINDERS] Reminder run failed for ${owner}:`, error);
    }
  }
  await repo
    .pruneSends(addDays(now.toISOString().slice(0, 10), -KEEP_LEDGER_DAYS))
    .catch((error) => log('warn', '[REMINDERS] Ledger prune failed:', error));
  return sent;
}

export async function sendTestReminder(owner: string): Promise<Delivery> {
  const keys = await repo.loadVapidKeys();
  return deliverToOwner(
    owner,
    {
      title: 'Dose reminders are on',
      body: 'This device will get a notification when a dose is due.',
      tag: 'sparky-dose-test',
      url: '/medications',
    },
    keys
  );
}

let task: ScheduledTask | null = null;
export function scheduleDoseReminders(): void {
  if (task) return;
  task = scheduleJob(
    'dose-reminders',
    TICK,
    async () => {
      try {
        const sent = await runDoseReminders(new Date());
        if (sent > 0) log('info', `[REMINDERS] Sent ${sent} dose reminder(s).`);
      } catch (error) {
        log('error', '[REMINDERS] Dose reminder tick failed:', error);
      }
    },
    { noOverlap: true }
  );
}
