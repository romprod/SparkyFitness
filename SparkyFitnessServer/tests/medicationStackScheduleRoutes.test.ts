import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const stackId = '00000000-0000-4000-a000-0000000000a1';
const mocks = vi.hoisted(() => ({
  reviewStackSchedule: vi.fn(),
  saveStackSchedule: vi.fn(),
  clearStackSchedule: vi.fn(),
  bindAddedStackMembers: vi.fn(),
  updateStack: vi.fn(),
}));
vi.mock('../services/medicationStackScheduleService.js', () => ({
  reviewStackSchedule: mocks.reviewStackSchedule,
  saveStackSchedule: mocks.saveStackSchedule,
  clearStackSchedule: mocks.clearStackSchedule,
  bindAddedStackMembers: mocks.bindAddedStackMembers,
}));
vi.mock('../services/medicationStackSetupService.js', () => ({
  setupPremixedStack: vi.fn(),
}));
vi.mock('../models/medicationStackRepository.js', () => ({
  listStacks: vi.fn(),
  createStack: vi.fn(),
  updateStack: mocks.updateStack,
  deleteStack: vi.fn(),
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
    req.userId = '00000000-0000-4000-a000-000000000001';
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
    () =>
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.headers['x-test-permission'] === 'denied') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      next();
    },
}));

import router from '../routes/v2/medicationStackRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/medication-stacks', router);
app.use(
  (
    error: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => res.status(error.statusCode ?? 500).json({ error: error.message })
);
const base = `/api/v2/medication-stacks/${stackId}/schedule`;
const schedule = { schedule_type_id: 'daily', time_of_day: '08:00' };
const save = {
  schedule,
  operation_id: '00000000-0000-4000-b000-000000000001',
  expected_version: 0,
  review_fingerprint: 'abc',
  effective_from: '2026-12-01',
  skipped_member_ids: [],
  acknowledged_member_ids: [],
};
const problem = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

describe('stack schedule routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reviews a schedule for the signed-in owner', async () => {
    mocks.reviewStackSchedule.mockResolvedValue({ members: [] });
    const response = await request(app)
      .post(`${base}/review`)
      .send({ schedule });
    expect(response.status).toBe(200);
    expect(mocks.reviewStackSchedule).toHaveBeenCalledWith(
      owner,
      stackId,
      expect.objectContaining({
        schedule: expect.objectContaining({
          schedule_type_id: 'daily',
          time_of_day: '08:00',
        }),
      })
    );
  });

  it('saves with 201 the first time and 200 on a replace or replay', async () => {
    mocks.saveStackSchedule.mockResolvedValueOnce({
      result: { operation_id: save.operation_id },
      created: true,
    });
    expect((await request(app).put(base).send(save)).status).toBe(201);
    mocks.saveStackSchedule.mockResolvedValueOnce({
      result: { operation_id: save.operation_id },
      created: false,
    });
    expect((await request(app).put(base).send(save)).status).toBe(200);
  });

  it('answers 400 for an invalid body and calls nothing', async () => {
    const bad = await request(app)
      .put(base)
      .send({ ...save, schedule: { schedule_type_id: 'every_n_days' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.details)).toContain(
      'Enter how many days between doses (2 or more).'
    );
    expect(
      (await request(app).post(`${base}/review`).send({ schedule: {} })).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/v2/medication-stacks/not-a-uuid/schedule')
          .send(save)
      ).status
    ).toBe(400);
    expect(
      (await request(app).delete(base).send({ operation_id: 'x' })).status
    ).toBe(400);
    expect(mocks.saveStackSchedule).not.toHaveBeenCalled();
    expect(mocks.reviewStackSchedule).not.toHaveBeenCalled();
    expect(mocks.clearStackSchedule).not.toHaveBeenCalled();
  });

  it('passes the service status through: 404, 409 and 422', async () => {
    for (const [status, message] of [
      [404, 'Stack not found.'],
      [409, 'The stack schedule changed. Refresh and review this draft again.'],
      [422, 'Timing for this plan is set by the stack.'],
    ] as const) {
      mocks.saveStackSchedule.mockRejectedValueOnce(problem(message, status));
      const response = await request(app).put(base).send(save);
      expect(response.status).toBe(status);
      expect(response.body.error).toBe(message);
    }
  });

  it('is behind authentication and the medication permission', async () => {
    expect(
      (await request(app).put(base).set('x-test-auth', 'missing').send(save))
        .status
    ).toBe(401);
    expect(
      (
        await request(app)
          .put(base)
          .set('x-test-permission', 'denied')
          .send(save)
      ).status
    ).toBe(403);
    expect(mocks.saveStackSchedule).not.toHaveBeenCalled();
  });

  it('removes a schedule with 204', async () => {
    mocks.clearStackSchedule.mockResolvedValue(undefined);
    const response = await request(app)
      .delete(base)
      .send({ operation_id: save.operation_id, expected_version: 2 });
    expect(response.status).toBe(204);
    expect(mocks.clearStackSchedule).toHaveBeenCalledWith(
      owner,
      stackId,
      expect.objectContaining({ expected_version: 2 })
    );
  });

  it('hands membership edits a hook that binds the added members', async () => {
    mocks.updateStack.mockImplementation(
      async (
        _o: string,
        _i: string,
        _b: unknown,
        hook: (client: unknown, added: string[]) => Promise<void>
      ) => {
        await hook('client', ['m1']);
        return true;
      }
    );
    const response = await request(app)
      .put(`/api/v2/medication-stacks/${stackId}`)
      .send({ name: 'A', medication_ids: [owner] });
    expect(response.status).toBe(204);
    expect(mocks.bindAddedStackMembers).toHaveBeenCalledWith(
      'client',
      owner,
      stackId,
      ['m1']
    );
  });
});
