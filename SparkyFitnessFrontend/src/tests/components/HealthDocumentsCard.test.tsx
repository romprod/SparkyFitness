import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { HealthDocument } from '@workspace/shared';
import HealthDocumentsCard from '@/pages/Labs/HealthDocumentsCard';
import LinkedDocuments from '@/pages/Labs/LinkedDocuments';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ formatDate: (day: string) => `UK:${day}` }),
}));
let mockDocs: { data?: HealthDocument[]; isError?: boolean } = {};
const mockUpload = jest.fn();
let mockUploading = false;
const mockRemove = jest.fn();
jest.mock('@/hooks/Labs/useHealthDocuments', () => ({
  useHealthDocuments: () => mockDocs,
  useUploadHealthDocumentMutation: () => ({
    mutateAsync: mockUpload,
    isPending: mockUploading,
  }),
  useDeleteHealthDocumentMutation: () => ({ mutate: mockRemove }),
  useOpenHealthDocumentMutation: () => ({
    mutateAsync: (doc: HealthDocument) => mockOpen(doc),
  }),
}));
jest.mock('@/hooks/Labs/useBodyCompScans', () => ({
  useBodyCompScans: () => ({
    data: [{ id: 'scan-1', scanned_day: '2026-08-10' }],
  }),
}));
jest.mock('@/hooks/Labs/useMetabolicTests', () => ({
  useMetabolicTests: () => ({
    data: [{ id: 'test-1', tested_day: '2026-10-05' }],
  }),
}));
const mockOpen = jest.fn();

const doc = (patch: Partial<HealthDocument> = {}): HealthDocument => ({
  id: '00000000-0000-4000-a000-0000000000d1',
  kind: 'lab_report',
  label: null,
  document_day: null,
  original_name: 'bloods.pdf',
  mime: 'application/pdf',
  size_bytes: 20_480,
  body_comp_scan_id: null,
  metabolic_test_id: null,
  uploaded_at: '2026-11-23T10:00:00.000Z',
  ...patch,
});
const file = (name: string, size = 100, type = 'application/pdf') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = (f: File) =>
  fireEvent.change(screen.getByLabelText(/^File/), { target: { files: [f] } });
const form = () => screen.getByRole('form', { name: 'Store a report' });

beforeEach(() => {
  mockDocs = { data: [] };
  mockUploading = false;
  mockUpload.mockReset().mockResolvedValue(doc());
  mockRemove.mockReset();
  mockOpen.mockReset().mockResolvedValue(undefined);
});

