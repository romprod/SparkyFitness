import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const scanId = '00000000-0000-4000-a000-0000000000b1';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/bodyCompScanRepository.js', () => ({
  listBodyCompScans: mocks.list,
  createBodyCompScan: mocks.create,
  deleteBodyCompScan: mocks.remove,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'Europe/London'),
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
import router from '../routes/v2/bodyCompScanRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/body-comp-scans', router);
const path = '/api/v2/body-comp-scans';
const body = {
  scanned_day: '2026-08-10',
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  total_fat_g: 20000,
  total_lean_g: 60000,
  total_bmc_g: 3000,
};
const region = (name: string, fat: number, lean: number, bmc: number) => ({
  region: name,
  fat_g: fat,
  lean_g: lean,
  bmc_g: bmc,
  total_g: fat + lean + bmc,
  pct_fat: 20,
});
const stored = {
  id: scanId,
  scanned_day: '2026-08-10',
  device_label: 'Hologic Horizon A',
  device_serial: 'SERIAL-1',
  software_version: '13.6',
  facility: 'Clinic',
  sex: 'male',
  age_years: 41,
  height_cm: 180,
  clinic_weight_kg: 83,
  total_fat_g: 20000,
  total_lean_g: 60000,
  total_bmc_g: 3000,
  total_mass_g: 83000,
  pct_fat: 24.1,
  vat_mass_g: 800,
  vat_volume_cm3: null,
  vat_area_cm2: null,
  total_bmd_gcm2: null,
  prep: {
    fasted: true,
    fasting_hours: 12,
    no_caffeine: null,
    no_training_prior_day: null,
    active_travel: null,
    euhydrated_voided: null,
    illness_free_14d: null,
  },
  creatine_status: null,
  carb_pattern_48h: null,
  regions: [region('trunk', 10000, 27000, 900)],
  notes: 'private note',
};

describe('DEXA scans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([stored]);
    mocks.create.mockResolvedValue(scanId);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('lists the owner’s scans with the check-in permission', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body.body_comp_scans).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('checkin');
  });

  it('adds a scan, working out the total mass and percentage fat and filling the rest with not recorded', async () => {
    const response = await request(app).post(path).send(body);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: scanId });
    const saved = mocks.create.mock.calls[0]?.[1];
    expect(saved).toMatchObject({
      total_mass_g: 83000,
      pct_fat: 24.1,
      vat_mass_g: null,
      creatine_status: null,
      regions: [],
    });
    expect(saved.prep.fasted).toBeNull();
    expect(mocks.create.mock.calls[0]?.[2]).toBe(owner);
  });

  it('keeps regions and what the report printed', async () => {
    await request(app)
      .post(path)
      .send({
        ...body,
        total_mass_g: 83250,
        pct_fat: 24,
        regions: [region('trunk', 10000, 27000, 900)],
      });
    const saved = mocks.create.mock.calls[0]?.[1];
    expect(saved.total_mass_g).toBe(83250);
    expect(saved.regions).toHaveLength(1);
  });

  it('refuses a scan that cannot be right, writing nothing', async () => {
    for (const bad of [
      {},
      { ...body, scanned_day: '2026-02-31' },
      { ...body, total_lean_g: 0 },
      { ...body, total_mass_g: 15000 },
      { ...body, sex: 'x' },
      {
        ...body,
        regions: [region('trunk', 1, 2, 3), region('trunk', 1, 2, 3)],
      },
      { ...body, regions: [{ ...region('trunk', 1, 2, 3), region: 'elbow' }] },
    ]) {
      const response = await request(app).post(path).send(bad);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('sends a CSV of every region and a total, without the serial number, software or notes', async () => {
    const response = await request(app).get(`${path}/export`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="body-composition-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const lines = response.text.split('\r\n');
    expect(lines[0]).toMatch(/^date,scan,region,device,facility,/);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('2026-08-10,1,trunk,Hologic Horizon A,Clinic');
    expect(lines[2]).toContain('2026-08-10,1,total,Hologic Horizon A,Clinic');
    for (const hidden of ['SERIAL-1', '13.6', 'private note'])
      expect(response.text).not.toContain(hidden);
  });

  it('deletes a scan, and treats one already gone as deleted', async () => {
    expect((await request(app).delete(`${path}/${scanId}`)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith(owner, scanId, owner);
    expect((await request(app).delete(`${path}/${scanId}`)).status).toBe(204);
    expect((await request(app).delete(`${path}/not-an-id`)).status).toBe(400);
  });

  it('acts for the profile being managed, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.list).toHaveBeenCalledWith(other, owner);
    await request(app).post(path).set('x-test-target', other).send(body);
    expect(mocks.create).toHaveBeenCalledWith(other, expect.anything(), owner);
  });

  it('is closed to the signed-out and to people without check-in access', async () => {
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
    expect(
      (
        await request(app)
          .get(`${path}/export`)
          .set('x-test-permission', 'denied')
      ).status
    ).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
