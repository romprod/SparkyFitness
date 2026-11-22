import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const eventId = '00000000-0000-4000-a000-0000000000e1';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/lifeEventRepository.js', () => ({
  listLifeEvents: mocks.list,
  createLifeEvent: mocks.create,
  deleteLifeEvent: mocks.remove,
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
import router from '../routes/v2/lifeEventRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/life-events', router);
const path = '/api/v2/life-events';
const body = {
  kind: 'illness',
  start_day: '2026-11-10',
  end_day: '2026-11-14',
  label: 'flu',
  notes: 'in bed',
};

describe('illness and travel windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: eventId,
        kind: 'illness',
        start_day: '2026-11-10',
        end_day: '2026-11-14',
        label: 'flu',
        notes: null,
      },
    ]);
    mocks.create.mockResolvedValue(eventId);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('lists the owner’s windows', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body.life_events).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('medications');
  });

  it('adds a window, reading a blank end day as the start day', async () => {
    const response = await request(app)
      .post(path)
      .send({ kind: 'travel', start_day: '2026-11-20', label: '  ' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: eventId });
    expect(mocks.create).toHaveBeenCalledWith(
      owner,
      {
        kind: 'travel',
        start_day: '2026-11-20',
        end_day: '2026-11-20',
        label: null,
        notes: null,
      },
      owner
    );
  });

  it('refuses a window that is not valid, writing nothing', async () => {
    for (const bad of [
      { ...body, end_day: '2026-11-09' },
      { ...body, start_day: '2026-02-31' },
      { ...body, kind: 'holiday' },
      { ...body, end_day: '2027-11-14' },
    ]) {
      const response = await request(app).post(path).send(bad);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('deletes a window, and treats one already gone as deleted', async () => {
    const response = await request(app).delete(`${path}/${eventId}`);
    expect(response.status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith(owner, eventId, owner);
    expect((await request(app).delete(`${path}/${eventId}`)).status).toBe(204);
    expect((await request(app).delete(`${path}/not-an-id`)).status).toBe(400);
  });

  it('acts for the profile being managed, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    await request(app).post(path).set('x-test-target', other).send(body);
    expect(mocks.create).toHaveBeenCalledWith(other, expect.anything(), owner);
  });

  it('is closed to the signed-out and to people without medication access', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
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
