import type { Response } from 'express';
import { instantToDay } from '@workspace/shared';

/**
 * Sends a CSV as a download named `<name>-YYYY-MM-DD.csv`, dated in the person's own time zone, as
 * Pitstop's exports are. Never cached: it holds personal records.
 */
export function sendCsvDownload(
  res: Response,
  name: string,
  timezone: string,
  csv: string
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}-${instantToDay(new Date(), timezone)}.csv"`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(csv);
}
