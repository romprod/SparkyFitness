import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppointmentPdfExport from '@/pages/Reports/AppointmentPdfExport';
import { getAppointmentReportPdf } from '@/api/Reports/appointmentReport';
import { getMedicationPurchaseIdentity } from '@/api/Medications/purchaseService';
let mockUser: { id: string; activeUserId: string } | null;
let mockTimezone = 'America/New_York';
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ activeUserId: mockUser?.activeUserId ?? null }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: mockTimezone }),
}));
jest.mock('@/api/Medications/purchaseService', () => ({
  getMedicationPurchaseIdentity: jest.fn(),
}));
jest.mock('@/api/Reports/appointmentReport', () => ({
  getAppointmentReportPdf: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const identity = jest.mocked(getMedicationPurchaseIdentity);
const pdf = jest.mocked(getAppointmentReportPdf);
const createUrl = jest.fn(() => 'blob:synthetic-report');
const revokeUrl = jest.fn();
let filenames: string[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <AppointmentPdfExport />
    </QueryClientProvider>
  );
  return { client, tree, ...render(tree()) };
}
beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-03-10T03:30:00Z') });
  mockUser = { id: 'owner', activeUserId: 'owner' };
  mockTimezone = 'America/New_York';
  identity.mockReset();
  pdf.mockReset();
  createUrl.mockClear();
  revokeUrl.mockClear();
  filenames = [];
  identity.mockImplementation(async () => ({
    authenticatedUserId: mockUser!.id,
    activeUserId: mockUser!.activeUserId,
  }));
  pdf.mockResolvedValue(
    new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' })
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeUrl,
  });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    filenames.push(this.download);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it('uses an independent user-zone 90-calendar-day range across DST and downloads an all-empty valid report', async () => {
  const { unmount } = setup();
  const button = await screen.findByRole('button', { name: 'Download PDF' });
  expect(screen.getByLabelText('PDF to')).toHaveValue('2026-03-09');
  expect(screen.getByLabelText('PDF from')).toHaveValue('2025-12-09');
  expect(screen.getByLabelText('PDF from')).toHaveAttribute(
    'max',
    '2026-03-09'
  );
  expect(screen.getByLabelText('PDF to')).toHaveAttribute('min', '2025-12-09');
  expect(
    screen.getByText(/latest three explicit lab panels regardless of period/)
  ).toBeInTheDocument();
  fireEvent.click(button);
  await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
  expect(pdf).toHaveBeenCalledWith(
    {
      from: '2025-12-09',
      to: '2026-03-09',
      timezone: 'America/New_York',
      expected_owner_id: 'owner',
    },
    expect.any(AbortSignal)
  );
  expect(filenames).toEqual([
    'appointment-report-2025-12-09-to-2026-03-09.pdf',
  ]);
  expect(document.querySelector('a[download]')).toBeNull();
  unmount();
  expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-report');
});
it('blocks invalid/reversed dates and sends no PDF request', async () => {
  setup();
  await screen.findByRole('button', { name: 'Download PDF' });
  fireEvent.change(screen.getByLabelText('PDF from'), {
    target: { value: '2026-03-10' },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'PDF from must be on or before PDF to.'
  );
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('PDF from'), {
    target: { value: '2026-02-30' },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter valid PDF from and PDF to dates.'
  );
  expect(screen.getByLabelText('PDF from')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  expect(pdf).not.toHaveBeenCalled();
});
it('waits for authoritative self proof and never enables PDF for delegated or wrong-actor proof', async () => {
  let resolve!: (v: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  identity.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  setup();
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
  expect(pdf).not.toHaveBeenCalled();
  await act(async () =>
    resolve({ authenticatedUserId: 'owner', activeUserId: 'delegate' })
  );
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
  expect(pdf).not.toHaveBeenCalled();
});
it.each([null, { id: 'owner', activeUserId: 'delegate' }])(
  'never exposes PDF controls or requests for unavailable/delegated identity %s',
  (user) => {
    mockUser = user;
    setup();
    expect(identity).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Download PDF' })
    ).not.toBeInTheDocument();
  }
);
it('fails closed on identity failure', async () => {
  identity.mockRejectedValue(new Error('unavailable'));
  const { client } = setup();
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error')
  );
  expect(pdf).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
});
it('disables duplicate requests while pending and reports download failure without saving error HTML', async () => {
  let reject!: (error: Error) => void;
  pdf.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    })
  );
  setup();
  const button = await screen.findByRole('button', { name: 'Download PDF' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(pdf).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Preparing PDF…' })).toBeDisabled();
  expect(screen.getByLabelText('PDF from')).toBeDisabled();
  await act(async () => reject(new Error('<html>proxy error</html>')));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not download the PDF report. Try again.'
  );
  expect(screen.queryByText(/proxy error/)).not.toBeInTheDocument();
  expect(createUrl).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
});
it('aborts and ignores a delayed blob when the profile changes', async () => {
  let resolve!: (blob: Blob) => void;
  pdf.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { tree, rerender } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
  const signal = pdf.mock.calls[0]![1];
  mockUser = { id: 'owner', activeUserId: 'delegate' };
  rerender(tree());
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve(new Blob(['%PDF-1.4 stale'], { type: 'application/pdf' }))
  );
  expect(createUrl).not.toHaveBeenCalled();
  expect(filenames).toEqual([]);
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
});
it('clears same-UUID proof/draft on cache clear and ignores an older generation completion', async () => {
  let resolve!: (blob: Blob) => void;
  pdf.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { client, tree, rerender } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
  const signal = pdf.mock.calls[0]![1];
  act(() => client.clear());
  expect(signal.aborted).toBe(true);
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
  rerender(tree());
  expect(identity).toHaveBeenCalledTimes(1);
  mockUser = { id: 'owner', activeUserId: 'owner' };
  rerender(tree());
  await screen.findByRole('button', { name: 'Download PDF' });
  await act(async () =>
    resolve(new Blob(['%PDF-1.4 old'], { type: 'application/pdf' }))
  );
  expect(createUrl).not.toHaveBeenCalled();
});
it('reformats untouched defaults after initial preference timezone resolves and preserves explicit range edits', async () => {
  mockTimezone = 'UTC';
  const { tree, rerender } = setup();
  await screen.findByRole('button', { name: 'Download PDF' });
  expect(screen.getByLabelText('PDF to')).toHaveValue('2026-03-10');
  mockTimezone = 'America/New_York';
  rerender(tree());
  expect(screen.getByLabelText('PDF to')).toHaveValue('2026-03-09');
  fireEvent.change(screen.getByLabelText('PDF from'), {
    target: { value: '2026-01-01' },
  });
  fireEvent.change(screen.getByLabelText('PDF to'), {
    target: { value: '2026-01-31' },
  });
  mockTimezone = 'Europe/London';
  rerender(tree());
  expect(screen.getByLabelText('PDF from')).toHaveValue('2026-01-01');
  expect(screen.getByLabelText('PDF to')).toHaveValue('2026-01-31');
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() =>
    expect(pdf).toHaveBeenCalledWith(
      {
        from: '2026-01-01',
        to: '2026-01-31',
        timezone: 'Europe/London',
        expected_owner_id: 'owner',
      },
      expect.any(AbortSignal)
    )
  );
});

