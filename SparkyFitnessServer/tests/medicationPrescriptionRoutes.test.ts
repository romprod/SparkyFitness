import express from 'express';
// @ts-expect-error supertest has no bundled declarations in this workspace.
import request from 'supertest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const repo = vi.hoisted(() => ({
  listMedicationPrescriptions: vi.fn(),
  getMedicationPrescription: vi.fn(),
  createMedicationPrescription: vi.fn(),
  updateMedicationPrescription: vi.fn(),
  deleteMedicationPrescription: vi.fn(),
}));
vi.mock('../models/medicationPrescriptionRepository.js', () => repo);
import router from '../routes/v2/medicationPrescriptionRoutes.js';
const owner = '00000000-0000-4000-a000-000000000001',
  foreign = '00000000-0000-4000-a000-000000000002',
  id = '00000000-0000-4000-a000-000000000003',
  op = '00000000-0000-4000-a000-000000000004';
function appFor(target = owner) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authenticatedUserId = owner;
    req.userId = target;
    if (target !== owner) req.originalUserId = owner;
    next();
  });
  app.use('/rx', router);
  return app;
}
describe('owner-private prescription API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.listMedicationPrescriptions.mockResolvedValue([]);
    repo.createMedicationPrescription.mockResolvedValue({
      id,
      version: 1,
      deleted: false,
    });
    repo.updateMedicationPrescription.mockResolvedValue({
      id,
      version: 2,
      deleted: false,
    });
    repo.deleteMedicationPrescription.mockResolvedValue({
      id,
      version: null,
      deleted: true,
    });
  });
  it('allows self list with private headers and strict expected-owner binding', async () => {
    const res = await request(appFor()).get('/rx?expected_owner_id=' + owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prescriptions: [] });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(repo.listMedicationPrescriptions).toHaveBeenCalledExactlyOnceWith(
      owner,
      owner
    );
  });
  it.each(['get', 'post', 'put', 'delete'] as const)(
    'rejects delegated effective profile for %s before repository access',
    async (method) => {
      const res = await request(appFor(foreign))[method](
        '/rx' + (method === 'put' || method === 'delete' ? '/' + id : '')
      );
      expect(res.status).toBe(403);
      expect(repo.listMedicationPrescriptions).not.toHaveBeenCalled();
      expect(repo.createMedicationPrescription).not.toHaveBeenCalled();
      expect(repo.updateMedicationPrescription).not.toHaveBeenCalled();
      expect(repo.deleteMedicationPrescription).not.toHaveBeenCalled();
    }
  );
  it('rejects switched headers and foreign owner assertions', async () => {
    expect(
      (
        await request(appFor())
          .get('/rx')
          .set('x-on-behalf-of-user-id', foreign)
      ).status
    ).toBe(403);
    expect(
      (await request(appFor()).get('/rx?expected_owner_id=' + foreign)).status
    ).toBe(403);
  });
  it('rejects unknown query/body/date/count and invalid IDs instead of coercing or retargeting', async () => {
    expect((await request(appFor()).get('/rx?userId=' + owner)).status).toBe(
      400
    );
    expect((await request(appFor()).get('/rx/not-a-uuid')).status).toBe(400);
    for (const fields of [
      { quantity: 1.5 },
      { expiration: '2026-02-30' },
      { attachment_id: id },
    ]) {
      expect(
        (
          await request(appFor())
            .post('/rx')
            .send({ operation_id: op, medication_id: id, ...fields })
        ).status
      ).toBe(400);
    }
    expect(repo.createMedicationPrescription).not.toHaveBeenCalled();
  });
  it('uses source create defaults and exact operation response without creating inventory', async () => {
    const res = await request(appFor()).post('/rx').send({
      operation_id: op,
      medication_id: id,
      cost: '0',
      refills_remaining: 0,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id, version: 1, deleted: false });
    expect(repo.createMedicationPrescription).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        cost: '0',
        refills_remaining: 0,
        currency: 'AUD',
        status: 'active',
      }),
      undefined
    );
  });
  it('keeps update omission and delete receipt JSON semantics', async () => {
    const update = await request(appFor())
      .put('/rx/' + id)
      .send({ operation_id: op, expected_version: 1, source: null });
    expect(update.status).toBe(200);
    const input = repo.updateMedicationPrescription.mock.calls[0]![2];
    expect(input).toEqual({
      operation_id: op,
      expected_version: 1,
      source: null,
    });
    expect(Object.hasOwn(input, 'status')).toBe(false);
    const deletion = await request(appFor())
      .delete('/rx/' + id)
      .send({ operation_id: op, expected_version: 2 });
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({ id, version: null, deleted: true });
  });
});
