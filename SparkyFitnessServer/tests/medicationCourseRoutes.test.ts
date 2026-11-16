import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  courseFixtureIds as id,
  medicationCoursePlanFixture,
} from './fixtures/medicationCourseFixture.js';
const mocks = vi.hoisted(() => ({
  listMedicationCourses: vi.fn(),
  getMedicationCourseDue: vi.fn(),
  listCourseHandoffRules: vi.fn(),
  reviewMedicationCourseCreate: vi.fn(),
  createMedicationCourse: vi.fn(),
  getMedicationCourseHistory: vi.fn(),
  getMedicationCourse: vi.fn(),
  reviewMedicationCourse: vi.fn(),
  reviseMedicationCourse: vi.fn(),
  editMedicationCourse: vi.fn(),
  setMedicationCourseStatus: vi.fn(),
  deleteMedicationCourseRevision: vi.fn(),
}));
vi.mock('../services/medicationCourseService.js', () => mocks);
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
    if (req.headers['x-test-readonly'] === '1' && req.method !== 'GET') {
      res.status(403).json({ error: 'This API key is read-only.' });
      return;
    }
    req.userId = '00000000-0000-4000-a000-000000000001';
    req.authenticatedUserId = req.headers['x-test-permission']
      ? '00000000-0000-4000-a000-000000000099'
      : req.userId;
    req.originalUserId = req.authenticatedUserId;
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
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn(
    async (_owner: string, permission: string) =>
      permission === 'medications_read'
  ),
}));
import router from '../routes/v2/medicationCourseRoutes.js';
const app = express();
app.use(express.json());
app.use('/api/v2/medication-courses', router);
app.use(
  (
    error: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => res.status(error.statusCode ?? 500).json({ error: error.message })
);
const path = '/api/v2/medication-courses';
const receipt = {
  course_id: id.course,
  revision_id: id.revision,
  version: 1,
  operation_id: id.activity,
};
describe('managed course route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mocks)) fn.mockResolvedValue(receipt);
  });
  it('allows medication/report readers to read existing facts but rejects their management actions', async () => {
    mocks.listMedicationCourses.mockResolvedValue({
      courses: [],
      today: '2026-11-16',
      timezone: 'UTC',
    });
    expect(
      (await request(app).get(path).set('x-test-permission', 'reports')).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`${path}/${id.course}/status`)
          .set('x-test-permission', 'reports')
          .send({
            status: 'paused',
            expected_version: 1,
            operation_id: id.activity,
          })
      ).status
    ).toBe(403);
    expect(mocks.setMedicationCourseStatus).not.toHaveBeenCalled();
  });
  it('preserves owner readonly GET and rejects readonly review/mutations and unauthenticated requests', async () => {
    expect(
      (
        await request(app)
          .get(`${path}/${id.course}`)
          .set('x-test-readonly', '1')
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`${path}/${id.course}/review`)
          .set('x-test-readonly', '1')
          .send({ ...medicationCoursePlanFixture(), expected_version: 1 })
      ).status
    ).toBe(403);
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
  });
  it('dispatches create/review/revise with canonical operation/version contracts and returns receipt JSON on deletion', async () => {
    const authored = medicationCoursePlanFixture();
    const created = await request(app)
      .post(path)
      .send({
        ...authored,
        medication_id: id.medication,
        operation_id: id.activity,
        expected_version: 0,
        native_reminder_limitation_acknowledged: false,
      });
    expect(created.status).toBe(201);
    expect(created.body).toEqual(receipt);
    const review = await request(app)
      .post(`${path}/${id.course}/review`)
      .send({ ...authored, expected_version: 1 });
    expect(review.status).toBe(200);
    expect(mocks.reviewMedicationCourse).toHaveBeenCalledWith(
      id.owner,
      id.course,
      expect.objectContaining({ expected_version: 1 })
    );
    const deleted = await request(app)
      .delete(`${path}/${id.course}/revisions/${id.revision}`)
      .send({ operation_id: id.activity, expected_version: 1 });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual(receipt);
    expect(mocks.deleteMedicationCourseRevision).toHaveBeenCalledWith(
      id.owner,
      id.course,
      id.revision,
      { operation_id: id.activity, expected_version: 1 }
    );
  });
  it('requires explicit reviewed/acknowledged handoff, operation IDs and valid dates before any mutation', async () => {
    const plan = medicationCoursePlanFixture();
    expect(
      (
        await request(app)
          .post(path)
          .send({
            ...plan,
            medication_id: id.medication,
            operation_id: id.activity,
            expected_version: 0,
            native_reminder_limitation_acknowledged: false,
            handoff: {
              cutover_day: '2026-11-16',
              selected_rules: [{ schedule_id: id.rule, fingerprint: 'saved' }],
            },
          })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${path}/${id.course}/status`)
          .send({ status: 'paused', expected_version: 1 })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`${path}/${id.course}/history`)
          .query({ from: '2026-02-30' })
      ).status
    ).toBe(400);
    expect(mocks.createMedicationCourse).not.toHaveBeenCalled();
    expect(mocks.setMedicationCourseStatus).not.toHaveBeenCalled();
  });
  it('passes an unbounded explicit history request to service defaults and surfaces stale409 without retry', async () => {
    expect(
      (await request(app).get(`${path}/${id.course}/history`)).status
    ).toBe(200);
    expect(mocks.getMedicationCourseHistory).toHaveBeenCalledWith(
      id.owner,
      id.course,
      undefined,
      undefined
    );
    mocks.reviseMedicationCourse.mockRejectedValue(
      Object.assign(new Error('Review changed'), { statusCode: 409 })
    );
    const response = await request(app)
      .post(`${path}/${id.course}/revise`)
      .send({
        ...medicationCoursePlanFixture(),
        start_date: '2026-11-10',
        operation_id: id.activity,
        expected_version: 1,
        review_fingerprint: 'reviewed',
      });
    expect(response.status).toBe(409);
    expect(mocks.reviseMedicationCourse).toHaveBeenCalledOnce();
  });
});
