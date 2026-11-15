import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ data: vi.fn(), render: vi.fn() }));
vi.mock('../services/appointmentReportService.js', async (original) => ({
  ...(await original<
    typeof import('../services/appointmentReportService.js')
  >()),
  getAppointmentReportData: mocks.data,
}));
vi.mock('../services/appointmentReportPdf.js', () => ({
  renderAppointmentReportPdf: mocks.render,
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
    req.authenticatedUserId = '00000000-0000-4000-a000-000000000001';
    req.originalUserId = req.authenticatedUserId;
    req.userId = String(
      req.headers['x-test-target'] ?? req.authenticatedUserId
    );
    req.activeUserId = req.userId;
    req.apiKeyReadOnly = req.headers['x-test-readonly'] === '1';
    next();
  },
}));
import router from '../routes/v2/appointmentReportRoutes.js';
const app = express();
app.use(express.json());
app.use('/api/v2/reports', router);
const path = '/api/v2/reports/appointment.pdf';
const owner = '00000000-0000-4000-a000-000000000001',
  other = '00000000-0000-4000-a000-000000000002';
describe('appointment binary export route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data.mockResolvedValue({ range: { to: '2026-03-29' } });
    mocks.render.mockResolvedValue(Buffer.from('%PDF-1.7\nsynthetic'));
  });
  it.each([false, true])(
    'serves owner binary with private headers and readonly=%s',
    async (readonly) => {
      const r = await request(app)
        .get(path)
        .set('x-test-readonly', readonly ? '1' : '0')
        .query({
          from: '2026-03-29',
          to: '2026-03-29',
          timezone: 'Europe/London',
          expected_owner_id: owner,
        });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-disposition']).toBe(
        'attachment; filename="appointment-report-2026-03-29.pdf"'
      );
      expect(mocks.data).toHaveBeenCalledWith(
        owner,
        expect.objectContaining({ expected_owner_id: owner })
      );
    }
  );
  it('rejects unauthenticated', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it.each([
    { header: 'x-test-target', value: other },
    { header: 'x-on-behalf-of-user-id', value: other },
  ])(
    'rejects foreigncontext $header before reads',
    async ({ header, value }) => {
      expect((await request(app).get(path).set(header, value)).status).toBe(
        403
      );
      expect(mocks.data).not.toHaveBeenCalled();
    }
  );
  it.each([
    { expected_owner_id: other },
    { userId: [owner, other] },
    { targetUserId: other },
  ])('rejects foreignowner assertion %j', async (query) => {
    expect((await request(app).get(path).query(query)).status).toBe(403);
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it.each([
    { from: '2026-02-30' },
    { from: '2026-04-01', to: '2026-03-29' },
    { timezone: 'bad/zone' },
    { to: ['2026-01-01', '2026-02-01'] },
  ])('rejects invalid dates/timezone %j', async (query) => {
    expect((await request(app).get(path).query(query)).status).toBe(400);
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it('returns generic error without disclosing component data', async () => {
    mocks.render.mockRejectedValue(new Error('Synthetic private text'));
    const r = await request(app).get(path);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Unable to generate appointment report.' });
    expect(r.text).not.toContain('private');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
