import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import {
  medicationPrescriptionQuerySchema,
  medicationPrescriptionCreateSchema,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionDeleteSchema,
  medicationPrescriptionListSchema,
  medicationPrescriptionDetailSchema,
  medicationPrescriptionMutationResultSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import * as prescriptions from '../../models/medicationPrescriptionRepository.js';
const router = express.Router();
router.use(authenticate);
const run =
  (
    work: (
      req: express.Request,
      res: express.Response,
      owner: string,
      expected?: string
    ) => Promise<void>
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const query = medicationPrescriptionQuerySchema.parse(req.query);
      const owner = req.authenticatedUserId || req.originalUserId || req.userId;
      const assertions = [
        req.userId,
        req.originalUserId,
        req.headers['x-on-behalf-of-user-id'],
        query.expected_owner_id,
      ];
      if (
        !owner ||
        assertions.some((value) => value !== undefined && value !== owner)
      ) {
        res.status(403).json({
          error: 'Prescriptions are private to their signed-in owner.',
        });
        return;
      }
      await work(req, res, owner, query.expected_owner_id);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid prescription request.' });
        return;
      }
      next(error);
    }
  };
const id = (req: express.Request) => z.string().uuid().parse(req.params.id);
router.get(
  '/',
  run(async (_req, res, owner, expected) => {
    res.json(
      medicationPrescriptionListSchema.parse({
        prescriptions: await prescriptions.listMedicationPrescriptions(
          owner,
          expected
        ),
      })
    );
  })
);
router.get(
  '/:id',
  run(async (req, res, owner, expected) => {
    res.json(
      medicationPrescriptionDetailSchema.parse({
        prescription: await prescriptions.getMedicationPrescription(
          owner,
          id(req),
          expected
        ),
      })
    );
  })
);
router.post(
  '/',
  run(async (req, res, owner, expected) => {
    res
      .status(201)
      .json(
        medicationPrescriptionMutationResultSchema.parse(
          await prescriptions.createMedicationPrescription(
            owner,
            medicationPrescriptionCreateSchema.parse(req.body),
            expected
          )
        )
      );
  })
);
router.put(
  '/:id',
  run(async (req, res, owner, expected) => {
    res.json(
      medicationPrescriptionMutationResultSchema.parse(
        await prescriptions.updateMedicationPrescription(
          owner,
          id(req),
          medicationPrescriptionUpdateSchema.parse(req.body),
          expected
        )
      )
    );
  })
);
router.delete(
  '/:id',
  run(async (req, res, owner, expected) => {
    res.json(
      medicationPrescriptionMutationResultSchema.parse(
        await prescriptions.deleteMedicationPrescription(
          owner,
          id(req),
          medicationPrescriptionDeleteSchema.parse(req.body),
          expected
        )
      )
    );
  })
);
export default router;
