import express from 'express';
// @ts-expect-error no declarations installed in workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = '00000000-0000-4000-a000-000000000001';
const mocks = vi.hoisted(() => ({
  wearable: vi.fn(),
  journal: vi.fn(),
  timezone: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('../models/healthExportRepository.js', () => ({
  listWearableExportRecords: mocks.wearable,
  loadJournalExportParts: mocks.journal,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.timezone,
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
import router from '../routes/v2/healthExportRoutes.js';

const app = express();
app.use('/api/v2/health-exports', router);
const path = '/api/v2/health-exports';
const wearable = (patch: Record<string, unknown> = {}) => ({
  entry_date: '2026-11-22',
  source: 'garmin',
  sleep_seconds: 24600,
  sleep_deep_seconds: null,
  sleep_light_seconds: null,
  sleep_rem_seconds: null,
  sleep_awake_seconds: null,
  sleep_score: 84,
  bedtime: null,
  wake_time: null,
  resting_hr: 58,
  hrv_ms: null,
  body_battery_high: null,
  body_battery_low: null,
  body_battery_charged: null,
  body_battery_drained: null,
  stress_avg: 36,
  stress_max: null,
  steps: 8123,
  distance_m: null,
  floors_climbed: null,
  active_calories: null,
  total_calories: null,
  exercise_minutes: null,
  moderate_minutes: null,
  vigorous_minutes: null,
  vo2_max: null,
  training_readiness: null,
  recovery_time_hours: null,
  spo2_avg: null,
  respiration_avg: null,
  synced_at: '2026-11-22T20:00:00.000Z',
  ...patch,
});

describe('daily record CSV downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timezone.mockResolvedValue('Europe/London');
    mocks.wearable.mockResolvedValue([
      wearable({ entry_date: '2026-11-21' }),
      wearable(),
    ]);
    mocks.journal.mockResolvedValue({
      measurements: [
        {
          day: '2026-11-22',
          at: '2026-11-22T07:00:00Z',
          weight_kg: 79.9,
          body_fat_percent: null,
          muscle_mass_kg: null,
        },
      ],
      moods: [
        {
          day: '2026-11-22',
          at: '2026-11-22T08:00:00Z',
          mood: 4,
          energy: 3,
          focus: null,
          notes: '=HYPERLINK("x")',
        },
      ],
      water: [{ day: '2026-11-22', water_ml: 1500 }],
      sleep: [{ day: '2026-11-22', seconds: 24600 }],
    });
  });

  it('sends the wearable days newest first as a no-store CSV named for the owner’s day', async () => {
    const response = await request(app).get(`${path}/wearable`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="wearable-\d{4}-\d{2}-\d{2}\.csv"/
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const lines = response.text.split('\r\n');
    expect(lines[0]).toMatch(/^date,source,sleep_seconds,/);
    expect(lines[1]).toMatch(/^2026-11-22,garmin,24600,/);
    expect(lines[2]).toMatch(/^2026-11-21,garmin,/);
    expect(mocks.wearable).toHaveBeenCalledWith(owner, owner);
    expect(mocks.permission).toHaveBeenCalledWith('checkin');
  });

  it('sends the journal one row a day, with text a spreadsheet would run made safe', async () => {
    const response = await request(app).get(`${path}/journal`);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/journal-/);
    expect(response.text.split('\r\n').slice(0, 2)).toEqual([
      'date,weight_kg,body_fat_percent,muscle_mass_kg,mood,energy,focus,sleep_hours,water_ml,notes',
      '2026-11-22,79.9,,,4,3,,6.8,1500,"\'=HYPERLINK(""x"")"',
    ]);
    expect(mocks.journal).toHaveBeenCalledWith(owner, owner);
  });

  it('acts for the profile being managed', async () => {
    const other = '00000000-0000-4000-a000-000000000002';
    await request(app).get(`${path}/wearable`).set('x-test-target', other);
    expect(mocks.wearable).toHaveBeenCalledWith(other, owner);
    expect(mocks.timezone).toHaveBeenCalledWith(other);
  });

  it('is closed to the signed-out and to people without check-in access', async () => {
    for (const kind of ['wearable', 'journal']) {
      expect(
        (
          await request(app)
            .get(`${path}/${kind}`)
            .set('x-test-auth', 'missing')
        ).status
      ).toBe(401);
      expect(
        (
          await request(app)
            .get(`${path}/${kind}`)
            .set('x-test-permission', 'denied')
        ).status
      ).toBe(403);
    }
    expect(mocks.wearable).not.toHaveBeenCalled();
    expect(mocks.journal).not.toHaveBeenCalled();
  });

  it('answers with a failure, not a half-written file', async () => {
    mocks.wearable.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await request(app).get(`${path}/wearable`)).status).toBe(500);
  });
});
