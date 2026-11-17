import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  forecast: vi.fn(),
  dashboard: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../services/medicationInventoryForecastService.js', () => ({
  getMedicationInventoryForecast: mocks.forecast,
}));
vi.mock('../services/medicationInventoryDashboardService.js', () => ({
  getMedicationInventoryDashboard: mocks.dashboard,
}));
vi.mock('../services/medicationReorderService.js', () => ({
  getMedicationReorderDefaults: mocks.get,
  saveMedicationReorderDefaults: mocks.save,
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
    req.userId = '00000000-0000-4000-a000-000000000001';
    req.authenticatedUserId = req.userId;
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
  canAccessUserData: vi.fn(async () => false),
}));
import {
  medicationInventoryRoutes,
  medicationReorderRoutes,
} from '../routes/v2/medicationInventoryRoutes.js';
const app = express();
app.use(express.json());
app.use('/inventory', medicationInventoryRoutes);
app.use('/preferences', medicationReorderRoutes);
app.use(
  (
    error: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => res.status(error.statusCode ?? 500).json({ error: error.message })
);
describe('inventory forecast and reorder request boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forecast.mockResolvedValue({ medications: [] });
    mocks.dashboard.mockResolvedValue({ preparation_queue: [] });
    mocks.get.mockResolvedValue({ lead_days: 14, buffer_days: 3 });
    mocks.save.mockImplementation(async (_owner, input) => input);
  });
  it('requires auth and allows existing read-only API-key GET but blocks settings PUT', async () => {
    expect(
      (
        await request(app)
          .get('/inventory/forecast')
          .set('x-test-auth', 'missing')
      ).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/inventory/forecast')
          .set('x-test-readonly', '1')
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .put('/preferences/medication-reorder')
          .set('x-test-readonly', '1')
          .send({ lead_days: 0, buffer_days: 0 })
      ).status
    ).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects historical as_of and foreign owner assertions before a snapshot read', async () => {
    expect(
      (await request(app).get('/inventory/forecast?as_of=2020-01-01')).status
    ).toBe(400);
    expect(
      (
        await request(app).get(
          '/inventory/forecast?expected_owner_id=00000000-0000-4000-a000-000000000099'
        )
      ).status
    ).toBe(409);
    expect(mocks.forecast).not.toHaveBeenCalled();
  });
  it('uses no-store private response headers and forwards only authenticated owner', async () => {
    const result = await request(app).get(
      '/inventory/forecast?expected_owner_id=00000000-0000-4000-a000-000000000001'
    );
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(mocks.forecast).toHaveBeenCalledWith(
      '00000000-0000-4000-a000-000000000001'
    );
  });
  it('accepts zero whole days and rejects negative/fractional/unknown owner body fields', async () => {
    expect(
      (
        await request(app)
          .put('/preferences/medication-reorder')
          .send({ lead_days: 0, buffer_days: 0 })
      ).status
    ).toBe(200);
    for (const body of [
      { lead_days: -1, buffer_days: 3 },
      { lead_days: 1.2, buffer_days: 3 },
      { lead_days: 14, buffer_days: 3, user_id: 'foreign' },
      { lead_days: 2147483648, buffer_days: 0 },
    ])
      expect(
        (await request(app).put('/preferences/medication-reorder').send(body))
          .status
      ).toBe(400);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('protects dashboard with the same GET auth/profile assertion and private headers', async () => {
    expect(
      (
        await request(app)
          .get('/inventory/dashboard')
          .set('x-test-auth', 'missing')
      ).status
    ).toBe(401);
    expect(
      (await request(app).get('/inventory/dashboard?as_of=2020-01-01')).status
    ).toBe(400);
    expect(
      (
        await request(app).get(
          '/inventory/dashboard?expected_owner_id=00000000-0000-4000-a000-000000000099'
        )
      ).status
    ).toBe(409);
    expect(mocks.dashboard).not.toHaveBeenCalled();
    const result = await request(app)
      .get('/inventory/dashboard')
      .set('x-test-readonly', '1');
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(mocks.dashboard).toHaveBeenCalledWith(
      '00000000-0000-4000-a000-000000000001'
    );
  });
  it('opts only forecast/dashboard into planned mode while explicit committed retains the old call shape', async () => {
    for (const endpoint of ['forecast', 'dashboard']) {
      const handler =
        endpoint === 'forecast' ? mocks.forecast : mocks.dashboard;
      await request(app)
        .get(`/inventory/${endpoint}?forecast_mode=planned_cycles`)
        .set('x-test-readonly', '1')
        .expect(200);
      expect(handler).toHaveBeenLastCalledWith(
        '00000000-0000-4000-a000-000000000001',
        undefined,
        'planned_cycles'
      );
      await request(app)
        .get(`/inventory/${endpoint}?forecast_mode=committed`)
        .expect(200);
      expect(handler).toHaveBeenLastCalledWith(
        '00000000-0000-4000-a000-000000000001'
      );
      await request(app).get(`/inventory/${endpoint}`).expect(200);
      expect(handler).toHaveBeenLastCalledWith(
        '00000000-0000-4000-a000-000000000001'
      );
    }
  });
  it('rejects invalid/duplicate modes and a changed owner before any read', async () => {
    for (const query of [
      'forecast_mode=projected',
      'forecast_mode=planned_cycles&forecast_mode=committed',
      'forecast_mode=planned_cycles&as_of=2026-01-01',
    ])
      expect(
        (await request(app).get(`/inventory/forecast?${query}`)).status
      ).toBe(400);
    expect(
      (
        await request(app).get(
          '/inventory/dashboard?forecast_mode=planned_cycles&expected_owner_id=00000000-0000-4000-a000-000000000099'
        )
      ).status
    ).toBe(409);
    expect(mocks.forecast).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it('does not accept forecast mode on preferences GET or PUT', async () => {
    expect(
      (
        await request(app).get(
          '/preferences/medication-reorder?forecast_mode=planned_cycles'
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/preferences/medication-reorder?forecast_mode=committed')
          .send({ lead_days: 0, buffer_days: 0 })
      ).status
    ).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
