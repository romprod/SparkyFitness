import express from 'express';
import { medicationBlendInputSchema } from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as blends from '../../models/medicationBlendRepository.js';

/**
 * What the owner's vendor blends are made of. Same access as the medication APIs: the owner, or
 * a caregiver with medication access acting on their behalf.
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
 * /v2/medication-blends:
 *   get:
 *     summary: List the blends that have components, with the mg of each in one labelled vial
 *     tags: [Medications]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ blends: await blends.listBlends(req.userId, actor(req)) });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/medication-blends/{id}:
 *   put:
 *     summary: Replace the components of a medication; an empty list makes it a plain medication
 *     tags: [Medications]
 */
router.put('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const body = medicationBlendInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.json({
      blend: await blends.replaceBlend(
        req.userId,
        params.data.id,
        body.data,
        actor(req)
      ),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
