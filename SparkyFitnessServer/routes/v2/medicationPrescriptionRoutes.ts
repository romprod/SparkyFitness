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
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchemaV2,
  medicationPrescriptionListSchemaV2,
  medicationPrescriptionDetailSchemaV2,
  PRESCRIPTION_MODEL_VERSION,
  PRESCRIPTION_MODEL_VERSION_HEADER,
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
        const currencyRefused = error.issues.some(
          (issue) =>
            issue.path[0] === 'currency' &&
            issue.message === 'Currency is required.'
        );
        res.status(400).json({
          error: currencyRefused
            ? 'Currency is required.'
            : 'Invalid prescription request.',
        });
        return;
      }
      next(error);
    }
  };
const id = (req: express.Request) => z.string().uuid().parse(req.params.id);
// Without the header every request and response keeps the one-medicine contract.
const isModel2 = (req: express.Request) =>
  (Number(req.header(PRESCRIPTION_MODEL_VERSION_HEADER)) || 1) >=
  PRESCRIPTION_MODEL_VERSION;
router.get(
  '/',
  run(async (req, res, owner, expected) => {
    if (isModel2(req)) {
      res.json(
        medicationPrescriptionListSchemaV2.parse({
          prescriptions: await prescriptions.listMedicationPrescriptions(
            owner,
            expected,
            2
          ),
        })
      );
      return;
    }
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
    if (isModel2(req)) {
      res.json(
        medicationPrescriptionDetailSchemaV2.parse({
          prescription: await prescriptions.getMedicationPrescription(
            owner,
            id(req),
            expected,
            2
          ),
        })
      );
      return;
    }
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
            (isModel2(req)
              ? medicationPrescriptionCreateSchemaV2
              : medicationPrescriptionCreateSchema
            ).parse(req.body),
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
          (isModel2(req)
            ? medicationPrescriptionUpdateSchemaV2
            : medicationPrescriptionUpdateSchema
          ).parse(req.body),
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
