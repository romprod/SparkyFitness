import express from 'express';
import { lifeEventInputSchema } from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as lifeEvents from '../../models/lifeEventRepository.js';

/**
 * Illness, travel and other windows shown on the medication reports. Same access as the
 * medication APIs: the owner, or a caregiver with medication access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('medications'));

const invalid = (res: express.Response, error: { flatten: () => unknown }) =>
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
const actor = (req: express.Request) => req.authenticatedUserId || req.userId;

/**
 * @openapi
 * /v2/life-events:
 *   get:
 *     summary: List illness, travel and other windows, oldest first
 *     tags: [Medications]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      life_events: await lifeEvents.listLifeEvents(req.userId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/life-events:
 *   post:
 *     summary: Add a window (a blank end day means the start day only; at most 120 days)
 *     tags: [Medications]
 */
router.post('/', async (req, res, next) => {
  try {
    const body = lifeEventInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.status(201).json({
      id: await lifeEvents.createLifeEvent(req.userId, body.data, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/life-events/{id}:
 *   delete:
 *     summary: Delete a window; one already deleted counts as deleted
 *     tags: [Medications]
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await lifeEvents.deleteLifeEvent(req.userId, params.data.id, actor(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
