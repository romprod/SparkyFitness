import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import {
  medicationReorderDefaultsInputSchema,
  medicationInventoryForecastQuerySchema,
  type MedicationInventoryForecastQuery,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { getMedicationInventoryDashboard } from '../../services/medicationInventoryDashboardService.js';
import { getMedicationInventoryForecast } from '../../services/medicationInventoryForecastService.js';
import {
  getMedicationReorderDefaults,
  saveMedicationReorderDefaults,
} from '../../services/medicationReorderService.js';
import { courseProblem } from '../../models/medicationCourseRepository.js';
const querySchema = z
  .object({ expected_owner_id: z.string().uuid().optional() })
  .strict();
const run =
  (
    handler: (
      req: express.Request,
      res: express.Response,
      query: MedicationInventoryForecastQuery
    ) => Promise<void>,
    allowForecastMode = false
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      const query = allowForecastMode
        ? medicationInventoryForecastQuerySchema.parse(req.query)
        : querySchema.parse(req.query);
      if (query.expected_owner_id && query.expected_owner_id !== req.userId)
        throw courseProblem(
          'The active profile changed. Refresh this request.'
        );
      res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      await handler(req, res, query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid inventory request.' });
        return;
      }
      next(error);
    }
  };
export const medicationInventoryRoutes = express.Router();
medicationInventoryRoutes.use(
  authenticate,
  onBehalfOfMiddleware,
  checkPermissionMiddleware('medications')
);
medicationInventoryRoutes.get(
  '/forecast',
  run(async (req, res, query) => {
    res.json(
      query.forecast_mode === 'planned_cycles'
        ? await getMedicationInventoryForecast(
            req.userId,
            undefined,
            'planned_cycles'
          )
        : await getMedicationInventoryForecast(req.userId)
    );
  }, true)
);
medicationInventoryRoutes.get(
  '/dashboard',
  run(async (req, res, query) => {
    res.json(
      query.forecast_mode === 'planned_cycles'
        ? await getMedicationInventoryDashboard(
            req.userId,
            undefined,
            'planned_cycles'
          )
        : await getMedicationInventoryDashboard(req.userId)
    );
  }, true)
);
export const medicationReorderRoutes = express.Router();
medicationReorderRoutes.use(authenticate, onBehalfOfMiddleware);
medicationReorderRoutes.get(
  '/medication-reorder',
  run(async (req, res) => {
    res.json(await getMedicationReorderDefaults(req.userId));
  })
);
medicationReorderRoutes.put(
  '/medication-reorder',
  run(async (req, res) => {
    res.json(
      await saveMedicationReorderDefaults(
        req.userId,
        medicationReorderDefaultsInputSchema.parse(req.body)
      )
    );
  })
);
