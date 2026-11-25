import {
  bodyCompReportReadResponseSchema,
  bodyCompScanListSchema,
  type BodyCompScanInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listBodyCompScans = async (signal?: AbortSignal) =>
  bodyCompScanListSchema.parse(
    await apiCall('/v2/body-comp-scans', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

export const createBodyCompScan = (
  body: BodyCompScanInput
): Promise<{ id: string }> =>
  apiCall('/v2/body-comp-scans', {
    method: 'POST',
    body,
    suppressErrorToast: true,
  });

export const deleteBodyCompScan = (id: string): Promise<void> =>
  apiCall(`/v2/body-comp-scans/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });

/**
 * Reads a Hologic report PDF (as base64) into the values a scan takes. Nothing is saved. A report
 * that cannot be read is a 422 whose `code` is no_text_layer, not_hologic, unreadable or
 * too_many_pages.
 */
export const readBodyCompReport = async (pdfBase64: string) =>
  bodyCompReportReadResponseSchema.parse(
    await apiCall('/v2/body-comp-scans/read-report', {
      method: 'POST',
      body: { pdf_base64: pdfBase64 },
      suppressErrorToast: true,
    })
  );
