import express, { type RequestHandler } from 'express';
import {
  doseReminderSettingsSchema,
  webPushSubscriptionInputSchema,
  webPushUnsubscribeSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import * as repo from '../../models/doseReminderRepository.js';
import { sendTestReminder } from '../../services/doseReminderService.js';
import { isAllowedPushEndpoint } from '../../services/webPush.js';
import { log } from '../../config/logging.js';

/**
 * Dose reminders for the signed-in owner's own medications. Devices and
 * reminder times are personal: switched profiles and delegated access never
 * reach them. Read-only API keys may read; authenticate blocks their writes.
 */
export const requireReminderOwner: RequestHandler = (req, res, next) => {
  const owner = req.authenticatedUserId || req.originalUserId || req.userId;
  const targets: unknown[] = [
    req.userId,
    req.originalUserId,
    req.headers['x-on-behalf-of-user-id'],
    req.query.userId,
    req.query.targetUserId,
    req.body?.user_id,
    req.body?.targetUserId,
  ];
  if (
    !owner ||
    targets.some(
      (value) =>
        typeof value === 'string' && value.length > 0 && value !== owner
    )
  ) {
    res
      .status(403)
      .json({ error: 'Dose reminders are private to their owner.' });
    return;
  }
  next();
};

const router = express.Router();
router.use(authenticate);
router.use(requireReminderOwner);

const invalid = (res: express.Response, details: unknown) =>
  res.status(400).json({ error: 'Invalid request', details });

/**
 * @openapi
 * /v2/medication-reminders:
 *   get:
 *     summary: Push key, reminder settings and this owner's enabled devices
 */
router.get('/', async (req, res, next) => {
  try {
    let publicKey: string | null = null;
    try {
      publicKey = (await repo.loadVapidKeys()).publicKey;
    } catch (error) {
      log('error', '[REMINDERS] Push keys unavailable:', error);
    }
    res.json({
      public_key: publicKey,
      settings: await repo.getSettings(req.userId),
      subscriptions: await repo.listSubscriptions(req.userId),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const body = doseReminderSettingsSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error.flatten());
    res.json(await repo.saveSettings(req.userId, body.data));
  } catch (error) {
    next(error);
  }
});

router.post('/subscriptions', async (req, res, next) => {
  try {
    const body = webPushSubscriptionInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error.flatten());
    if (!isAllowedPushEndpoint(body.data.endpoint)) {
      res
        .status(400)
        .json({ error: 'This browser’s push service is not supported.' });
      return;
    }
    res.status(201).json(await repo.saveSubscription(req.userId, body.data));
  } catch (error) {
    next(error);
  }
});

router.delete('/subscriptions', async (req, res, next) => {
  try {
    const body = webPushUnsubscribeSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error.flatten());
    await repo.deleteSubscription(req.userId, body.data.endpoint);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    const result = await sendTestReminder(req.userId);
    if (result.devices === 0) {
      res
        .status(409)
        .json({ error: 'Turn on reminders on this device first.', ...result });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
