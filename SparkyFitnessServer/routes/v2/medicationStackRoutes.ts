import express from 'express';
import {
  medicationStackInputSchema,
  medicationStackScheduleClearInputSchema,
  medicationStackScheduleReviewInputSchema,
  medicationStackScheduleSaveInputSchema,
  medicationStackSetupInputSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as stacks from '../../models/medicationStackRepository.js';
import { setupPremixedStack } from '../../services/medicationStackSetupService.js';
import {
  bindAddedStackMembers,
  clearStackSchedule,
  reviewStackSchedule,
  saveStackSchedule,
} from '../../services/medicationStackScheduleService.js';

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

/**
 * @openapi
 * /v2/medication-stacks/setup:
 *   post:
 *     summary: Set up a premixed stack
 *     description: >
 *       In one transaction, for each component: finds or creates the medicine,
 *       creates its vials with a premixed preparation, and creates a daily plan
 *       dosed at the chosen volume; then creates the stack. A retry with the
 *       same operation_id returns the first result and creates nothing.
 */
router.post('/setup', async (req, res, next) => {
  try {
    const body = medicationStackSetupInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.status(201).json(await setupPremixedStack(req.userId, body.data));
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
    if (
      !(await stacks.updateStack(
        req.userId,
        params.data.id,
        body.data,
        (client, added) =>
          bindAddedStackMembers(client, req.userId, params.data.id, added)
      ))
    ) {
      res.status(404).json({ error: 'Stack not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/medication-stacks/{id}/schedule/review:
 *   post:
 *     summary: Preview a stack schedule
 *     description: >
 *       Read-only. For each member, says whether saving the schedule changes
 *       its plan in place, writes a successor revision, leaves it alone, waits
 *       for a plan or cannot follow, with the fingerprint the save must echo.
 */
router.post('/:id/schedule/review', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const body = medicationStackScheduleReviewInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.json(await reviewStackSchedule(req.userId, params.data.id, body.data));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/medication-stacks/{id}/schedule:
 *   put:
 *     summary: Set a stack's schedule and apply it to every follower
 *     description: >
 *       One schedule per stack. Atomic: every follower's timing changes, or
 *       nothing does. A retry with the same operation_id returns the first result.
 *   delete:
 *     summary: Remove a stack's schedule
 *     description: Plans keep the rules they have.
 */
router.put('/:id/schedule', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const body = medicationStackScheduleSaveInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    const { result, created } = await saveStackSchedule(
      req.userId,
      params.data.id,
      body.data
    );
    res.status(created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/schedule', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const body = medicationStackScheduleClearInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    await clearStackSchedule(req.userId, params.data.id, body.data);
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