it('does not reuse a delayed self proof after the active profile changes', async () => {
  let resolve!: (v: {
    authenticatedUserId: string;
    activeUserId: string;
  }) => void;
  identity.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const { tree, rerender } = setup();
  mockUser = { id: 'owner', activeUserId: 'delegate' };
  rerender(tree());
  await act(async () =>
    resolve({ authenticatedUserId: 'owner', activeUserId: 'owner' })
  );
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
  expect(pdf).not.toHaveBeenCalled();
});
it('rejects proof for the wrong authenticated actor even when the active ID looks self-owned', async () => {
  identity.mockResolvedValue({
    authenticatedUserId: 'other',
    activeUserId: 'owner',
  });
  const { client } = setup();
  await waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe('success')
  );
  expect(
    screen.queryByRole('button', { name: 'Download PDF' })
  ).not.toBeInTheDocument();
  expect(pdf).not.toHaveBeenCalled();
});
it('falls back to a valid browser timezone when the preference is invalid', async () => {
  mockTimezone = 'not-a-timezone';
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(pdf).toHaveBeenCalled());
  expect(pdf.mock.calls[0]![0].timezone).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
});
it('revokes the completed download URL after the browser has received its click', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
  act(() => jest.advanceTimersByTime(1000));
  expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-report');
});
