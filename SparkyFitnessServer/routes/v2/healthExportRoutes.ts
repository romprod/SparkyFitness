import express from 'express';
import {
  JOURNAL_EXPORT_HEADERS,
  WEARABLE_EXPORT_HEADERS,
  journalExportRecords,
  journalExportRows,
  toCsv,
  wearableExportRows,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import {
  listWearableExportRecords,
  loadJournalExportParts,
} from '../../models/healthExportRepository.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { sendCsvDownload } from '../../utils/csvResponse.js';

/**
 * CSV downloads of daily health records. Same access as the check-in APIs: the owner, or a
 * caregiver with check-in access acting on their behalf. Symptoms are not here: they need their
 * own permission and have their own report.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('checkin'));

const actor = (req: express.Request) => req.authenticatedUserId || req.userId;

/**
 * @openapi
 * /v2/health-exports/wearable:
 *   get:
 *     summary: Download the wearable's daily figures (sleep, heart, stress, activity) as CSV
 *     tags: [Check-in]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A CSV file, newest day first, one row per day and source
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/wearable', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const records = await listWearableExportRecords(req.userId, actor(req));
    sendCsvDownload(
      res,
      'wearable',
      timezone,
      toCsv(WEARABLE_EXPORT_HEADERS, wearableExportRows(records))
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/health-exports/journal:
 *   get:
 *     summary: Download the daily journal (weight, mood, energy, focus, sleep, water, notes) as CSV
 *     tags: [Check-in]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A CSV file, newest day first, one row per day
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/journal', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const parts = await loadJournalExportParts(req.userId, actor(req));
    sendCsvDownload(
      res,
      'journal',
      timezone,
      toCsv(
        JOURNAL_EXPORT_HEADERS,
        journalExportRows(journalExportRecords(parts))
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
