import express from 'express';
// @ts-expect-error TS7016 supertest has no declarations in this workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const repository = vi.hoisted(() => ({
  listPurchases: vi.fn(),
  getPurchase: vi.fn(),
  getEditorData: vi.fn(),
  getVialCosts: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  deletePurchase: vi.fn(),
}));
vi.mock('../models/medicationPurchaseRepository.js', () => repository);
import router, {
  requirePurchaseOwner,
} from '../routes/v2/medicationPurchaseRoutes.js';
const owner = '00000000-0000-4000-a000-000000000001';
const other = '00000000-0000-4000-a000-000000000002';
function appFor(effective = owner) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authenticatedUserId = owner;
    req.userId = effective;
    if (effective !== owner) req.originalUserId = owner;
    next();
  });
  app.use(requirePurchaseOwner);
  app.all('/', (_req, res) => res.json({ ok: true }));
  return app;
}
describe('financial API owner boundary', () => {
  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'rejects effective delegated owner for %s',
    async (method) => {
      const call = request(appFor(other))[method]('/');
      expect((await call).status).toBe(403);
    }
  );
  it('rejects switched header and all foreign target hints even when effective user is self', async () => {
    expect(
      (await request(appFor()).get('/').set('x-on-behalf-of-user-id', other))
        .status
    ).toBe(403);
    expect(
      (
        await request(appFor())
          .get('/')
          .query({ userId: [owner, other] })
      ).status
    ).toBe(403);
    expect(
      (await request(appFor()).post('/').send({ expected_owner_id: other }))
        .status
    ).toBe(403);
  });
  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'permits authenticated self %s',
    async (method) => {
      const call = request(appFor())[method]('/');
      expect((await call.send({ expected_owner_id: owner })).status).toBe(200);
    }
  );
});

describe('invoice route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  function routed(effective = owner) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authenticatedUserId = owner;
      req.userId = effective;
      next();
    });
    app.use('/api/v2/medication-purchases', router);
    return app;
  }
  it('returns only owner financial list and optional expected-owner read binding', async () => {
    repository.listPurchases.mockResolvedValue([]);
    expect(
      (
        await request(routed())
          .get('/api/v2/medication-purchases')
          .query({ expected_owner_id: owner })
      ).body
    ).toEqual({ purchases: [] });
    expect(repository.listPurchases).toHaveBeenCalledWith(owner);
    expect(
      (
        await request(routed())
          .get('/api/v2/medication-purchases')
          .query({ expected_owner_id: other })
      ).status
    ).toBe(403);
    expect(repository.listPurchases).toHaveBeenCalledTimes(1);
  });
  it('denies delegated financial reads before calling a repository', async () => {
    expect(
      (await request(routed(other)).get('/api/v2/medication-purchases')).status
    ).toBe(403);
    expect(repository.listPurchases).not.toHaveBeenCalled();
  });
  it('rejects missing expected owner or revision on writes', async () => {
    expect(
      (
        await request(routed())
          .post('/api/v2/medication-purchases')
          .send({ items: [] })
      ).status
    ).toBe(400);
    expect(
      (
        await request(routed())
          .delete('/api/v2/medication-purchases/' + other)
          .send({ expected_owner_id: owner })
      ).status
    ).toBe(400);
    expect(repository.createPurchase).not.toHaveBeenCalled();
    expect(repository.deletePurchase).not.toHaveBeenCalled();
  });
});
