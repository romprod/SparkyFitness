import express from 'express';
import { DOSE_EXPORT_HEADERS, doseExportRows, toCsv } from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { listDoseExportRecords } from '../../models/medicationExportRepository.js';
import { listBlends } from '../../models/medicationBlendRepository.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { sendCsvDownload } from '../../utils/csvResponse.js';

/**
 * CSV downloads of medication records. Same access as the medication APIs: the owner, or a
 * caregiver with medication access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('medications'));

/**
 * @openapi
 * /v2/medication-exports/doses:
 *   get:
 *     summary: Download every recorded dose and injection as CSV
 *     tags: [Medications]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A CSV file, newest dose first; a dose of a blend is followed by one derived row for each component
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/doses', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const actor = req.authenticatedUserId || req.userId;
    const [records, blends] = await Promise.all([
      listDoseExportRecords(req.userId, actor),
      listBlends(req.userId, actor),
    ]);
    sendCsvDownload(
      res,
      'doses',
      timezone,
      toCsv(DOSE_EXPORT_HEADERS, doseExportRows(records, timezone, blends))
    );
  } catch (error) {
    next(error);
  }
});

export default router;
