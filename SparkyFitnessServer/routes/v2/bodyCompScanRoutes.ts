import express from 'express';
import {
  BODY_COMP_EXPORT_HEADERS,
  bodyCompExportRows,
  bodyCompScanInputSchema,
  toCsv,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as scans from '../../models/bodyCompScanRepository.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { sendCsvDownload } from '../../utils/csvResponse.js';

/**
 * DEXA body composition scans. Same access as lab results: the owner, or a
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
 * /v2/body-comp-scans:
 *   get:
 *     summary: List DEXA scans, newest first
 *     tags: [Check-in]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      body_comp_scans: await scans.listBodyCompScans(req.userId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans/export:
 *   get:
 *     summary: Download every scan as CSV, one row for each region and a total, newest first (serial number, software and notes are not included)
 *     tags: [Check-in]
 */
router.get('/export', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const list = await scans.listBodyCompScans(req.userId, actor(req));
    sendCsvDownload(
      res,
      'body-composition',
      timezone,
      toCsv(BODY_COMP_EXPORT_HEADERS, bodyCompExportRows(list))
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans:
 *   post:
 *     summary: Add a DEXA scan (total mass and percentage fat are worked out when left out)
 *     tags: [Check-in]
 */
router.post('/', async (req, res, next) => {
  try {
    const body = bodyCompScanInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.status(201).json({
      id: await scans.createBodyCompScan(req.userId, body.data, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans/{id}:
 *   delete:
 *     summary: Delete a scan; one already deleted counts as deleted
 *     tags: [Check-in]
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await scans.deleteBodyCompScan(req.userId, params.data.id, actor(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
