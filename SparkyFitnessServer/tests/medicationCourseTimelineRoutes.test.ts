import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const ids = {
  owner: '00000000-0000-4000-a000-000000000001',
  delegate: '00000000-0000-4000-a000-000000000002',
  diary: '00000000-0000-4000-a000-000000000003',
  foreign: '00000000-0000-4000-a000-000000000004',
};
const mocks = vi.hoisted(() => ({ timeline: vi.fn(), detail: vi.fn() }));
vi.mock('../services/medicationCourseTimelineService.js', () => ({
  getMedicationCourseTimeline: mocks.timeline,
}));
vi.mock('../services/medicationCourseService.js', () => ({
  getMedicationCourse: mocks.detail,
}));
vi.mock('../services/medicationCourseCycleService.js', () => ({}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn(
    async (target: string, permission: string, actor: string) =>
      target === '00000000-0000-4000-a000-000000000001' &&
      ((actor === '00000000-0000-4000-a000-000000000002' &&
        ['reports', 'medications_read'].includes(permission)) ||
        (actor === '00000000-0000-4000-a000-000000000003' &&
          permission === 'diary'))
  ),
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (req.headers['x-test-auth'] === 'missing') {
      res.sendStatus(401);
      return;
    }
    if (req.headers['x-test-readonly'] === '1' && req.method !== 'GET') {
      res.sendStatus(403);
      return;
    }
    req.userId =
      typeof req.headers['x-test-actor'] === 'string'
        ? req.headers['x-test-actor']
        : '00000000-0000-4000-a000-000000000001';
    req.authenticatedUserId = req.userId;
    next();
  },
}));
import router from '../routes/v2/medicationCourseRoutes.js';
const app = express();
app.use(express.json());
app.use('/courses', router);
app.use(
  (
    error: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => res.status(error.statusCode ?? 500).json({ error: error.message })
);
describe('static read-only course timeline boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timeline.mockResolvedValue({ rows: [] });
  });
  it('resolves the static timeline before UUID details and retains private GET headers for owner/read-only callers', async () => {
    const result = await request(app)
      .get(`/courses/timeline?expected_owner_id=${ids.owner}`)
      .set('x-test-readonly', '1');
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(mocks.timeline).toHaveBeenCalledWith(ids.owner);
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('requires authentication and creates no timeline mutation endpoint', async () => {
    expect(
      (
        await request(app)
          .get('/courses/timeline')
          .set('x-test-auth', 'missing')
      ).status
    ).toBe(401);
    expect((await request(app).post('/courses/timeline').send({})).status).toBe(
      404
    );
    expect(mocks.timeline).not.toHaveBeenCalled();
  });
  it('allows an existing report/medication reader in the authorised profile and denies wrong-profile/domain access', async () => {
    expect(
      (
        await request(app)
          .get(`/courses/timeline?expected_owner_id=${ids.owner}`)
          .set('x-test-actor', ids.delegate)
          .set('x-on-behalf-of-user-id', ids.owner)
      ).status
    ).toBe(200);
    expect(mocks.timeline).toHaveBeenLastCalledWith(ids.owner);
    mocks.timeline.mockClear();
    expect(
      (
        await request(app)
          .get('/courses/timeline')
          .set('x-test-actor', ids.delegate)
          .set('x-on-behalf-of-user-id', ids.foreign)
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/courses/timeline')
          .set('x-test-actor', ids.diary)
          .set('x-on-behalf-of-user-id', ids.owner)
      ).status
    ).toBe(403);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });
  it('rejects a stale owner assertion and all date/range/as-of/filter controls before snapshot access', async () => {
    expect(
      (
        await request(app).get(
          `/courses/timeline?expected_owner_id=${ids.foreign}`
        )
      ).status
    ).toBe(409);
    for (const query of [
      'from=2026-01-01',
      'to=2026-12-31',
      'as_of=2026-11-01',
      'range=20',
      'medication_id=00000000-0000-4000-a000-000000000005',
      `expected_owner_id=${ids.owner}&expected_owner_id=${ids.foreign}`,
      'expected_owner_id=invalid',
    ])
      expect(
        (await request(app).get(`/courses/timeline?${query}`)).status
      ).toBe(400);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });
});
