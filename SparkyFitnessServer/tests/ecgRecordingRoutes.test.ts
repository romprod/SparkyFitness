import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const other = '00000000-0000-4000-a000-000000000002';
const recId = '00000000-0000-4000-a000-0000000000c1';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  importReports: vi.fn(),
  remove: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/ecgRecordingRepository.js', () => ({
  listEcgRecordings: mocks.list,
  getEcgRecording: mocks.get,
}));
vi.mock('../services/ecgRecordingService.js', () => ({
  importEcgReports: mocks.importReports,
  removeEcgRecording: mocks.remove,
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
import router from '../routes/v2/ecgRecordingRoutes.js';

const app = express();
app.use('/api/v2/ecg-recordings', router);
const path = '/api/v2/ecg-recordings';
const pdf = Buffer.from('%PDF-1.4\nhello\n%%EOF');
const summary = {
  id: recId,
  recorded_at: '2024-06-11T23:17:00.000Z',
  local_day: '2024-06-12',
  tz: 'Australia/Brisbane',
  result: 'Sinus Rhythm',
  avg_heart_rate_bpm: 61,
  symptoms: '--',
  interpretation: 'This ECG recording does not show signs of AFib.',
  lead_note: null,
  duration_sec: 30,
  paper_speed_mm_s: 25,
  gain_mm_mv: 10,
  sample_rate_hz: 512,
  device_model: null,
  device_software: null,
  pdf_template_version: '1.2.114',
  has_waveform: true,
  document_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([summary]);
  mocks.get.mockResolvedValue({ ...summary, waveform: null });
  mocks.importReports.mockImplementation(
    async (_owner: string, files: { originalname?: string }[]) =>
      files.map((f) => ({
        file: f.originalname,
        status: 'imported',
        message: 'Imported.',
      }))
  );
  mocks.remove.mockResolvedValue(undefined);
});

describe('access', () => {
  it('needs a signed-in user and check-in permission on every route', async () => {
    for (const call of [
      () => request(app).get(path),
      () => request(app).get(`${path}/${recId}`),
      () => request(app).post(`${path}/import`),
      () => request(app).delete(`${path}/${recId}`),
    ]) {
      expect((await call().set('x-test-auth', 'missing')).status).toBe(401);
      expect((await call().set('x-test-permission', 'denied')).status).toBe(
        403
      );
    }
    expect(mocks.permission).toHaveBeenCalledWith('checkin');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.importReports).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('reads and writes the target user the caregiver acts for, as the signed-in actor', async () => {
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    await request(app).get(`${path}/${recId}`).set('x-test-target', other);
    expect(mocks.get).toHaveBeenCalledWith(other, recId, owner);
    await request(app)
      .post(`${path}/import`)
      .set('x-test-target', other)
      .attach('files', pdf, 'a.pdf');
    expect(mocks.importReports.mock.calls[0]![0]).toBe(other);
    expect(mocks.importReports.mock.calls[0]![2]).toBe(owner);
    await request(app).delete(`${path}/${recId}`).set('x-test-target', other);
    expect(mocks.remove).toHaveBeenCalledWith(other, recId, owner);
  });

  it('refuses writes on the demo account', async () => {
    expect(
      (
        await request(app)
          .post(`${path}/import`)
          .set('x-test-demo', 'yes')
          .attach('files', pdf, 'a.pdf')
      ).status
    ).toBe(403);
    expect(
      (await request(app).delete(`${path}/${recId}`).set('x-test-demo', 'yes'))
        .status
    ).toBe(403);
    expect(mocks.importReports).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('lists the summaries', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ecg_recordings: [summary] });
    expect(JSON.stringify(response.body)).not.toContain('"waveform"');
  });

  it('answers one recording with its trace', async () => {
    const waveform = {
      drawnHz: 128,
      durationMs: 30000,
      strips: [{ t0Ms: 0, dtMs: 7.8, uv: [0, null, 12] }],
      points: 2,
      droppedStrips: 0,
    };
    mocks.get.mockResolvedValue({ ...summary, waveform, document_id: recId });
    const response = await request(app).get(`${path}/${recId}`);
    expect(response.status).toBe(200);
    expect(response.body.ecg_recording.waveform).toEqual(waveform);
    expect(response.body.ecg_recording.document_id).toBe(recId);
  });

  it('answers 404 for a recording that is not the user’s, and 400 for a bad id', async () => {
    mocks.get.mockResolvedValue(null);
    expect((await request(app).get(`${path}/${recId}`)).status).toBe(404);
    expect((await request(app).get(`${path}/nope`)).status).toBe(400);
  });
});

describe('importing', () => {
  it('reads each file and answers one outcome per file, in order', async () => {
    const response = await request(app)
      .post(`${path}/import`)
      .attach('files', pdf, 'one.pdf')
      .attach('files', pdf, 'two.pdf');
    expect(response.status).toBe(200);
    expect(response.body.outcomes.map((o: { file: string }) => o.file)).toEqual(
      ['one.pdf', 'two.pdf']
    );
    const files = mocks.importReports.mock.calls[0]![1] as {
      buffer: Buffer;
    }[];
    expect(files).toHaveLength(2);
    expect(Buffer.from(files[0]!.buffer)).toEqual(pdf);
  });

  it('passes through every outcome the service gives', async () => {
    const outcomes = [
      { file: 'a', status: 'imported', message: 'Imported.' },
      { file: 'b', status: 'updated', message: 'Refreshed.' },
      { file: 'c', status: 'duplicate', message: 'Already imported.' },
      { file: 'd', status: 'failed', message: 'This PDF could not be read.' },
    ];
    mocks.importReports.mockResolvedValue(outcomes);
    const response = await request(app)
      .post(`${path}/import`)
      .attach('files', pdf, 'a.pdf');
    expect(response.body).toEqual({ outcomes });
  });

  it('answers 400 for no file, or for a file under another field name', async () => {
    const none = await request(app).post(`${path}/import`);
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('Choose at least one ECG PDF.');
    const wrong = await request(app)
      .post(`${path}/import`)
      .attach('file', pdf, 'a.pdf');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('Choose at least one ECG PDF.');
    expect(mocks.importReports).not.toHaveBeenCalled();
  });

  it('takes 25 files and answers 400 for 26', async () => {
    let ok = request(app).post(`${path}/import`);
    for (let i = 0; i < 25; i++) ok = ok.attach('files', pdf, `r${i}.pdf`);
    expect((await ok).status).toBe(200);
    expect(mocks.importReports.mock.calls[0]![1]).toHaveLength(25);

    mocks.importReports.mockClear();
    let tooMany = request(app).post(`${path}/import`);
    for (let i = 0; i < 26; i++)
      tooMany = tooMany.attach('files', pdf, `r${i}.pdf`);
    const response = await tooMany;
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Import at most 25 reports at a time.');
    expect(mocks.importReports).not.toHaveBeenCalled();
  });

  it('answers 413 for a file over 10 MB and takes one of exactly 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    const refused = await request(app)
      .post(`${path}/import`)
      .attach('files', big, 'big.pdf');
    expect(refused.status).toBe(413);
    expect(refused.body.error).toContain('10 MB');
    expect(mocks.importReports).not.toHaveBeenCalled();

    const exact = await request(app)
      .post(`${path}/import`)
      .attach('files', Buffer.alloc(10 * 1024 * 1024), 'exact.pdf');
    expect(exact.status).toBe(200);
  });

  it('hands a service error to the error handler', async () => {
    mocks.importReports.mockRejectedValue(new Error('boom'));
    const failing = express();
    failing.use('/api/v2/ecg-recordings', router);
    failing.use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => void res.status(500).json({ error: error.message })
    );
    const response = await request(failing)
      .post(`${path}/import`)
      .attach('files', pdf, 'a.pdf');
    expect(response.status).toBe(500);
  });
});

describe('deleting', () => {
  it('answers 204, also for a recording already deleted', async () => {
    expect((await request(app).delete(`${path}/${recId}`)).status).toBe(204);
    expect((await request(app).delete(`${path}/${recId}`)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('answers 400 for a bad id', async () => {
    expect((await request(app).delete(`${path}/nope`)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
