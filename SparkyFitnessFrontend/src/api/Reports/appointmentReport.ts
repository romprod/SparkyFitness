import { apiCall } from '@/api/api';

export interface AppointmentReportRequest {
  from: string;
  to: string;
  timezone: string;
  expected_owner_id: string;
}

export async function getAppointmentReportPdf(
  request: AppointmentReportRequest,
  signal: AbortSignal
): Promise<Blob> {
  const blob = await apiCall('/v2/reports/appointment.pdf', {
    method: 'GET',
    params: request,
    signal,
    responseType: 'blob',
    suppressErrorToast: true,
  });
  if (
    blob.type.split(';')[0]?.trim().toLowerCase() !== 'application/pdf' ||
    (await blob.slice(0, 5).text()) !== '%PDF-'
  ) {
    throw new Error('The server did not return a PDF report.');
  }
  return blob;
}
