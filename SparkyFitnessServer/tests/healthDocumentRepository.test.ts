import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  adoptHealthDocumentForEcg,
  deleteHealthDocument,
  getHealthDocumentFile,
  insertHealthDocument,
  listHealthDocuments,
} from '../models/healthDocumentRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const scan = '00000000-0000-4000-a000-0000000000e1';
const test = '00000000-0000-4000-a000-0000000000e2';
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });
const fields = (patch: Record<string, unknown> = {}) => ({
  kind: 'dexa_report' as const,
  label: 'Nov scan',
  document_day: '2026-11-02',
  body_comp_scan_id: null,
  metabolic_test_id: null,
  ecg_recording_id: null,
  ...patch,
});
const doc = (patch: Record<string, unknown> = {}) => ({
  id: 'd1',
  fields: fields(),
  original_name: 'r.pdf',
  mime: 'application/pdf' as const,
  size_bytes: 20,
  sha256: 'a'.repeat(64),
  file_path: 'uploads/health-documents/u/d1.pdf',
  ...patch,
});
const stored = {
  id: 'd1',
  kind: 'dexa_report',
  label: 'Nov scan',
  document_day: '2026-11-02',
  original_name: 'r.pdf',
  mime: 'application/pdf',
  size_bytes: '20',
  body_comp_scan_id: null,
  metabolic_test_id: null,
  ecg_recording_id: null,
  created_at: new Date('2026-11-23T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('listing', () => {
  it('reads only the owner’s, newest first, with numbers as numbers and times as ISO', async () => {
    mocks.query.mockResolvedValueOnce(rows([stored]));
    const [first] = await listHealthDocuments(owner, owner);
    expect(first).toEqual({
      id: 'd1',
      kind: 'dexa_report',
      label: 'Nov scan',
      document_day: '2026-11-02',
      original_name: 'r.pdf',
      mime: 'application/pdf',
      size_bytes: 20,
      body_comp_scan_id: null,
      metabolic_test_id: null,
      ecg_recording_id: null,
      uploaded_at: '2026-11-23T10:00:00.000Z',
    });
    const [text, params] = mocks.query.mock.calls[0]!;
    expect(String(text)).toContain('WHERE user_id = $1');
    expect(String(text)).toContain('ORDER BY created_at DESC');
    expect(String(text)).not.toContain('file_path');
    expect(params).toEqual([owner]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('recording', () => {
  it('writes the document for the owner and answers what was stored', async () => {
    mocks.query.mockResolvedValueOnce(rows([stored]));
    const out = await insertHealthDocument(owner, doc());
    expect(out.id).toBe('d1');
    const params = mocks.query.mock.calls[0]![1] as unknown[];
    expect(params.slice(0, 3)).toEqual(['d1', owner, 'dexa_report']);
    expect(params).toContain('uploads/health-documents/u/d1.pdf');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('checks a linked scan or test is the owner’s first, answering 400 when it is not', async () => {
    mocks.query.mockResolvedValueOnce(rows());
    await expect(
      insertHealthDocument(
        owner,
        doc({ fields: fields({ body_comp_scan_id: scan }) })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'That scan was not found.',
    });
    expect(String(mocks.query.mock.calls[0]![0])).toContain('body_comp_scans');
    expect(mocks.query.mock.calls[0]![1]).toEqual([scan, owner]);
    mocks.query.mockResolvedValueOnce(rows());
    await expect(
      insertHealthDocument(
        owner,
        doc({ fields: fields({ metabolic_test_id: test }) })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'That test was not found.',
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('checks a linked ECG recording is the owner’s, and ties an unlinked stored document to one', async () => {
    const recording = '00000000-0000-4000-a000-0000000000e3';
    mocks.query.mockResolvedValueOnce(rows());
    await expect(
      insertHealthDocument(
        owner,
        doc({ fields: fields({ ecg_recording_id: recording }) })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'That recording was not found.',
    });
    expect(String(mocks.query.mock.calls[0]![0])).toContain('ecg_recordings');
    expect(mocks.query.mock.calls[0]![1]).toEqual([recording, owner]);

    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(
      await adoptHealthDocumentForEcg(owner, 'd1', recording, '2026-11-02')
    ).toBe(true);
    const [text, params] = mocks.query.mock.calls[1]!;
    expect(String(text)).toContain('ecg_recording_id IS NULL');
    expect(String(text)).toContain('body_comp_scan_id IS NULL');
    expect(params).toEqual(['d1', owner, recording, '2026-11-02']);
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(
      await adoptHealthDocumentForEcg(owner, 'd2', recording, '2026-11-02')
    ).toBe(false);
  });

  it('records a document tied to a scan that is the owner’s', async () => {
    mocks.query
      .mockResolvedValueOnce(rows([{ ok: 1 }]))
      .mockResolvedValueOnce(rows([{ ...stored, body_comp_scan_id: scan }]));
    const out = await insertHealthDocument(
      owner,
      doc({ fields: fields({ body_comp_scan_id: scan }) })
    );
    expect(out.body_comp_scan_id).toBe(scan);
  });

  it('answers 409 naming the one already stored when the same file is sent twice', async () => {
    mocks.query
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' })
      )
      .mockResolvedValueOnce(
        rows([{ id: 'old', label: 'Nov scan', original_name: 'first.pdf' }])
      );
    const error = await insertHealthDocument(owner, doc()).then(
      () => null,
      (e) => e
    );
    expect(error).toMatchObject({
      statusCode: 409,
      message: 'This file is already stored as Nov scan.',
      existing_id: 'old',
    });
    expect(mocks.query.mock.calls[1]![1]).toEqual([owner, 'a'.repeat(64)]);
  });

  it('names the file when the one stored has no label, and leaves every other failure alone', async () => {
    mocks.query
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
      .mockResolvedValueOnce(
        rows([{ id: 'old', label: null, original_name: 'first.pdf' }])
      );
    await expect(insertHealthDocument(owner, doc())).rejects.toMatchObject({
      message: 'This file is already stored as first.pdf.',
    });
    const boom = new Error('connection lost');
    mocks.query.mockRejectedValueOnce(boom);
    await expect(insertHealthDocument(owner, doc())).rejects.toBe(boom);
  });
});

describe('reading and deleting', () => {
  it('finds the file details of the owner’s document only', async () => {
    mocks.query.mockResolvedValueOnce(
      rows([
        {
          file_path: 'uploads/x.pdf',
          original_name: 'x.pdf',
          mime: 'application/pdf',
        },
      ])
    );
    expect(await getHealthDocumentFile(owner, 'd1', owner)).toEqual({
      file_path: 'uploads/x.pdf',
      original_name: 'x.pdf',
      mime: 'application/pdf',
    });
    expect(mocks.query.mock.calls[0]![1]).toEqual(['d1', owner]);
    mocks.query.mockResolvedValueOnce(rows());
    expect(await getHealthDocumentFile(owner, 'd2')).toBeNull();
  });

  it('deletes by owner and id and says where the file was, or null', async () => {
    mocks.query.mockResolvedValueOnce(rows([{ file_path: 'uploads/x.pdf' }]));
    expect(await deleteHealthDocument(owner, 'd1', owner)).toBe(
      'uploads/x.pdf'
    );
    expect(mocks.query.mock.calls[0]![1]).toEqual(['d1', owner]);
    mocks.query.mockResolvedValueOnce(rows());
    expect(await deleteHealthDocument(owner, 'd1')).toBeNull();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
