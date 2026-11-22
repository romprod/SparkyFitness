import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  doses: vi.fn(),
  labs: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/medicationExportRepository.js', () => ({
  listDoseExportRecords: mocks.doses,
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
import router from '../routes/v2/medicationExportRoutes.js';

const app = express();
app.use('/api/v2/medication-exports', router);
const path = '/api/v2/medication-exports/doses';

describe('dose CSV download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doses.mockResolvedValue([
      {
        entry_type: 'injection',
        taken_at: new Date('2026-11-16T13:19:18.510Z'),
        entry_date: '2026-11-16',
        medication: 'Retatrutide',
        is_supplement: false,
        status: 'taken',
        administration_route: null,
        dose_amount: '2',
        dose_unit: 'mg',
        volume_ml: '0.2',
        syringe_units: '20',
        site: 'stomach_mid_left',
        vial: 'Rt20 #1',
        source: 'manual',
        scheduled_for: null,
        plan: null,
        notes: '=HYPERLINK("x")',
      },
    ]);
  });
  it('serves the owner’s doses as a private CSV download', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="doses-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const [header, first] = response.text.split('\r\n');
    expect(header).toBe(
      'taken_at,local_day,timezone,medication,kind,status,route,dose,dose_unit,volume_ml,syringe_units,injection_site,vial,source,scheduled_for,minutes_from_schedule,plan,notes'
    );
    expect(first).toContain(
      '2026-11-16T13:19:18.510Z,2026-11-16,Europe/London,Retatrutide,medication,taken,injection,2,mg,0.2,20,stomach_mid_left,Rt20 #1,manual'
    );
    // A note that begins like a formula is marked as text.
    expect(first).toContain('"\'=HYPERLINK(""x"")"');
    expect(mocks.doses).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('medications');
  });
  it('reads the profile being acted for, with the caller recorded', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(path).set('x-test-target', other);
    expect(mocks.doses).toHaveBeenCalledWith(other, owner);
  });
  it('is closed to the signed-out and to people without medication access', async () => {
    expect(
      (await request(app).get(path).set('x-test-auth', 'missing')).status
    ).toBe(401);
    expect(
      (await request(app).get(path).set('x-test-permission', 'denied')).status
    ).toBe(403);
    expect(mocks.doses).not.toHaveBeenCalled();
  });
});
