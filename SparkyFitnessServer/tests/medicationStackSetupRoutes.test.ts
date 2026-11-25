import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  setupPremixedStack: vi.fn(),
  listStacks: vi.fn(),
  createStack: vi.fn(),
  updateStack: vi.fn(),
  deleteStack: vi.fn(),
}));
vi.mock('../services/medicationStackSetupService.js', () => ({
  setupPremixedStack: mocks.setupPremixedStack,
}));
vi.mock('../models/medicationStackRepository.js', () => mocks);
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
const path = '/api/v2/medication-stacks/setup';
const valid = {
  operation_id: '00000000-0000-4000-b000-000000000001',
  name: ' Stack ',
  components: [
    {
      medication_name: 'Peptide A',
      concentration_value: 5,
      concentration_unit: 'mg/ml',
      vial_volume_ml: 5,
      quantity: 2,
      dose_volume_ml: 0.2,
    },
  ],
};

describe('POST /medication-stacks/setup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the body, runs the setup for the signed-in owner and returns 201', async () => {
    const result = { operation_id: valid.operation_id, components: [] };
    mocks.setupPremixedStack.mockResolvedValue(result);
    const response = await request(app).post(path).send(valid);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(result);
    expect(mocks.setupPremixedStack).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ name: 'Stack', notes: null })
    );
  });

  it('answers 400 with details and does nothing for an invalid body', async () => {
    const response = await request(app)
      .post(path)
      .send({ ...valid, components: [] });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.details)).toContain(
      'Add at least one component with a concentration and positive dose.'
    );
    expect(mocks.setupPremixedStack).not.toHaveBeenCalled();
  });

  it('passes the service refusals on with their status', async () => {
    mocks.setupPremixedStack.mockRejectedValue(
      Object.assign(
        new Error(
          'Peptide A already has an active plan. Add it to a stack from the stack list instead.'
        ),
        { statusCode: 409 }
      )
    );
    const response = await request(app).post(path).send(valid);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('already has an active plan');
  });

  it('needs sign-in and medication permission', async () => {
    expect(
      (await request(app).post(path).set('x-test-auth', 'missing').send(valid))
        .status
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(path)
          .set('x-test-permission', 'denied')
          .send(valid)
      ).status
    ).toBe(403);
    expect(mocks.setupPremixedStack).not.toHaveBeenCalled();
  });

  it('leaves the existing stack routes where they were', async () => {
    mocks.createStack.mockResolvedValue(owner);
    const response = await request(app)
      .post('/api/v2/medication-stacks')
      .send({ name: 'A', medication_ids: [owner] });
    expect(response.status).toBe(201);
    expect(mocks.setupPremixedStack).not.toHaveBeenCalled();
    mocks.updateStack.mockResolvedValue(true);
    expect(
      (
        await request(app)
          .put(`/api/v2/medication-stacks/${owner}`)
          .send({ name: 'A', medication_ids: [owner] })
      ).status
    ).toBe(204);
  });
});
