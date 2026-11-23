import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const blendId = '00000000-0000-4000-a000-0000000000b1';
const componentId = '00000000-0000-4000-a000-0000000000c1';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  replace: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/medicationBlendRepository.js', () => ({
  listBlends: mocks.list,
  replaceBlend: mocks.replace,
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
import router from '../routes/v2/medicationBlendRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/medication-blends', router);
// Mirror the app's error handler, which answers with the status an error carries.
app.use(
  (
    error: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
);
const path = '/api/v2/medication-blends';
const saved = {
  blend_medication_id: blendId,
  name: 'KLOW',
  components: [
    {
      component_medication_id: componentId,
      name: 'GHK-Cu',
      mass_mg: '50',
      source: 'label',
      sort_index: 0,
    },
  ],
};

describe('vendor blends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([saved]);
    mocks.replace.mockResolvedValue(saved);
  });

  it('lists the owner’s blends', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ blends: [saved] });
    expect(mocks.list).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('medications');
  });

  it('replaces a composition, ordering as sent and defaulting the source to the label', async () => {
    const response = await request(app)
      .put(`${path}/${blendId}`)
      .send({
        components: [
          { component_medication_id: componentId, mass_mg: 50 },
          {
            component_medication_id: '00000000-0000-4000-a000-0000000000c2',
            mass_mg: '10.50',
            source: 'coa',
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ blend: saved });
    expect(mocks.replace).toHaveBeenCalledWith(
      owner,
      blendId,
      {
        components: [
          {
            component_medication_id: componentId,
            mass_mg: '50',
            source: 'label',
          },
          {
            component_medication_id: '00000000-0000-4000-a000-0000000000c2',
            mass_mg: '10.5',
            source: 'coa',
          },
        ],
      },
      owner
    );
  });

  it('accepts an empty list, which makes the medication a plain one again', async () => {
    const response = await request(app)
      .put(`${path}/${blendId}`)
      .send({ components: [] });
    expect(response.status).toBe(200);
    expect(mocks.replace).toHaveBeenCalledWith(
      owner,
      blendId,
      { components: [] },
      owner
    );
  });

  it('refuses what is not valid, writing nothing', async () => {
    const bad = (components: unknown, id = blendId) =>
      request(app).put(`${path}/${id}`).send({ components });
    expect(
      (await bad([{ component_medication_id: componentId, mass_mg: 0 }])).status
    ).toBe(400);
    expect(
      (await bad([{ component_medication_id: componentId, mass_mg: 'lots' }]))
        .status
    ).toBe(400);
    expect(
      (
        await bad([
          { component_medication_id: componentId, mass_mg: 1 },
          { component_medication_id: componentId, mass_mg: 2 },
        ])
      ).status
    ).toBe(400);
    expect(
      (
        await bad(
          [{ component_medication_id: componentId, mass_mg: 1 }],
          'not-an-id'
        )
      ).status
    ).toBe(400);
    expect((await request(app).put(`${path}/${blendId}`).send({})).status).toBe(
      400
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('passes the repository’s refusals on with their status', async () => {
    mocks.replace.mockRejectedValueOnce(
      Object.assign(
        new Error('KLOW is itself a blend, so it cannot be a component.'),
        {
          statusCode: 400,
        }
      )
    );
    const refused = await request(app)
      .put(`${path}/${blendId}`)
      .send({
        components: [{ component_medication_id: componentId, mass_mg: 1 }],
      });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('itself a blend');
    mocks.replace.mockRejectedValueOnce(
      Object.assign(new Error('Medication not found'), { statusCode: 404 })
    );
    expect(
      (await request(app).put(`${path}/${blendId}`).send({ components: [] }))
        .status
    ).toBe(404);
  });

  it('acts for the profile being managed, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    await request(app)
      .put(`${path}/${blendId}`)
      .set('x-test-target', other)
      .send({ components: [] });
    expect(mocks.replace).toHaveBeenCalledWith(
      other,
      blendId,
      expect.anything(),
      owner
    );
  });

  it('is closed to the signed-out and to people without medication access', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .put(`${path}/${blendId}`)
          .set('x-test-permission', 'denied')
          .send({ components: [] })
      ).status
    ).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
