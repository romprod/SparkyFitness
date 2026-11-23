import express from 'express';
import {
  HEALTH_DOCUMENT_MAX_BYTES,
  healthDocumentFieldsSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { demoGuard } from '../../middleware/demoGuardMiddleware.js';
import healthDocumentUpload from '../../middleware/healthDocumentUpload.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import { listHealthDocuments } from '../../models/healthDocumentRepository.js';
import {
  openHealthDocument,
  removeHealthDocument,
  storeHealthDocument,
} from '../../services/healthDocumentService.js';

/**
 * Stored originals of reports (a lab report, a DEXA or RMR report, a prescription). Same access as
 * lab results: the owner, or a caregiver with check-in access acting on their behalf.
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
 * /v2/health-documents:
 *   get:
 *     summary: List stored originals, newest first
 *     tags: [Check-in]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      health_documents: await listHealthDocuments(req.userId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/health-documents:
 *   post:
 *     summary: Store the original of a report (a PDF or an image, up to 15 MB)
 *     tags: [Check-in]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *               kind: { type: string }
 *               label: { type: string }
 *               document_day: { type: string, format: date }
 *               body_comp_scan_id: { type: string, format: uuid }
 *               metabolic_test_id: { type: string, format: uuid }
 */
router.post(
  '/',
  demoGuard,
  (req, res, next) =>
    healthDocumentUpload.single('file')(
      req,
      res,
      (error?: { code?: string; message?: string }) => {
        if (!error) return next();
        // A file that is too big or of a type we do not keep is the sender's to fix, not a failure.
        if (error.code === 'LIMIT_FILE_SIZE')
          return void res.status(413).json({
            error: `The file is too large: ${HEALTH_DOCUMENT_MAX_BYTES / 1024 / 1024} MB at most.`,
          });
        return void res.status(400).json({
          error: error.message ?? 'The file could not be read.',
        });
      }
    ),
  async (req, res, next) => {
    try {
      // @ts-expect-error multer attaches req.file at runtime; it ships no types.
      const file = req.file as
        { buffer: Buffer; originalname?: string } | undefined;
      if (!file) {
        res.status(400).json({ error: 'No file was sent.' });
        return;
      }
      const fields = healthDocumentFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) return void invalid(res, fields.error);
      res
        .status(201)
        .json(
          await storeHealthDocument(req.userId, file, fields.data, actor(req))
        );
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /v2/health-documents/{id}/file:
 *   get:
 *     summary: Send back a stored original, as it was uploaded
 *     tags: [Check-in]
 */
router.get('/:id/file', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const found = await openHealthDocument(
      req.userId,
      params.data.id,
      actor(req)
    );
    if (!found) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    // A stored file is user-supplied: never let a browser guess a different type for it or run
    // anything inside it, and never keep a copy of a medical record in a shared cache.
    const ascii = found.original_name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');
    res.set({
      'Content-Type': found.mime,
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(found.original_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(found.absolute, (error) => {
      if (error && !res.headersSent)
        res.status(500).json({ error: 'Failed to send the document' });
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/health-documents/{id}:
 *   delete:
 *     summary: Delete a stored original and its file; one already deleted counts as deleted
 *     tags: [Check-in]
 */
router.delete('/:id', demoGuard, async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await removeHealthDocument(req.userId, params.data.id, actor(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
