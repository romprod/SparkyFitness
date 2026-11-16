import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import {
  medicationCourseDaySchema,
  medicationCourseCreateInputSchema,
  medicationCourseReviewInputSchema,
  medicationCourseReviseInputSchema,
  medicationCourseEditInputSchema,
  medicationCourseStatusInputSchema,
  medicationCourseDeleteInputSchema,
  medicationCourseCycleReviewInputSchema,
  medicationCourseCycleActionInputSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import * as service from '../../services/medicationCourseService.js';
import * as cycles from '../../services/medicationCourseCycleService.js';
const router = express.Router();
router.use(
  authenticate,
  onBehalfOfMiddleware,
  checkPermissionMiddleware('medications')
);
const idSchema = z.string().uuid();
const listSchema = z.object({ medication_id: idSchema.optional() }).strict();
const dueSchema = z
  .object({ date: medicationCourseDaySchema.optional() })
  .strict();
const historySchema = z
  .object({
    from: medicationCourseDaySchema.optional(),
    to: medicationCourseDaySchema.optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to);
const run =
  (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: 'Invalid course request.', details: error.flatten() });
        return;
      }
      next(error);
    }
  };
router.get(
  '/',
  run(async (req, res) => {
    const query = listSchema.parse(req.query);
    res.json(
      await service.listMedicationCourses(req.userId, query.medication_id)
    );
  })
);
router.get(
  '/due',
  run(async (req, res) => {
    const query = dueSchema.parse(req.query);
    res.json(await service.getMedicationCourseDue(req.userId, query.date));
  })
);
router.get(
  '/medications/:medicationId/handoff-rules',
  run(async (req, res) => {
    res.json(
      await service.listCourseHandoffRules(
        req.userId,
        idSchema.parse(req.params.medicationId)
      )
    );
  })
);
router.post(
  '/medications/:medicationId/create-review',
  run(async (req, res) => {
    res.json(
      await service.reviewMedicationCourseCreate(
        req.userId,
        idSchema.parse(req.params.medicationId),
        medicationCourseReviewInputSchema.parse(req.body)
      )
    );
  })
);
router.post(
  '/',
  run(async (req, res) => {
    res
      .status(201)
      .json(
        await service.createMedicationCourse(
          req.userId,
          medicationCourseCreateInputSchema.parse(req.body)
        )
      );
  })
);
router.get(
  '/:id/cycle',
  run(async (req, res) => {
    res.json(
      await cycles.getMedicationCourseCycle(
        req.userId,
        idSchema.parse(req.params.id)
      )
    );
  })
);
router.post(
  '/:id/cycle-review',
  run(async (req, res) => {
    res.json(
      await cycles.reviewMedicationCourseCycle(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseCycleReviewInputSchema.parse(req.body)
      )
    );
  })
);
router.post(
  '/:id/cycle-end',
  run(async (req, res) => {
    res.json(
      await cycles.endMedicationCourseCycle(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseCycleActionInputSchema.parse(req.body)
      )
    );
  })
);
router.post(
  '/:id/cycle-start',
  run(async (req, res) => {
    res.json(
      await cycles.startMedicationCourseCycle(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseCycleActionInputSchema.parse(req.body)
      )
    );
  })
);
router.get(
  '/:id/history',
  run(async (req, res) => {
    const query = historySchema.parse(req.query);
    res.json(
      await service.getMedicationCourseHistory(
        req.userId,
        idSchema.parse(req.params.id),
        query.from,
        query.to
      )
    );
  })
);
router.get(
  '/:id',
  run(async (req, res) => {
    res.json(
      await service.getMedicationCourse(
        req.userId,
        idSchema.parse(req.params.id)
      )
    );
  })
);
router.post(
  '/:id/review',
  run(async (req, res) => {
    res.json(
      await service.reviewMedicationCourse(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseReviewInputSchema.parse(req.body)
      )
    );
  })
);
router.post(
  '/:id/revise',
  run(async (req, res) => {
    res.json(
      await service.reviseMedicationCourse(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseReviseInputSchema.parse(req.body)
      )
    );
  })
);
router.put(
  '/:id',
  run(async (req, res) => {
    res.json(
      await service.editMedicationCourse(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseEditInputSchema.parse(req.body)
      )
    );
  })
);
router.post(
  '/:id/status',
  run(async (req, res) => {
    res.json(
      await service.setMedicationCourseStatus(
        req.userId,
        idSchema.parse(req.params.id),
        medicationCourseStatusInputSchema.parse(req.body)
      )
    );
  })
);
router.delete(
  '/:id/revisions/:revisionId',
  run(async (req, res) => {
    res.json(
      await service.deleteMedicationCourseRevision(
        req.userId,
        idSchema.parse(req.params.id),
        idSchema.parse(req.params.revisionId),
        medicationCourseDeleteInputSchema.parse(req.body)
      )
    );
  })
);
router.delete(
  '/:id',
  run(async (req, res) => {
    res.json(
      await service.deleteMedicationCourseRevision(
        req.userId,
        idSchema.parse(req.params.id),
        null,
        medicationCourseDeleteInputSchema.parse(req.body)
      )
    );
  })
);
export default router;
