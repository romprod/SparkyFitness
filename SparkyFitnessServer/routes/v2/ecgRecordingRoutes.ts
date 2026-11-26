import express from 'express';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'multer'
import multer from 'multer';
import {
  ECG_IMPORT_MAX_FILE_BYTES,
  ECG_IMPORT_MAX_FILES,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { demoGuard } from '../../middleware/demoGuardMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import {
  getEcgRecording,
  listEcgRecordings,
} from '../../models/ecgRecordingRepository.js';
import {
  importEcgReports,
  removeEcgRecording,
  type EcgUploadFile,
} from '../../services/ecgRecordingService.js';

/**
 * Garmin ECG recordings, read from the PDF Garmin Connect exports. Same access as lab results and
 * DEXA scans: the owner, or a caregiver with check-in access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('checkin'));

const invalid = (res: express.Response, error: { flatten: () => unknown }) =>
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
const actor = (req: express.Request) => req.authenticatedUserId || req.userId;

const NO_FILES = 'Choose at least one ECG PDF.';
const TOO_MANY = `Import at most ${ECG_IMPORT_MAX_FILES} reports at a time.`;

/** The reports are read in memory: up to 25 files of 10 MB each. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ECG_IMPORT_MAX_FILE_BYTES, files: ECG_IMPORT_MAX_FILES },
});

/**
 * @openapi
 * /v2/ecg-recordings:
 *   get:
 *     summary: List ECG recordings, newest first, without their traces (at most 200)
 *     tags: [Check-in]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      ecg_recordings: await listEcgRecordings(req.userId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/ecg-recordings/import:
 *   post:
 *     summary: Read Garmin ECG reports (PDF) and save each as a recording
 *     description: >
 *       Send 1 to 25 PDFs, up to 10 MB each, as the multipart field `files`. Each file is read and
 *       saved in turn and has its own outcome: imported, updated (the same printed time was already
 *       stored and is refreshed), duplicate or failed, with a message. The report's name, date of
 *       birth, age and sex are never read. The printed time has no zone and is read in the user's
 *       profile time zone. The PDF is kept as a stored original of kind ecg_report.
 *     tags: [Check-in]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files: { type: array, items: { type: string, format: binary } }
 */
router.post(
  '/import',
  demoGuard,
  (req, res, next) =>
    upload.array('files', ECG_IMPORT_MAX_FILES)(
      req,
      res,
      (error?: { code?: string; message?: string }) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE')
          return void res.status(413).json({
            error: `A file is too large: ${ECG_IMPORT_MAX_FILE_BYTES / 1024 / 1024} MB at most.`,
          });
        if (error.code === 'LIMIT_FILE_COUNT')
          return void res.status(400).json({ error: TOO_MANY });
        // A file under another field name is not one this takes.
        if (error.code === 'LIMIT_UNEXPECTED_FILE')
          return void res.status(400).json({ error: NO_FILES });
        return void res.status(400).json({
          error: error.message ?? 'The files could not be read.',
        });
      }
    ),
  async (req, res, next) => {
    try {
      // @ts-expect-error multer attaches req.files at runtime; it ships no types.
      const files = (req.files ?? []) as EcgUploadFile[];
      if (files.length === 0)
        return void res.status(400).json({ error: NO_FILES });
      if (files.length > ECG_IMPORT_MAX_FILES)
        return void res.status(400).json({ error: TOO_MANY });
      res.json({
        outcomes: await importEcgReports(req.userId, files, actor(req)),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /v2/ecg-recordings/{id}:
 *   get:
 *     summary: One ECG recording with its trace and the stored PDF's id
 *     tags: [Check-in]
 */
router.get('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    const found = await getEcgRecording(req.userId, params.data.id, actor(req));
    if (!found) {
      res.status(404).json({ error: 'ECG recording not found' });
      return;
    }
    res.json({ ecg_recording: found });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/ecg-recordings/{id}:
 *   delete:
 *     summary: Delete a recording and its stored PDF; one already deleted counts as deleted
 *     tags: [Check-in]
 */
router.delete('/:id', demoGuard, async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await removeEcgRecording(req.userId, params.data.id, actor(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
