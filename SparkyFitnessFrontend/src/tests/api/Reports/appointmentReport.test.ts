import { getAppointmentReportPdf } from '@/api/Reports/appointmentReport';
import { apiCall } from '@/api/api';
jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const call = jest.mocked(apiCall);
const request = {
  from: '2026-01-01',
  to: '2026-03-31',
  timezone: 'Europe/London',
  expected_owner_id: 'synthetic-owner',
};
function blob(type: string, signature: string) {
  const result = new Blob(['synthetic'], { type });
  Object.defineProperty(result, 'slice', {
    value: () => ({ text: async () => signature }),
  });
  return result;
}
beforeEach(() => call.mockReset());
it('uses the existing authenticated binary client and canonical owner/date/timezone query', async () => {
  const pdf = blob('application/pdf', '%PDF-');
  call.mockResolvedValue(pdf);
  const signal = new AbortController().signal;
  expect(await getAppointmentReportPdf(request, signal)).toBe(pdf);
  expect(call).toHaveBeenCalledWith('/v2/reports/appointment.pdf', {
    method: 'GET',
    params: request,
    signal,
    responseType: 'blob',
    suppressErrorToast: true,
  });
});
it.each([
  ['text/html', '<!doc'],
  ['application/json', '{"err'],
  ['application/pdf', '<!doc'],
])(
  'rejects an error document (%s) instead of returning it as a PDF',
  async (type, signature) => {
    call.mockResolvedValue(blob(type, signature));
    await expect(
      getAppointmentReportPdf(request, new AbortController().signal)
    ).rejects.toThrow('The server did not return a PDF report.');
  }
);
it('propagates HTTP/abort failures for real UI feedback', async () => {
  const error = new Error('HTTP failed');
  call.mockRejectedValue(error);
  await expect(
    getAppointmentReportPdf(request, new AbortController().signal)
  ).rejects.toBe(error);
});
