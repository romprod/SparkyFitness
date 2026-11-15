import express, { type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authMiddleware.js';
import {
  appointmentReportQuerySchema,
  getAppointmentReportData,
} from '../../services/appointmentReportService.js';
import { renderAppointmentReportPdf } from '../../services/appointmentReportPdf.js';

/** No report/delegated grant permits a consolidated export of somebody else's records. */
export const requireAppointmentReportOwner: RequestHandler = (
  req,
  res,
  next
) => {
  const owner = req.authenticatedUserId || req.originalUserId;
  if (!owner || !req.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const foreign = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(foreign)
      : typeof value === 'string' && value.length > 0 && value !== owner;
  const targets: unknown[] = [
    req.userId,
    req.activeUserId,
    req.originalUserId,
    req.headers['x-on-behalf-of-user-id'],
    req.query.userId,
    req.query.targetUserId,
    req.query.expected_owner_id,
    req.body?.user_id,
    req.body?.targetUserId,
    req.body?.expected_owner_id,
  ];
  if (targets.some(foreign)) {
    res.status(403).json({
      error: 'Appointment reports are only available for your own account.',
    });
    return;
  }
  next();
};
const router = express.Router();
router.get(
  '/appointment.pdf',
  authenticate,
  requireAppointmentReportOwner,
  async (req, res) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const parsed = appointmentReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid appointment report date range or timezone.' });
      return;
    }
    try {
      const data = await getAppointmentReportData(
        req.authenticatedUserId!,
        parsed.data
      );
      const pdf = await renderAppointmentReportPdf(data);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="appointment-report-${data.range.to}.pdf"`,
      });
      res.send(pdf);
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        (error.statusCode === 400 || error.statusCode === 403)
          ? error.statusCode
          : 500;
      res.status(status).json({
        error:
          status === 400
            ? 'Invalid appointment report date range or timezone.'
            : status === 403
              ? 'Appointment reports are only available for your own account.'
              : 'Unable to generate appointment report.',
      });
    }
  }
);
export default router;
