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
      currency: ' GBP ',
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
        currency: 'GBP',
        status: 'active',
      }),
      undefined
    );
  });
  it('refuses a create without a currency as a 400 and never calls the repository', async () => {
    for (const currency of [undefined, '', '  ', null]) {
      const res = await request(appFor())
        .post('/rx')
        .send({ operation_id: op, medication_id: id, currency });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Currency is required.' });
    }
    expect(repo.createMedicationPrescription).not.toHaveBeenCalled();
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

  describe('model 2 (several medicines) negotiated by header', () => {
    const header = { 'X-Prescription-Model-Version': '2' };
    const med = '00000000-0000-4000-a000-000000000005';
    const med2 = '00000000-0000-4000-a000-000000000006';
    const row = {
      id,
      user_id: owner,
      medication_id: med,
      medication_name: 'One + Two',
      source: null,
      prescriber: null,
      pharmacy: null,
      dose_instructions: null,
      cost: null,
      currency: 'AUD',
      quantity: null,
      refills_authorized: null,
      refills_remaining: null,
      date_written: null,
      next_refill: null,
      expiration: null,
      lead_time_days: null,
      status: 'active',
      version: 1,
      created_at: '2026-11-17T12:00:00Z',
      updated_at: '2026-11-17T12:00:00Z',
    };
    const covered = [
      { medication_id: med, medication_name: 'One', position: 0 },
      { medication_id: med2, medication_name: 'Two', position: 1 },
    ];
    it('lists the covered medicines for model 2 only', async () => {
      repo.listMedicationPrescriptions.mockResolvedValue([
        { ...row, medications: covered },
      ]);
      const v2 = await request(appFor()).get('/rx').set(header);
      expect(v2.status).toBe(200);
      expect(v2.body.prescriptions[0].medications).toEqual(covered);
      expect(repo.listMedicationPrescriptions).toHaveBeenLastCalledWith(
        owner,
        undefined,
        2
      );
      repo.listMedicationPrescriptions.mockResolvedValue([row]);
      const v1 = await request(appFor()).get('/rx');
      expect(v1.status).toBe(200);
      expect(v1.body.prescriptions[0]).not.toHaveProperty('medications');
      expect(repo.listMedicationPrescriptions).toHaveBeenLastCalledWith(
        owner,
        undefined
      );
    });
    it('treats an absent, malformed or version 1 header as model 1', async () => {
      repo.listMedicationPrescriptions.mockResolvedValue([row]);
      for (const value of [undefined, '1', 'banana', '0'])
        await request(appFor())
          .get('/rx')
          .set(
            value === undefined ? {} : { 'X-Prescription-Model-Version': value }
          );
      for (const call of repo.listMedicationPrescriptions.mock.calls)
        expect(call).toHaveLength(2);
    });
    it('details a prescription with its coverage for model 2', async () => {
      repo.getMedicationPrescription.mockResolvedValue({
        ...row,
        medications: covered,
      });
      const res = await request(appFor())
        .get('/rx/' + id)
        .set(header);
      expect(res.status).toBe(200);
      expect(res.body.prescription.medications).toHaveLength(2);
      expect(repo.getMedicationPrescription).toHaveBeenCalledWith(
        owner,
        id,
        undefined,
        2
      );
    });
    it('creates from medication_ids only for model 2 and refuses unknown shapes', async () => {
      const body = {
        operation_id: op,
        currency: 'AUD',
        medication_ids: [med, med2],
      };
      expect((await request(appFor()).post('/rx').send(body)).status).toBe(400);
      expect(repo.createMedicationPrescription).not.toHaveBeenCalled();
      const ok = await request(appFor()).post('/rx').set(header).send(body);
      expect(ok.status).toBe(201);
      expect(repo.createMedicationPrescription).toHaveBeenCalledWith(
        owner,
        expect.objectContaining({ medication_ids: [med, med2] }),
        undefined
      );
      for (const bad of [
        { ...body, medication_id: med },
        { ...body, medication_ids: [] },
        { ...body, extra: 1 },
      ])
        expect(
          (await request(appFor()).post('/rx').set(header).send(bad)).status
        ).toBe(400);
    });
    it('updates the covered set for model 2 only and sends legacy bodies on unchanged', async () => {
      const patch = {
        operation_id: op,
        expected_version: 1,
        medication_ids: [med2],
      };
      expect(
        (
          await request(appFor())
            .put('/rx/' + id)
            .send(patch)
        ).status
      ).toBe(400);
      expect(
        (
          await request(appFor())
            .put('/rx/' + id)
            .set(header)
            .send(patch)
        ).status
      ).toBe(200);
      const legacyBody = {
        operation_id: op,
        expected_version: 1,
        medication_id: med,
      };
      await request(appFor())
        .put('/rx/' + id)
        .send(legacyBody);
      expect(repo.updateMedicationPrescription).toHaveBeenLastCalledWith(
        owner,
        id,
        legacyBody,
        undefined
      );
    });
  });
});
