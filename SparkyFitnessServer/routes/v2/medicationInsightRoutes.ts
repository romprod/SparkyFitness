import express from 'express';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { getMedicationInsightStreams } from '../../services/medicationInsightService.js';

/**
 * The records behind the Insights card, for the trailing 90 days. Same access as the medication
 * APIs: the owner, or a caregiver with medication access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('medications'));

/**
 * @openapi
 * /v2/medication-insights:
 *   get:
 *     summary: Doses, wearable days, weights and symptoms of the last 90 days, with adherence
 *     tags: [Medications]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The records to compare, weights in kilograms
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(
      await getMedicationInsightStreams(
        req.userId,
        req.authenticatedUserId || req.userId
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
