import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../models/doseReminderRepository.js', () => ({
  getSettings: vi.fn(),
  claimedKeys: vi.fn(),
  claim: vi.fn(),
  completeClaim: vi.fn(),
  releaseClaim: vi.fn(),
  deliveryTargets: vi.fn(),
  markDelivered: vi.fn(),
  removeGoneSubscription: vi.fn(),
  ownersWithSubscriptions: vi.fn(),
  loadVapidKeys: vi.fn(),
  pruneSends: vi.fn(),
}));
vi.mock('../services/medicationCalendarService.js', () => ({
  getMedicationCalendarWeek: vi.fn(),
}));
vi.mock('../services/webPush.js', () => ({ sendWebPush: vi.fn() }));
vi.mock('../services/scheduledJobs.js', () => ({ scheduleJob: vi.fn() }));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import * as repo from '../models/doseReminderRepository.js';
import { getMedicationCalendarWeek } from '../services/medicationCalendarService.js';
import { sendWebPush } from '../services/webPush.js';
import {
  deliverToOwner,
  runDoseReminders,
  runDoseRemindersForOwner,
  sendTestReminder,
  vapidSubject,
} from '../services/doseReminderService.js';
import {
  addDays,
  DEFAULT_DOSE_REMINDER_SETTINGS,
  type MedicationLogWeekResponse,
} from '@workspace/shared';

const owner = '00000000-0000-4000-8000-000000000001';
const keys = { publicKey: 'pub', privateKey: 'priv' };
const today = '2026-11-19';
const week: MedicationLogWeekResponse = {
  as_of: `${today}T09:00:00Z`,
  today,
  timezone: 'Europe/London',
  week_start: '2026-11-16',
  days: Array.from({ length: 7 }, (_, i) => addDays('2026-11-16', i)),
  lanes: [
    {
      id: 'medication:m',
      medication_id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Sertraline',
      is_supplement: false,
    },
  ],
  planned_slots: [
    {
      id: 's',
      lane_id: 'medication:m',
      medication_id: '00000000-0000-4000-8000-0000000000aa',
      plan_kind: 'legacy',
      timezone: 'Europe/London',
      scheduled_day: today,
      scheduled_for: `${today}T09:00:00.000Z`,
      time_of_day: '09:00:00',
      status: 'pending',
      dose_amount: '1',
      dose_unit: 'tablet',
      dose_qualification: 'configured',
      course_id: null,
      course_revision_id: null,
      course_rule_id: null,
      course_step_id: null,
      course_slot_key: null,
      course_expected_version: null,
      schedule_id: null,
    },
  ],
  actuals: [],
  fulfilled_slots: [],
  coverage: [],
};
const now = new Date(`${today}T09:01:00Z`);
const target = (id: string) => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: 'k',
  auth: 'a',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getSettings).mockResolvedValue({
    ...DEFAULT_DOSE_REMINDER_SETTINGS,
  });
  vi.mocked(getMedicationCalendarWeek).mockResolvedValue(week);
  vi.mocked(repo.claimedKeys).mockResolvedValue(new Set());
  vi.mocked(repo.claim).mockResolvedValue(true);
  vi.mocked(repo.deliveryTargets).mockResolvedValue([target('a'), target('b')]);
  vi.mocked(repo.markDelivered).mockResolvedValue(undefined);
  vi.mocked(repo.removeGoneSubscription).mockResolvedValue(undefined);
  vi.mocked(repo.pruneSends).mockResolvedValue(undefined);
});

describe('dose reminder delivery', () => {
  it('claims, sends to every device and records the delivery', async () => {
    vi.mocked(sendWebPush).mockResolvedValue({
      ok: true,
      status: 201,
      gone: false,
    });
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(1);
    expect(repo.claim).toHaveBeenCalledWith(owner, today, 'due@09:00');
    expect(sendWebPush).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendWebPush).mock.calls[0]![1]).toEqual({
      title: 'Sertraline is due',
      body: '09:00 · Sertraline',
      tag: 'sparky-dose-09:00',
      url: '/medications',
    });
    expect(repo.completeClaim).toHaveBeenCalledWith(
      owner,
      today,
      'due@09:00',
      2
    );
    expect(repo.markDelivered).toHaveBeenCalledTimes(2);
  });

  it('skips reminders already sent today and lost claim races', async () => {
    vi.mocked(repo.claimedKeys).mockResolvedValueOnce(new Set(['due@09:00']));
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(0);
    vi.mocked(repo.claim).mockResolvedValueOnce(false);
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(0);
    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it('releases the claim when every device cleanly refused, and prunes gone devices', async () => {
    vi.mocked(sendWebPush)
      .mockResolvedValueOnce({ ok: false, status: 410, gone: true })
      .mockResolvedValueOnce({ ok: false, status: 500, gone: false });
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(0);
    expect(repo.removeGoneSubscription).toHaveBeenCalledWith('a');
    expect(repo.releaseClaim).toHaveBeenCalledWith(owner, today, 'due@09:00');
    expect(repo.completeClaim).not.toHaveBeenCalled();
  });

  it('keeps the claim when a send fails with an unknown outcome', async () => {
    vi.mocked(sendWebPush).mockRejectedValue(new Error('socket hang up'));
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(0);
    expect(repo.releaseClaim).not.toHaveBeenCalled();
    expect(repo.completeClaim).not.toHaveBeenCalled();
  });

  it('counts one device as delivered even if another throws', async () => {
    vi.mocked(sendWebPush)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true, status: 201, gone: false });
    expect(await deliverToOwner(owner, {}, keys)).toEqual({
      delivered: 1,
      devices: 2,
    });
  });

  it('does nothing when no reminder is due', async () => {
    vi.mocked(getMedicationCalendarWeek).mockResolvedValue({
      ...week,
      planned_slots: [{ ...week.planned_slots[0]!, status: 'taken' }],
    });
    expect(await runDoseRemindersForOwner(owner, now, keys)).toBe(0);
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('runs every owner with a device and keeps going past one owner failing', async () => {
    vi.mocked(repo.ownersWithSubscriptions).mockResolvedValue(['x', owner]);
    vi.mocked(repo.loadVapidKeys).mockResolvedValue(keys);
    vi.mocked(getMedicationCalendarWeek)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(week);
    vi.mocked(sendWebPush).mockResolvedValue({
      ok: true,
      status: 201,
      gone: false,
    });
    expect(await runDoseReminders(now)).toBe(1);
    expect(repo.pruneSends).toHaveBeenCalledWith('2026-11-05');
  });

  it('skips the whole run, keys included, when nobody has a device', async () => {
    vi.mocked(repo.ownersWithSubscriptions).mockResolvedValue([]);
    expect(await runDoseReminders(now)).toBe(0);
    expect(repo.loadVapidKeys).not.toHaveBeenCalled();
  });

  it('sends a test to every device', async () => {
    vi.mocked(repo.loadVapidKeys).mockResolvedValue(keys);
    vi.mocked(sendWebPush).mockResolvedValue({
      ok: true,
      status: 201,
      gone: false,
    });
    expect(await sendTestReminder(owner)).toEqual({ delivered: 2, devices: 2 });
  });

  it('identifies the sender by the public site address', () => {
    const before = { ...process.env };
    delete process.env.VAPID_SUBJECT;
    process.env.SPARKY_FITNESS_FRONTEND_URL = 'https://health.example/app';
    expect(vapidSubject()).toBe('https://health.example');
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
    expect(vapidSubject()).toBe('mailto:ops@example.com');
    process.env = before;
  });
});
