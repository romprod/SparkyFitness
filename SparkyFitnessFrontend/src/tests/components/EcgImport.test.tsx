import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EcgImportOutcome } from '@workspace/shared';
import EcgImport from '@/pages/Labs/EcgImport';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
const mockImport = jest.fn();
jest.mock('@/api/Labs/ecgRecordingService', () => ({
  importEcgReport: (file: File) => mockImport(file),
  listEcgRecordings: jest.fn(),
  getEcgRecording: jest.fn(),
  deleteEcgRecording: jest.fn(),
}));

const pdf = (name: string) =>
  new File(['x'], name, { type: 'application/pdf' });
const outcome = (
  file: string,
  status: EcgImportOutcome['status'],
  message = 'ok'
): EcgImportOutcome => ({ file, status, message });

const renderImport = (compact = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <EcgImport compact={compact} />
    </QueryClientProvider>
  );
  return { invalidate };
};
const choose = (files: File[]) =>
  fireEvent.change(screen.getByTestId('ecg-file-input'), {
    target: { files },
  });

beforeEach(() => mockImport.mockReset());

describe('EcgImport', () => {
  it('shows the full hint at first and the compact one when something is imported', () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <EcgImport />
      </QueryClientProvider>
    );
    expect(screen.getByText(/share it as a PDF/)).toBeInTheDocument();
    expect(
      screen.getByText(/Drop the files here, or choose them/)
    ).toBeInTheDocument();
    unmount();
    renderImport(true);
    expect(
      screen.getByText('PDFs from Garmin Connect. Drop several at once.')
    ).toBeInTheDocument();
  });

  it('sends each file in its own request, in order, and lists the outcomes', async () => {
    mockImport.mockImplementation(async (file: File) =>
      outcome(file.name, file.name === 'b.pdf' ? 'updated' : 'imported')
    );
    renderImport();
    choose([pdf('a.pdf'), pdf('b.pdf')]);
    await waitFor(() => expect(screen.getByText('b.pdf')).toBeInTheDocument());
    expect(mockImport).toHaveBeenCalledTimes(2);
    expect(mockImport.mock.calls.map((c) => (c[0] as File).name)).toEqual([
      'a.pdf',
      'b.pdf',
    ]);
    expect(screen.getByText('imported')).toBeInTheDocument();
    expect(screen.getByText('refreshed')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 added or refreshed')).toBeInTheDocument();
  });

  it('refreshes the list after an import', async () => {
    mockImport.mockResolvedValue(outcome('a.pdf', 'imported'));
    const { invalidate } = renderImport();
    choose([pdf('a.pdf')]);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['ecg-recordings'],
      })
    );
  });

  it('does not refresh when nothing was added', async () => {
    mockImport.mockResolvedValue(
      outcome('a.pdf', 'duplicate', 'Already here.')
    );
    const { invalidate } = renderImport();
    choose([pdf('a.pdf')]);
    await waitFor(() =>
      expect(screen.getByText('already here')).toBeInTheDocument()
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refuses more than 25 files with the message and sends none', async () => {
    renderImport();
    choose(Array.from({ length: 26 }, (_, i) => pdf(`${i}.pdf`)));
    expect(
      await screen.findByText('Import at most 25 reports at a time.')
    ).toBeInTheDocument();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('shows a refused non-PDF as not read, without sending it', async () => {
    mockImport.mockImplementation(async (file: File) =>
      outcome(file.name, 'imported')
    );
    renderImport();
    choose([new File(['x'], 'photo.png', { type: 'image/png' }), pdf('a.pdf')]);
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument());
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('not read')).toBeInTheDocument();
  });

  it('shows a failed request as that file failing and still imports the rest', async () => {
    mockImport.mockImplementation(async (file: File) => {
      if (file.name === 'a.pdf') throw new Error('network');
      return outcome(file.name, 'imported');
    });
    const { invalidate } = renderImport();
    choose([pdf('a.pdf'), pdf('b.pdf')]);
    await waitFor(() => expect(screen.getByText('b.pdf')).toBeInTheDocument());
    expect(mockImport).toHaveBeenCalledTimes(2);
    expect(screen.getByText('not read')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 added or refreshed')).toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
