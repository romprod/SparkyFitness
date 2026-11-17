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
const analytics = vi.hoisted(() => ({
  getMedicationCostAnalytics: vi.fn(),
  getMedicationPrescriptionVialCosts: vi.fn(),
}));
vi.mock('../models/medicationCostAnalyticsRepository.js', () => analytics);
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
  it.each(['3', '6', '12', 'all'])(
    'routes analytics %s before invoice IDs with explicit owner binding',
    async (window) => {
      const value = {
        window: { key: window, from_date: '2026-01-01', to_date: '2026-11-15' },
        rows: [],
      };
      analytics.getMedicationCostAnalytics.mockResolvedValue(value);
      const response = await request(routed())
        .get('/api/v2/medication-purchases/analytics')
        .query({ window, expected_owner_id: owner });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(value);
      expect(analytics.getMedicationCostAnalytics).toHaveBeenCalledWith(
        owner,
        window
      );
      expect(repository.getPurchase).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, 'invalid'])(
    'uses the source default window for %s',
    async (window) => {
      analytics.getMedicationCostAnalytics.mockResolvedValue({ rows: [] });
      const response = await request(routed())
        .get('/api/v2/medication-purchases/analytics')
        .query(window ? { window } : {});
      expect(response.status).toBe(200);
      expect(analytics.getMedicationCostAnalytics).toHaveBeenCalledWith(
        owner,
        '12'
      );
    }
  );
  it('denies delegated or foreign-owner analytics before the read model', async () => {
    expect(
      (
        await request(routed(other)).get(
          '/api/v2/medication-purchases/analytics'
        )
      ).status
    ).toBe(403);
    expect(
      (
        await request(routed())
          .get('/api/v2/medication-purchases/analytics')
          .query({ expected_owner_id: other })
      ).status
    ).toBe(403);
    expect(analytics.getMedicationCostAnalytics).not.toHaveBeenCalled();
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

describe('explicit owner prescription cost estimates', () => {
  function routed(effective = owner) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authenticatedUserId = owner;
      req.userId = effective;
      if (effective !== owner) req.originalUserId = owner;
      next();
    });
    app.use('/api/v2/medication-purchases', router);
    return app;
  }

  beforeEach(() => vi.clearAllMocks());
  it('keeps omitted vial-cost response on the existing invoice-only function and shape', async () => {
    repository.getVialCosts.mockResolvedValue([
      { pen_id: owner, is_costed: false },
    ]);
    const result = await request(routed()).get(
      '/api/v2/medication-purchases/vial-costs'
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      vials: [{ pen_id: owner, is_costed: false }],
    });
    expect(repository.getVialCosts).toHaveBeenCalledExactlyOnceWith(owner);
    expect(analytics.getMedicationPrescriptionVialCosts).not.toHaveBeenCalled();
  });
  it('routes only explicit estimates to the labelled financial loaders', async () => {
    const vials = { cost_basis: 'with_prescription_estimates', vials: [] };
    analytics.getMedicationPrescriptionVialCosts.mockResolvedValue(vials);
    const a = await request(routed())
      .get('/api/v2/medication-purchases/vial-costs')
      .query({
        cost_basis: 'with_prescription_estimates',
        expected_owner_id: owner,
      });
    expect(a.body).toEqual(vials);
    expect(
      analytics.getMedicationPrescriptionVialCosts
    ).toHaveBeenCalledExactlyOnceWith(owner);
    expect(repository.getVialCosts).not.toHaveBeenCalled();
    const report = { cost_basis: 'with_prescription_estimates', rows: [] };
    analytics.getMedicationCostAnalytics.mockResolvedValue(report);
    const b = await request(routed())
      .get('/api/v2/medication-purchases/analytics')
      .query({ window: '6', cost_basis: 'with_prescription_estimates' });
    expect(b.body).toEqual(report);
    expect(
      analytics.getMedicationCostAnalytics
    ).toHaveBeenCalledExactlyOnceWith(
      owner,
      '6',
      undefined,
      'with_prescription_estimates'
    );
    expect(b.headers['cache-control']).toBe('no-store');
  });
  it.each(['/analytics', '/vial-costs'])(
    'rejects unknown mode and delegated costs on %s',
    async (path) => {
      expect(
        (
          await request(routed())
            .get('/api/v2/medication-purchases' + path)
            .query({ cost_basis: 'unknown' })
        ).status
      ).toBe(400);
      expect(
        (
          await request(routed(other))
            .get('/api/v2/medication-purchases' + path)
            .query({ cost_basis: 'with_prescription_estimates' })
        ).status
      ).toBe(403);
      expect(analytics.getMedicationCostAnalytics).not.toHaveBeenCalled();
      expect(
        analytics.getMedicationPrescriptionVialCosts
      ).not.toHaveBeenCalled();
    }
  );
});
