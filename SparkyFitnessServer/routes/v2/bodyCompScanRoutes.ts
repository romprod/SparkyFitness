import express from 'express';
import {
  BODY_COMP_EXPORT_HEADERS,
  bodyCompExportRows,
  bodyCompReportReadRequestSchema,
  bodyCompScanInputSchema,
  hologicScanToPrefill,
  parseHologicReport,
  toCsv,
  type BodyCompReportFailure,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import { UuidParamSchema } from '../../schemas/measurementSchemas.js';
import * as scans from '../../models/bodyCompScanRepository.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import { sendCsvDownload } from '../../utils/csvResponse.js';
import { readPdfRowText } from '../../services/pdfRowText.js';

/**
 * DEXA body composition scans. Same access as lab results: the owner, or a
 * caregiver with check-in access acting on their behalf.
 */
const router = express.Router();
router.use(authenticate);
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('checkin'));

const invalid = (res: express.Response, error: { flatten: () => unknown }) =>
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
const actor = (req: express.Request) => req.authenticatedUserId || req.userId;

/** A report PDF is read in memory: up to 10 MB, as Pitstop's upload takes. */
export const MAX_REPORT_PDF_BYTES = 10 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const REPORT_FAILURE_MESSAGES: Record<BodyCompReportFailure, string> = {
  no_text_layer:
    'This PDF has no text layer to read. Enter the values by hand from the printed report.',
  not_hologic:
    'This does not look like a Hologic whole-body report: the expected rows were not found.',
  unreadable: 'This PDF could not be opened.',
  too_many_pages:
    'This PDF has too many pages to be a body composition report.',
};
const reportFailure = (
  res: express.Response,
  reason: BodyCompReportFailure,
  extra: Record<string, unknown> = {}
) =>
  // `code` is the field the web client's error type carries; `reason` is the documented name.
  res.status(422).json({
    ok: false,
    reason,
    code: reason,
    error: REPORT_FAILURE_MESSAGES[reason],
    ...extra,
  });

/** What is wrong with the sent PDF itself, or null: base64, within 10 MB, and starting %PDF-. */
function reportPdfProblem(encoded: string): {
  bytes: Buffer | null;
  problem: string | null;
} {
  if (!BASE64.test(encoded))
    return { bytes: null, problem: 'Send the PDF as base64.' };
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_REPORT_PDF_BYTES)
    return { bytes: null, problem: 'The PDF is larger than 10 MB.' };
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-')
    return { bytes: null, problem: 'This is not a PDF file.' };
  return { bytes, problem: null };
}

/**
 * @openapi
 * /v2/body-comp-scans:
 *   get:
 *     summary: List DEXA scans, newest first
 *     tags: [Check-in]
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({
      body_comp_scans: await scans.listBodyCompScans(req.userId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans/export:
 *   get:
 *     summary: Download every scan as CSV, one row for each region and a total, newest first (serial number, software and notes are not included)
 *     tags: [Check-in]
 */
router.get('/export', async (req, res, next) => {
  try {
    const timezone = await loadUserTimezone(req.userId);
    const list = await scans.listBodyCompScans(req.userId, actor(req));
    sendCsvDownload(
      res,
      'body-composition',
      timezone,
      toCsv(BODY_COMP_EXPORT_HEADERS, bodyCompExportRows(list))
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans/read-report:
 *   post:
 *     summary: Read a Hologic whole-body report (PDF) into the values a scan takes. Nothing is saved.
 *     description: >
 *       The PDF is sent as base64 (up to 10 MB decoded, eight pages) and its text layer is read in
 *       memory. The response holds the values read, the report's own checks, a confidence from 0 to
 *       1 and the anchors that were not found, for the person to review. A report that cannot be
 *       read is refused with 422 and a reason: no_text_layer, not_hologic, unreadable or
 *       too_many_pages.
 *     tags: [Check-in]
 */
router.post('/read-report', async (req, res, next) => {
  try {
    const body = bodyCompReportReadRequestSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    const { bytes, problem } = reportPdfProblem(body.data.pdf_base64);
    if (!bytes)
      return void res.status(400).json({
        error: 'Invalid request',
        details: { formErrors: [], fieldErrors: { pdf_base64: [problem] } },
      });

    const read = await readPdfRowText(new Uint8Array(bytes));
    if (read.kind === 'unreadable')
      return void reportFailure(res, 'unreadable');
    if (read.kind === 'too_many_pages')
      return void reportFailure(res, 'too_many_pages');
    if (read.text === '') return void reportFailure(res, 'no_text_layer');

    const parsed = parseHologicReport(read.text);
    if (!parsed.scan)
      return void reportFailure(res, 'not_hologic', {
        missing: parsed.missing,
      });
    res.json({
      ok: parsed.ok,
      prefill: hologicScanToPrefill(parsed.scan),
      checks: parsed.checks,
      confidence: parsed.confidence,
      missing: parsed.missing,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans:
 *   post:
 *     summary: Add a DEXA scan (total mass and percentage fat are worked out when left out)
 *     tags: [Check-in]
 */
router.post('/', async (req, res, next) => {
  try {
    const body = bodyCompScanInputSchema.safeParse(req.body);
    if (!body.success) return void invalid(res, body.error);
    res.status(201).json({
      id: await scans.createBodyCompScan(req.userId, body.data, actor(req)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v2/body-comp-scans/{id}:
 *   delete:
 *     summary: Delete a scan; one already deleted counts as deleted
 *     tags: [Check-in]
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const params = UuidParamSchema.safeParse(req.params);
    if (!params.success) return void invalid(res, params.error);
    await scans.deleteBodyCompScan(req.userId, params.data.id, actor(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
