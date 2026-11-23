import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  store: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/healthDocumentRepository.js', () => ({
  listHealthDocuments: mocks.list,
}));
vi.mock('../services/healthDocumentService.js', () => ({
  storeHealthDocument: mocks.store,
  openHealthDocument: mocks.open,
  removeHealthDocument: mocks.remove,
}));
vi.mock('../middleware/demoGuardMiddleware.js', () => ({
  demoGuard: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (req.headers['x-test-demo'] === 'yes') {
      res.status(403).json({ error: 'Not available in the demo' });
      return;
    }
    next();
  },
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (req.headers['x-test-auth'] === 'missing') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.authenticatedUserId = owner;
    req.userId = String(req.headers['x-test-target'] ?? owner);
    next();
  },
}));
vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  default: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default:
    (permission: string) =>
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      mocks.permission(permission);
      if (req.headers['x-test-permission'] === 'denied') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
}));
import router from '../routes/v2/healthDocumentRoutes.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const app = express();
app.use('/api/v2/health-documents', router);
// Mirror the app's error handler, which answers with the status an error carries.
app.use(
  (
    error: Error & { statusCode?: number; existing_id?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res
      .status(error.statusCode ?? 500)
      .json({ error: error.message, existing_id: error.existing_id });
  }
);
const path0 = '/api/v2/health-documents';
const docId = '00000000-0000-4000-a000-0000000000d1';
const stored = {
  id: docId,
  kind: 'lab_report',
  label: null,
  document_day: null,
  original_name: 'r.pdf',
  mime: 'application/pdf',
  size_bytes: 20,
  body_comp_scan_id: null,
  metabolic_test_id: null,
  uploaded_at: '2026-11-23T10:00:00.000Z',
};
const pdf = Buffer.from('%PDF-1.4\nhello\n%%EOF');

describe('stored originals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([stored]);
    mocks.store.mockResolvedValue(stored);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('lists the owner’s with the check-in permission', async () => {
    const response = await request(app).get(path0);
    expect(response.status).toBe(200);
    expect(response.body.health_documents).toEqual([stored]);
    expect(mocks.list).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('checkin');
  });

  describe('storing one', () => {
    const upload = (name = 'r.pdf', buffer: Buffer = pdf) =>
      request(app).post(path0).attach('file', buffer, name);

    it('stores the file with what was said about it, blank meaning not given', async () => {
      const response = await upload()
        .field('kind', 'dexa_report')
        .field('label', ' Nov scan ')
        .field('document_day', '2026-11-02')
        .field('body_comp_scan_id', '00000000-0000-4000-a000-0000000000e1')
        .field('metabolic_test_id', '');
      expect(response.status).toBe(201);
      expect(response.body).toEqual(stored);
      const [calledOwner, file, fields, calledActor] =
        mocks.store.mock.calls[0]!;
      expect(calledOwner).toBe(owner);
      expect(calledActor).toBe(owner);
      expect(file.originalname).toBe('r.pdf');
      expect(Buffer.from(file.buffer)).toEqual(pdf);
      expect(fields).toEqual({
        kind: 'dexa_report',
        label: 'Nov scan',
        document_day: '2026-11-02',
        body_comp_scan_id: '00000000-0000-4000-a000-0000000000e1',
        metabolic_test_id: null,
      });
    });

    it('answers 400 for no file, a bad kind, a bad date and two links, storing nothing', async () => {
      expect(
        (await request(app).post(path0).field('kind', 'other')).status
      ).toBe(400);
      for (const bad of [
        { kind: 'xray' },
        { kind: 'other', document_day: '2026-02-31' },
        { kind: 'other', body_comp_scan_id: 'nope' },
        {
          kind: 'other',
          body_comp_scan_id: '00000000-0000-4000-a000-0000000000e1',
          metabolic_test_id: '00000000-0000-4000-a000-0000000000e2',
        },
      ]) {
        let req = upload();
        for (const [k, v] of Object.entries(bad)) req = req.field(k, v);
        const response = await req;
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid request');
      }
      expect(mocks.store).not.toHaveBeenCalled();
    });

    it('refuses a file type it does not keep, and one that is too large, before the service sees it', async () => {
      const wrongType = await upload('run.exe').field('kind', 'other');
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error).toMatch(/PDF or an image/);
      const tooBig = await upload(
        'big.pdf',
        Buffer.alloc(15 * 1024 * 1024 + 1, 0x20)
      ).field('kind', 'other');
      expect(tooBig.status).toBe(413);
      expect(tooBig.body.error).toMatch(/15 MB/);
      expect(mocks.store).not.toHaveBeenCalled();
    });

    it('passes the service’s answers on: a file already stored, a record that is not found, a file of the wrong kind', async () => {
      mocks.store.mockRejectedValueOnce(
        Object.assign(new Error('This file is already stored as Nov scan.'), {
          statusCode: 409,
          existing_id: docId,
        })
      );
      const dup = await upload().field('kind', 'other');
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({
        error: 'This file is already stored as Nov scan.',
        existing_id: docId,
      });
      mocks.store.mockRejectedValueOnce(
        Object.assign(new Error('That scan was not found.'), {
          statusCode: 400,
        })
      );
      expect((await upload().field('kind', 'other')).status).toBe(400);
      mocks.store.mockRejectedValueOnce(
        Object.assign(
          new Error('Upload a PDF or an image (jpeg, png, webp or gif).'),
          {
            statusCode: 400,
          }
        )
      );
      expect(
        (await upload('r.pdf', Buffer.from('<script>')).field('kind', 'other'))
          .status
      ).toBe(400);
    });

    it('is closed in a demo', async () => {
      const response = await upload()
        .set('x-test-demo', 'yes')
        .field('kind', 'other');
      expect(response.status).toBe(403);
      expect(mocks.store).not.toHaveBeenCalled();
    });
  });

  describe('sending one back', () => {
    it('sends the file as stored with headers that keep a browser from running it', async () => {
      const file = path.join(os.tmpdir(), `doc-${Date.now()}.pdf`);
      fs.writeFileSync(file, pdf);
      mocks.open.mockResolvedValue({
        absolute: file,
        original_name: 'Röntgen "scan".pdf',
        mime: 'application/pdf',
      });
      const response = await request(app).get(`${path0}/${docId}/file`);
      fs.rmSync(file);
      expect(response.status).toBe(200);
      expect(Buffer.from(response.body)).toEqual(pdf);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['content-security-policy']).toContain('sandbox');
      const disposition = response.headers['content-disposition'];
      expect(disposition).toContain('inline; filename="R_ntgen _scan_.pdf"');
      expect(disposition).toContain(
        "filename*=UTF-8''R%C3%B6ntgen%20%22scan%22.pdf"
      );
      expect(mocks.open).toHaveBeenCalledWith(owner, docId, owner);
    });

    it('answers 404 for one that is not there or not the owner’s, and 400 for a bad id', async () => {
      mocks.open.mockResolvedValue(null);
      expect((await request(app).get(`${path0}/${docId}/file`)).status).toBe(
        404
      );
      expect((await request(app).get(`${path0}/nope/file`)).status).toBe(400);
    });
  });

  it('deletes one, and treats one already gone as deleted', async () => {
    expect((await request(app).delete(`${path0}/${docId}`)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith(owner, docId, owner);
    expect((await request(app).delete(`${path0}/${docId}`)).status).toBe(204);
    expect((await request(app).delete(`${path0}/nope`)).status).toBe(400);
    expect(
      (await request(app).delete(`${path0}/${docId}`).set('x-test-demo', 'yes'))
        .status
    ).toBe(403);
  });

  it('acts for the profile being managed, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path0).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    mocks.open.mockResolvedValue(null);
    await request(app)
      .get(`${path0}/${docId}/file`)
      .set('x-test-target', other);
    expect(mocks.open).toHaveBeenCalledWith(other, docId, owner);
  });

  it('is closed to the signed-out and to people without check-in access', async () => {
    for (const req of [
      () => request(app).get(path0),
      () => request(app).get(`${path0}/${docId}/file`),
      () => request(app).delete(`${path0}/${docId}`),
      () =>
        request(app)
          .post(path0)
          .attach('file', pdf, 'r.pdf')
          .field('kind', 'other'),
    ]) {
      expect((await req().set('x-test-auth', 'missing')).status).toBe(401);
      expect((await req().set('x-test-permission', 'denied')).status).toBe(403);
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
