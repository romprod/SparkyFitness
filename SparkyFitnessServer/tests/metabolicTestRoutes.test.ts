import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const testId = '00000000-0000-4000-a000-0000000000b1';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/metabolicTestRepository.js', () => ({
  listMetabolicTests: mocks.list,
  createMetabolicTest: mocks.create,
  deleteMetabolicTest: mocks.remove,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'Europe/London'),
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
import router from '../routes/v2/metabolicTestRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/metabolic-tests', router);
const path = '/api/v2/metabolic-tests';
const body = {
  tested_day: '2026-10-05',
  method: 'ic_vo2_only',
  measured_rmr_kcal: 1950,
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  weight_kg: 92,
};
const stored = {
  id: testId,
  tested_day: '2026-10-05',
  method: 'ic_vo2_only',
  device_label: null,
  facility: null,
  measured_rmr_kcal: 1950,
  kcal_per_litre_o2: 4.81,
  vo2_ml_min: null,
  vco2_ml_min: null,
  rq: null,
  duration_min: null,
  steady_state_cv_pct: null,
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  weight_kg: 92,
  fat_free_mass_kg: null,
  reported_predicted_kcal: null,
  reported_prediction_equation: null,
  reported_activity_factor: null,
  reported_activity_label: null,
  prep: {
    fasted: true,
    fasting_hours: 12,
    no_caffeine: null,
    no_training_prior_day: null,
    active_travel: null,
    rested: null,
    rest_min_before_test: null,
    illness_free_14d: null,
    awake_quiet: null,
  },
  room_temp_c: null,
  notes: 'private note',
};

describe('measured RMR tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([stored]);
    mocks.create.mockResolvedValue(testId);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('lists the owner’s tests with the check-in permission, as lab results do', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body.metabolic_tests).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('checkin');
  });

  it('adds a test, filling what was left out with not recorded', async () => {
    const response = await request(app).post(path).send(body);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: testId });
    const saved = mocks.create.mock.calls[0]?.[1];
    expect(saved).toMatchObject({
      tested_day: '2026-10-05',
      measured_rmr_kcal: 1950,
      kcal_per_litre_o2: null,
      fat_free_mass_kg: null,
    });
    expect(saved.prep.fasted).toBeNull();
    expect(mocks.create.mock.calls[0]?.[2]).toBe(owner);
  });

  it('refuses a test that cannot be right, writing nothing', async () => {
    for (const bad of [
      {},
      { ...body, measured_rmr_kcal: 0 },
      { ...body, tested_day: '2026-02-31' },
      { ...body, sex: 'other' },
      { ...body, fat_free_mass_kg: 100 },
    ]) {
      const response = await request(app).post(path).send(bad);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('deletes a test, and treats one already gone as deleted', async () => {
    expect((await request(app).delete(`${path}/${testId}`)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith(owner, testId, owner);
    expect((await request(app).delete(`${path}/not-an-id`)).status).toBe(400);
  });

  it('downloads the tests as a private CSV that leaves the notes out', async () => {
    const response = await request(app).get(`${path}/export`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="rmr-tests-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const [header, first] = response.text.split('\r\n');
    expect(header?.startsWith('tested_day,method,device,facility,')).toBe(true);
    expect(first).toContain('2026-10-05,ic_vo2_only,,,1950,4.81');
    expect(first).toContain(',true,12,');
    expect(response.text).not.toContain('private note');
  });

  it('acts for the profile being managed, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    await request(app).post(path).set('x-test-target', other).send(body);
    expect(mocks.create).toHaveBeenCalledWith(other, expect.anything(), owner);
  });

  it('is closed to the signed-out and to people without check-in access', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get(`${path}/export`)
          .set('x-test-permission', 'denied')
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(path)
          .set('x-test-permission', 'denied')
          .send(body)
      ).status
    ).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
