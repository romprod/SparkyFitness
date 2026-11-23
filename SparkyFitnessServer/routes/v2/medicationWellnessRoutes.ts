import express from 'express';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { getMedicationWellnessStreams } from '../../services/medicationWellnessService.js';

/**
 * The records behind the recovery and weight tile on the medication page, for the last fortnight.
 * Same access as the medication APIs: the owner, or a caregiver with medication access acting on
 * their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('medications'));

/**
 * @openapi
 * /v2/medication-wellness:
 *   get:
 *     summary: Garmin recovery figures and workouts of the last 14 days and the last 7 days of weight
 *     tags: [Medications]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The records the tile summarises, weights in kilograms
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(
      await getMedicationWellnessStreams(
        req.userId,
        req.authenticatedUserId || req.userId
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
