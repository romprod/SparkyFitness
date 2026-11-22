import express from 'express';
import {
  METABOLIC_TEST_EXPORT_HEADERS,
  metabolicTestExportRows,
  metabolicTestInputSchema,
  toCsv,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as metabolicTests from '../../models/metabolicTestRepository.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { sendCsvDownload } from '../../utils/csvResponse.js';

/**
 * Measured resting metabolic rate (RMR) tests. Same access as lab results: the owner, or a
 * caregiver with check-in access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('checkin'));

const invalid = (res: express.Response, error: { flatten: () => unknown }) =>
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
const actor = (req: express.Request) => req.authenticatedUserId || req.userId;

/**
 * @openapi
 * /v2/metabolic-tests:
 *   get:
 *     summary: List measured RMR tests, newest first
 *     tags: [Check-in]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      metabolic_tests: await metabolicTests.listMetabolicTests(
        req.userId,
        actor(req)
      ),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/metabolic-tests/export:
 *   get:
 *     summary: Download every RMR test as CSV, newest first (notes are not included)
 *     tags: [Check-in]
 */
router.get('/export', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const tests = await metabolicTests.listMetabolicTests(
      req.userId,
      actor(req)
    );
    sendCsvDownload(
      res,
      'rmr-tests',
      timezone,
      toCsv(METABOLIC_TEST_EXPORT_HEADERS, metabolicTestExportRows(tests))
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/metabolic-tests:
 *   post:
 *     summary: Add a measured RMR test
 *     tags: [Check-in]
 */
router.post('/', async (req, res, next) => {
  try {
    const body = metabolicTestInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.status(201).json({
      id: await metabolicTests.createMetabolicTest(
        req.userId,
        body.data,
        actor(req)
      ),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/metabolic-tests/{id}:
 *   delete:
 *     summary: Delete an RMR test; one already deleted counts as deleted
 *     tags: [Check-in]
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await metabolicTests.deleteMetabolicTest(
      req.userId,
      params.data.id,
      actor(req)
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
