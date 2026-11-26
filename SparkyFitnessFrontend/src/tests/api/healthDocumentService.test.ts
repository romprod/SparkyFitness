import type { HealthDocument } from '@workspace/shared';
import {
  deleteHealthDocument,
  listHealthDocuments,
  openHealthDocument,
  uploadHealthDocument,
} from '@/api/Labs/healthDocumentService';

const mockApi = jest.fn();
jest.mock('@/api/api', () => ({
  apiCall: (path: string, options?: unknown) => mockApi(path, options),
}));
const mockSave = jest.fn();
jest.mock('@/utils/saveBlob', () => ({
  saveBlobAs: (blob: Blob, name: string) => mockSave(blob, name),
}));

const doc: HealthDocument = {
  id: '00000000-0000-4000-a000-0000000000d1',
  kind: 'lab_report',
  label: null,
  document_day: null,
  original_name: 'bloods.pdf',
  mime: 'application/pdf',
  size_bytes: 20,
  body_comp_scan_id: null,
  metabolic_test_id: null,
  ecg_recording_id: null,
  uploaded_at: '2026-11-23T10:00:00.000Z',
};

beforeEach(() => {
  mockApi.mockReset();
  mockSave.mockReset();
  URL.createObjectURL = jest.fn(() => 'blob:copy');
  URL.revokeObjectURL = jest.fn();
});

describe('the stored originals API', () => {
  it('lists with no error toast, and reads the answer against the schema', async () => {
    mockApi.mockResolvedValue({ health_documents: [doc] });
    expect((await listHealthDocuments()).health_documents).toEqual([doc]);
    expect(mockApi).toHaveBeenCalledWith(
      '/v2/health-documents',
      expect.objectContaining({ method: 'GET', suppressErrorToast: true })
    );
    mockApi.mockResolvedValue({ health_documents: [{ ...doc, kind: 'xray' }] });
    await expect(listHealthDocuments()).rejects.toThrow();
  });

  it('uploads the file and its fields as a form, not JSON', async () => {
    mockApi.mockResolvedValue(doc);
    const file = new File(['%PDF-'], 'bloods.pdf', { type: 'application/pdf' });
    expect(
      await uploadHealthDocument(file, { kind: 'lab_report', label: 'Nov' })
    ).toEqual(doc);
    const [path, options] = mockApi.mock.calls[0]!;
    expect(path).toBe('/v2/health-documents');
    expect(options).toMatchObject({
      method: 'POST',
      isFormData: true,
      suppressErrorToast: true,
    });
    const form = options.body as FormData;
    expect(form.get('kind')).toBe('lab_report');
    expect(form.get('label')).toBe('Nov');
    expect((form.get('file') as File).name).toBe('bloods.pdf');
  });

  it('deletes by id', async () => {
    mockApi.mockResolvedValue(undefined);
    await deleteHealthDocument(doc.id);
    expect(mockApi).toHaveBeenCalledWith(
      `/v2/health-documents/${doc.id}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('opening an original', () => {
  const blob = new Blob(['%PDF-']);

  it('opens the tab first and points it at a local copy of the file, then lets the copy go', async () => {
    jest.useFakeTimers();
    const tab = {
      opener: {} as unknown,
      location: { href: '' },
      close: jest.fn(),
    };
    const open = jest
      .spyOn(window, 'open')
      .mockReturnValue(tab as unknown as Window);
    mockApi.mockResolvedValue(blob);
    await openHealthDocument(doc);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(mockApi).toHaveBeenCalledWith(
      `/v2/health-documents/${doc.id}/file`,
      expect.objectContaining({
        responseType: 'blob',
        suppressErrorToast: true,
      })
    );
    expect(tab.location.href).toBe('blob:copy');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:copy');
    expect(mockSave).not.toHaveBeenCalled();
    open.mockRestore();
    jest.useRealTimers();
  });

  it('offers a download when the browser blocks the tab', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    mockApi.mockResolvedValue(blob);
    await openHealthDocument(doc);
    expect(mockSave).toHaveBeenCalledWith(blob, 'bloods.pdf');
    open.mockRestore();
  });

  it('closes the tab it opened when the file cannot be fetched, and says why', async () => {
    const tab = {
      opener: {} as unknown,
      location: { href: '' },
      close: jest.fn(),
    };
    const open = jest
      .spyOn(window, 'open')
      .mockReturnValue(tab as unknown as Window);
    mockApi.mockRejectedValue(new Error('Document not found'));
    await expect(openHealthDocument(doc)).rejects.toThrow('Document not found');
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
    open.mockRestore();
  });
});
