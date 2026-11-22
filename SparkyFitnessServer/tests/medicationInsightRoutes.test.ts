import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  streams: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../services/medicationInsightService.js', () => ({
  getMedicationInsightStreams: mocks.streams,
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
import router from '../routes/v2/medicationInsightRoutes.js';

const app = express();
app.use('/api/v2/medication-insights', router);
const path = '/api/v2/medication-insights';
const streams = {
  today: '2026-11-22',
  from_day: '2026-08-25',
  doses: [],
  wearable: [],
  weights_kg: [{ day: '2026-11-21', value: 80.5 }],
  symptoms: [],
  adherence_pct: 92,
};

describe('insight records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streams.mockResolvedValue(streams);
  });
  it('serves the owner’s records for the window', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(streams);
    expect(mocks.streams).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('medications');
  });
  it('reads the profile being acted for, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.streams).toHaveBeenCalledWith(other, owner);
  });
  it('is closed to the signed-out and to people without medication access', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
    expect(
      (await request(app).get(path).set('x-test-permission', 'denied')).status
    ).toBe(403);
    expect(mocks.streams).not.toHaveBeenCalled();
  });
  it('passes a failure on to the error handler', async () => {
    mocks.streams.mockRejectedValue(new Error('database down'));
    const failing = express();
    failing.use('/api/v2/medication-insights', router);
    failing.use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(500).json({ error: error.message });
      }
    );
    const response = await request(failing).get(path);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'database down' });
  });
});
