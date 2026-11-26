import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HttpApiError } from '@/api/api';
import EcgRecordingPage from '@/pages/Labs/EcgRecordingPage';
import { detail } from './ecgFixtures';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockQuery: { data?: unknown; error?: unknown; isLoading?: boolean } = {};
const mockMutate = jest.fn();
jest.mock('@/hooks/Labs/useEcgRecordings', () => ({
  useEcgRecording: () => mockQuery,
  useDeleteEcgRecordingMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));
jest.mock('@/hooks/Labs/useHealthDocuments', () => ({
  useOpenHealthDocumentMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/labs/ecg/${ID}`]}>
      <Routes>
        <Route path="/labs/ecg/:id" element={<EcgRecordingPage />} />
        <Route path="/labs/ecg" element={<p>all recordings page</p>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  mockQuery = {};
  mockMutate.mockReset();
});

describe('EcgRecordingPage', () => {
  it('shows the result, the card and where the record came from', () => {
    mockQuery = { data: detail() };
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sinus Rhythm' })
    ).toBeInTheDocument();
    expect(screen.getByText('Where this came from')).toBeInTheDocument();
    expect(
      screen.getByText('Europe/London', { exact: false })
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Forerunner 970 · 19.04').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('25 mm/s, 10 mm/mV')).toBeInTheDocument();
    expect(screen.getByText('1.2.114')).toBeInTheDocument();
    expect(
      screen.getByText(/The app prints Garmin's wording and adds nothing to it/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /All ECG recordings/ })
    ).toHaveAttribute('href', '/labs/ecg');
  });

  it('says not printed for what the report did not carry', () => {
    mockQuery = {
      data: detail({
        device_model: null,
        device_software: null,
        paper_speed_mm_s: null,
        gain_mm_mv: null,
        pdf_template_version: null,
      }),
    };
    renderPage();
    expect(screen.getAllByText('not printed')).toHaveLength(3);
  });

  it('asks before deleting, then deletes and goes back to the list', async () => {
    mockQuery = { data: detail() };
    mockMutate.mockImplementation(
      (_id: string, opts: { onSuccess: () => void }) => opts.onSuccess()
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delete recording/ }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this ECG recording?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockMutate).toHaveBeenCalledWith(ID, expect.any(Object));
    await waitFor(() =>
      expect(screen.getByText('all recordings page')).toBeInTheDocument()
    );
  });

  it('deletes nothing when the dialog is cancelled', () => {
    mockQuery = { data: detail() };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delete recording/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('all recordings page')).toBeNull();
  });

  it('stays on the page and says so when the delete fails', async () => {
    mockQuery = { data: detail() };
    mockMutate.mockImplementation(
      (_id: string, opts: { onError: () => void }) => opts.onError()
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Delete recording/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Could not delete this recording.')
    ).toBeInTheDocument();
    expect(screen.queryByText('all recordings page')).toBeNull();
  });

  it('shows a plain not-found message with a link back on a 404', () => {
    mockQuery = { error: new HttpApiError('ECG recording not found', 404) };
    renderPage();
    expect(
      screen.getByText('This ECG recording was not found.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /All ECG recordings/ })
    ).toHaveAttribute('href', '/labs/ecg');
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('does not call another failure not found', () => {
    mockQuery = { error: new HttpApiError('boom', 500) };
    renderPage();
    expect(
      screen.getByText('Could not load this ECG recording.')
    ).toBeInTheDocument();
  });
});
