import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DataManagementSettings } from '@/pages/Settings/DataManagementSettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'Europe/London' }),
}));
const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
jest.mock('@/hooks/Diary/useFoodEntries', () => ({
  useDownloadDiaryExport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/Settings/useSyncedData', () => ({
  useSyncedSources: () => ({ data: [], isLoading: false }),
  useDeleteSyncedSource: () => ({ mutate: jest.fn(), isPending: false }),
}));
const mockExport = jest.fn();
jest.mock('@/hooks/Medications/useMedicationExports', () => ({
  useDownloadMedicationExport: () => ({ mutateAsync: mockExport }),
}));
const mockSave = jest.fn();
jest.mock('@/utils/saveBlob', () => ({
  saveBlobAs: (blob: Blob, name: string) => mockSave(blob, name),
}));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  mockExport.mockReset();
  mockSave.mockReset();
  mockToast.mockReset();
});
afterEach(() => jest.useRealTimers());

it.each([
  ['Export my doses (CSV)', 'doses', 'doses-2026-11-22.csv'],
  ['Export my lab results (CSV)', 'labs', 'lab-results-2026-11-22.csv'],
] as const)(
  '%s downloads the CSV under a dated name',
  async (label, kind, file) => {
    const blob = new Blob(['a,b\r\n']);
    mockExport.mockResolvedValue(blob);
    render(<DataManagementSettings />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(blob, file));
    expect(mockExport).toHaveBeenCalledWith(kind);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Export successful' })
    );
  }
);

it('says so and saves nothing when the download fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockExport.mockRejectedValue(new Error('network'));
  render(<DataManagementSettings />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Export my doses (CSV)' })
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    )
  );
  expect(mockSave).not.toHaveBeenCalled();
});

it('blocks a second download while one is being prepared', async () => {
  let release: (blob: Blob) => void = () => undefined;
  mockExport.mockReturnValue(
    new Promise<Blob>((resolve) => (release = resolve))
  );
  render(<DataManagementSettings />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Export my doses (CSV)' })
  );
  const labs = screen.getByRole('button', {
    name: 'Export my lab results (CSV)',
  });
  expect(labs).toBeDisabled();
  release(new Blob(['x']));
  await waitFor(() => expect(labs).toBeEnabled());
});