describe('stored originals card', () => {
  it('says nothing is stored yet and offers to store a report', () => {
    render(<HealthDocumentsCard />);
    expect(screen.getByText(/Nothing stored yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Store a report' }));
    expect(form()).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stored yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('says when the files could not be loaded', () => {
    mockDocs = { isError: true };
    render(<HealthDocumentsCard />);
    expect(
      screen.getByText('Could not load the stored files.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stored yet/)).not.toBeInTheDocument();
  });

  it('lists each file with what it is, its date, size and the record it is for', () => {
    mockDocs = {
      data: [
        doc({
          id: 'a',
          label: 'Nov scan',
          original_name: 'dexa.pdf',
          kind: 'dexa_report',
          document_day: '2026-08-10',
          size_bytes: 2_621_440,
          body_comp_scan_id: 'scan-1',
        }),
        doc({
          id: 'b',
          kind: 'rmr_report',
          metabolic_test_id: 'test-1',
          size_bytes: 500,
        }),
        doc({ id: 'c', original_name: 'loose.png', mime: 'image/png' }),
      ],
    };
    render(<HealthDocumentsCard />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Nov scan');
    expect(items[0]).toHaveTextContent(
      'DEXA report · UK:2026-08-10 · 2.5 MB · DEXA scan of UK:2026-08-10'
    );
    expect(items[0]).toHaveTextContent('dexa.pdf');
    expect(items[1]).toHaveTextContent('bloods.pdf');
    expect(items[1]).toHaveTextContent(
      'RMR report · 1 KB · RMR test of UK:2026-10-05'
    );
    expect(items[2]).toHaveTextContent('Lab report · 20 KB');
    expect(items[2]).not.toHaveTextContent('DEXA scan of');
  });

  describe('storing', () => {
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Store a report' }));
    const submit = () => fireEvent.submit(form());

    it('asks for a file, a PDF or image, and one that is not too large, before sending anything', async () => {
      render(<HealthDocumentsCard />);
      open();
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Choose a file to store.'
      );
      choose(file('run.exe'));
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Choose a PDF or an image'
      );
      choose(file('huge.pdf', 15 * 1024 * 1024 + 1));
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '15 MB at most'
      );
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('sends the file with what was said about it, and closes on success', async () => {
      render(<HealthDocumentsCard />);
      open();
      const f = file('bloods.pdf');
      choose(f);
      fireEvent.change(screen.getByLabelText('What it is'), {
        target: { value: 'prescription' },
      });
      fireEvent.change(screen.getByLabelText(/^Label/), {
        target: { value: '  Reta Rx  ' },
      });
      fireEvent.change(screen.getByLabelText(/^Report date/), {
        target: { value: '2026-11-02' },
      });
      submit();
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      expect(mockUpload).toHaveBeenCalledWith({
        file: f,
        fields: {
          kind: 'prescription',
          label: 'Reta Rx',
          document_day: '2026-11-02',
          body_comp_scan_id: '',
          metabolic_test_id: '',
        },
      });
      await waitFor(() =>
        expect(screen.queryByRole('form')).not.toBeInTheDocument()
      );
    });

    it('attaches to a scan or a test when one is chosen', async () => {
      render(<HealthDocumentsCard />);
      open();
      choose(file('dexa.pdf'));
      fireEvent.change(screen.getByLabelText(/^Attach to/), {
        target: { value: 'scan:scan-1' },
      });
      submit();
      await waitFor(() => expect(mockUpload).toHaveBeenCalled());
      expect(mockUpload.mock.calls[0]![0].fields).toMatchObject({
        body_comp_scan_id: 'scan-1',
        metabolic_test_id: '',
      });
      mockUpload.mockClear();
      open();
      choose(file('rmr.pdf'));
      fireEvent.change(screen.getByLabelText(/^Attach to/), {
        target: { value: 'test:test-1' },
      });
      submit();
      await waitFor(() => expect(mockUpload).toHaveBeenCalled());
      expect(mockUpload.mock.calls[0]![0].fields).toMatchObject({
        body_comp_scan_id: '',
        metabolic_test_id: 'test-1',
      });
    });

    it('lists the scans and tests it can be attached to by their dates', () => {
      render(<HealthDocumentsCard />);
      open();
      const options = Array.from(
        (screen.getByLabelText(/^Attach to/) as HTMLSelectElement).options
      ).map((o) => o.textContent);
      expect(options).toEqual([
        'No record',
        'DEXA scan of UK:2026-08-10',
        'RMR test of UK:2026-10-05',
      ]);
    });

    it('shows the server’s reason, such as a file already stored, and stays open', async () => {
      mockUpload.mockRejectedValueOnce(
        new Error('This file is already stored as Nov scan.')
      );
      render(<HealthDocumentsCard />);
      open();
      choose(file('bloods.pdf'));
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This file is already stored as Nov scan.'
      );
      expect(form()).toBeInTheDocument();
    });

    it('disables storing while it is being sent', () => {
      mockUploading = true;
      render(<HealthDocumentsCard />);
      open();
      expect(screen.getByRole('button', { name: 'Storing…' })).toBeDisabled();
    });
  });

  describe('opening and deleting', () => {
    beforeEach(() => {
      mockDocs = { data: [doc()] };
    });

    it('opens a file', () => {
      render(<HealthDocumentsCard />);
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(mockOpen).toHaveBeenCalledWith(doc());
    });

    it('says why a file could not be opened', async () => {
      mockOpen.mockRejectedValueOnce(new Error('Document not found'));
      render(<HealthDocumentsCard />);
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Document not found'
      );
    });

    it('deletes after confirming, and says why it could not', async () => {
      render(<HealthDocumentsCard />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete bloods.pdf' })
      );
      expect(screen.getByText('Delete this file?')).toBeInTheDocument();
      mockRemove.mockImplementation(
        (_id: string, options: { onError: (e: Error) => void }) =>
          options.onError(new Error('Not allowed'))
      );
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete',
        })
      );
      expect(mockRemove).toHaveBeenCalledWith(
        '00000000-0000-4000-a000-0000000000d1',
        expect.anything()
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
    });
  });
});

describe('originals tied to a record', () => {
  beforeEach(() => {
    mockDocs = {
      data: [
        doc({ id: 'a', label: 'Nov DEXA', body_comp_scan_id: 'scan-1' }),
        doc({ id: 'b', original_name: 'rmr.pdf', metabolic_test_id: 'test-1' }),
        doc({ id: 'c', original_name: 'loose.pdf' }),
      ],
    };
  });

  it('shows the originals of one scan, and opens them', () => {
    render(<LinkedDocuments bodyCompScanId="scan-1" />);
    expect(screen.getByText('Original report')).toBeInTheDocument();
    expect(screen.getByText('Nov DEXA')).toBeInTheDocument();
    expect(screen.queryByText('rmr.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('shows the originals of one RMR test', () => {
    render(<LinkedDocuments metabolicTestId="test-1" />);
    expect(screen.getByText('rmr.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Nov DEXA')).not.toBeInTheDocument();
  });

  it('shows nothing when there are none for the record, or no record is named', () => {
    const { container, rerender } = render(
      <LinkedDocuments bodyCompScanId="scan-9" />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<LinkedDocuments />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says why one could not be opened', async () => {
    mockOpen.mockRejectedValueOnce(new Error('Document not found'));
    render(<LinkedDocuments bodyCompScanId="scan-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Document not found'
    );
  });
});
