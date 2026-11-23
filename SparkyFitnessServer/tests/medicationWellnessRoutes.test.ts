import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  streams: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../services/medicationWellnessService.js', () => ({
  getMedicationWellnessStreams: mocks.streams,
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
import router from '../routes/v2/medicationWellnessRoutes.js';

const app = express();
app.use('/api/v2/medication-wellness', router);
const path = '/api/v2/medication-wellness';
const streams = {
  today: '2026-11-23',
  days: [],
  activities: [],
  weights_kg: [],
};

describe('recovery and weight tile records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streams.mockResolvedValue(streams);
  });

  it('returns the records for the owner, recording who asked', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(streams);
    expect(mocks.streams).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('medications');
  });

  it('acts for the profile being managed', async () => {
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

  it('passes a failure on rather than answering with half the records', async () => {
    mocks.streams.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await request(app).get(path)).status).toBe(500);
  });
});
