import express from 'express';
import { medicationStackInputSchema } from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as stacks from '../../models/medicationStackRepository.js';

/**
 * Stacks of medications and supplements. Same access as the medication APIs:
 * the owner, or a caregiver with medication access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('medications'));

const invalid = (res: express.Response, error: { flatten: () => unknown }) =>
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });

/**
 * @openapi
 * /v2/medication-stacks:
 *   get:
 *     summary: List stacks with their members
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ stacks: await stacks.listStacks(req.userId) });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = medicationStackInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res
      .status(201)
      .json({ id: await stacks.createStack(req.userId, body.data) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const body = medicationStackInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    if (!(await stacks.updateStack(req.userId, params.data.id, body.data))) {
      res.status(404).json({ error: 'Stack not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    if (!(await stacks.deleteStack(req.userId, params.data.id))) {
      res.status(404).json({ error: 'Stack not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
