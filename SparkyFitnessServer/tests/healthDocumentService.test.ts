import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const uploads = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'health-docs-')) as string;
  process.env.SPARKY_FITNESS_CUSTOM_UPLOADS_DIRECTORY = dir;
  return dir;
});
const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  file: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../models/healthDocumentRepository.js', () => ({
  insertHealthDocument: mocks.insert,
  getHealthDocumentFile: mocks.file,
  deleteHealthDocument: mocks.remove,
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
import {
  cleanDocumentName,
  openHealthDocument,
  removeHealthDocument,
  storeHealthDocument,
} from '../services/healthDocumentService.js';

const owner = '00000000-0000-4000-a000-000000000001';
const fields = {
  kind: 'lab_report' as const,
  label: null,
  document_day: null,
  body_comp_scan_id: null,
  metabolic_test_id: null,
  ecg_recording_id: null,
};
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const folder = () => path.join(uploads, 'health-documents', owner);

afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));
beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(uploads, 'health-documents'), {
    recursive: true,
    force: true,
  });
  mocks.insert.mockImplementation(
    async (_owner: string, doc: { id: string }) => ({
      id: doc.id,
    })
  );
});

describe('keeping an upload', () => {
  it('writes the file under the owner’s folder and records its real type, size and checksum', async () => {
    const buffer = pdf('report');
    const stored = await storeHealthDocument(
      owner,
      { buffer, originalname: 'Lab Report.pdf' },
      fields,
      owner
    );
    const [calledOwner, doc, calledActor] = mocks.insert.mock.calls[0]!;
    expect(calledOwner).toBe(owner);
    expect(calledActor).toBe(owner);
    expect(doc).toMatchObject({
      id: stored.id,
      original_name: 'Lab Report.pdf',
      mime: 'application/pdf',
      size_bytes: buffer.length,
      fields,
    });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.file_path).toBe(
      `uploads/health-documents/${owner}/${stored.id}.pdf`
    );
    expect(fs.readFileSync(path.join(folder(), `${stored.id}.pdf`))).toEqual(
      buffer
    );
    // Nothing is left beside it.
    expect(fs.readdirSync(folder())).toEqual([`${stored.id}.pdf`]);
  });

  it('refuses a file that is not a PDF or an image, writing nothing', async () => {
    await expect(
      storeHealthDocument(
        owner,
        { buffer: Buffer.from('<script>'), originalname: 'x.pdf' },
        fields
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(fs.existsSync(folder())).toBe(false);
  });

  it('removes the file it wrote when the record cannot be saved, whatever the reason', async () => {
    mocks.insert.mockRejectedValueOnce(
      Object.assign(new Error('This file is already stored.'), {
        statusCode: 409,
      })
    );
    await expect(
      storeHealthDocument(
        owner,
        { buffer: pdf('a'), originalname: 'a.pdf' },
        fields
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fs.readdirSync(folder())).toEqual([]);
    mocks.insert.mockRejectedValueOnce(new Error('database down'));
    await expect(
      storeHealthDocument(
        owner,
        { buffer: pdf('b'), originalname: 'b.pdf' },
        fields
      )
    ).rejects.toThrow('database down');
    expect(fs.readdirSync(folder())).toEqual([]);
  });

  it('keeps nothing of the client’s path or control characters in the stored name', () => {
    expect(cleanDocumentName('../../etc/passwd.pdf', 'pdf')).toBe('passwd.pdf');
    expect(cleanDocumentName('C:\\Users\\me\\scan.png', 'png')).toBe(
      'scan.png'
    );
    expect(cleanDocumentName('a\u0000b\nc.pdf', 'pdf')).toBe('abc.pdf');
    expect(cleanDocumentName('   ', 'pdf')).toBe('document.pdf');
    expect(cleanDocumentName(undefined, 'jpg')).toBe('document.jpg');
    expect(cleanDocumentName('x'.repeat(300) + '.pdf', 'pdf')).toHaveLength(
      200
    );
  });
});

describe('sending one back', () => {
  const store = async () => {
    const stored = await storeHealthDocument(
      owner,
      { buffer: pdf('open me'), originalname: 'r.pdf' },
      fields
    );
    const filePath = mocks.insert.mock.calls.at(-1)![1].file_path as string;
    return { id: stored.id, filePath };
  };

  it('finds the file of a document that is the owner’s', async () => {
    const { filePath } = await store();
    mocks.file.mockResolvedValue({
      file_path: filePath,
      original_name: 'r.pdf',
      mime: 'application/pdf',
    });
    const found = await openHealthDocument(owner, 'id', owner);
    expect(found).toMatchObject({
      original_name: 'r.pdf',
      mime: 'application/pdf',
    });
    expect(fs.readFileSync(found!.absolute).toString()).toContain('open me');
  });

  it('finds nothing for an unknown document, a missing file or a path that leaves the uploads folder', async () => {
    mocks.file.mockResolvedValueOnce(null);
    expect(await openHealthDocument(owner, 'id')).toBeNull();
    mocks.file.mockResolvedValueOnce({
      file_path: `uploads/health-documents/${owner}/gone.pdf`,
      original_name: 'g.pdf',
      mime: 'application/pdf',
    });
    expect(await openHealthDocument(owner, 'id')).toBeNull();
    mocks.file.mockResolvedValueOnce({
      file_path: 'uploads/../../etc/passwd',
      original_name: 'p',
      mime: 'application/pdf',
    });
    expect(await openHealthDocument(owner, 'id')).toBeNull();
  });
});

describe('deleting one', () => {
  it('removes the record and its file, and treats one already gone as deleted', async () => {
    await storeHealthDocument(
      owner,
      { buffer: pdf('x'), originalname: 'x.pdf' },
      fields
    );
    const filePath = mocks.insert.mock.calls[0]![1].file_path as string;
    const absolute = path.join(uploads, ...filePath.split('/').slice(1));
    expect(fs.existsSync(absolute)).toBe(true);
    mocks.remove.mockResolvedValueOnce(filePath);
    await removeHealthDocument(owner, 'id', owner);
    expect(mocks.remove).toHaveBeenCalledWith(owner, 'id', owner);
    expect(fs.existsSync(absolute)).toBe(false);
    mocks.remove.mockResolvedValueOnce(null);
    await expect(removeHealthDocument(owner, 'id')).resolves.toBeUndefined();
  });

  it('never deletes a file outside the uploads folder, even if the record says to', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'keep');
    mocks.remove.mockResolvedValueOnce(`uploads/../../../..${outside}`);
    await removeHealthDocument(owner, 'id');
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside);
  });
});
