import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error supertest has no bundled types in this project
import request from 'supertest';
import express from 'express';
import * as pinRepository from '../models/medicationSmoothWeekPinRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import medicationRoutes from '../routes/v2/medicationRoutes.js';

vi.mock('../models/medicationSmoothWeekPinRepository.js');
vi.mock('../models/medicationRepository.js');
vi.mock('../models/medicationPenRepository.js');
vi.mock('../models/injectionRepository.js');
vi.mock('../models/titrationRepository.js');
vi.mock('../models/medicationEntryRepository.js');
vi.mock('../models/medicationDisplayPreferenceRepository.js');
vi.mock('../services/glp1Service.js');
vi.mock('../services/medicationCalendarService.js', () => ({
  getMedicationCalendarWeek: vi.fn(),
}));
vi.mock('../models/externalProviderRepository.js', () => ({
  getActiveProvidersByTypes: vi.fn(),
}));
vi.mock('../services/supplementLookupService.js', () => ({
  lookupSupplementByUpc: vi.fn(),
  mapScannedLabel: vi.fn(),
}));
vi.mock('../services/supplementLabelScanService.js', () => ({
  extractSupplementLabel: vi.fn(),
}));
vi.mock('../utils/adminCheck.js', () => ({
  resolveIsAdmin: vi.fn(async () => false),
}));
vi.mock('../services/supplementOpenFoodFactsService.js', () => ({
  lookupSupplementInOpenFoodFacts: vi.fn(),
}));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn(async () => true),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn(),
  })),
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: vi.fn(
    () =>
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) =>
        next()
  ),
}));
vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  default: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'America/New_York'),
  resolveTemplateStartDay: vi.fn(async () => '2026-07-28'),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.userId = 'user-1';
  next();
});
app.use('/api/v2/medications', medicationRoutes);

const base = '/api/v2/medications/smooth-week/pins';
const id = '550e8400-e29b-41d4-a716-446655440000';

describe('Smooth your week pin routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the signed-in user’s pinned ids, not swallowed by /:id', async () => {
    vi.mocked(pinRepository.listSmoothWeekPins).mockResolvedValue([id]);
    const res = await request(app).get(base);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ medication_ids: [id] });
    expect(pinRepository.listSmoothWeekPins).toHaveBeenCalledWith('user-1');
    expect(medicationRepository.getMedicationById).not.toHaveBeenCalled();
  });

  it('pins with 204', async () => {
    vi.mocked(pinRepository.pinSmoothWeekMedication).mockResolvedValue(true);
    const res = await request(app).put(`${base}/${id}`);
    expect(res.status).toBe(204);
    expect(pinRepository.pinSmoothWeekMedication).toHaveBeenCalledWith(
      'user-1',
      id
    );
  });

  it('answers 404 when the medication is not the user’s', async () => {
    vi.mocked(pinRepository.pinSmoothWeekMedication).mockResolvedValue(false);
    const res = await request(app).put(`${base}/${id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Medication not found.' });
  });

  it('answers 400 for a non-UUID id on PUT and DELETE', async () => {
    expect((await request(app).put(`${base}/nope`)).status).toBe(400);
    expect((await request(app).delete(`${base}/nope`)).status).toBe(400);
    expect(pinRepository.pinSmoothWeekMedication).not.toHaveBeenCalled();
    expect(pinRepository.unpinSmoothWeekMedication).not.toHaveBeenCalled();
  });

  it('unpins with 204', async () => {
    vi.mocked(pinRepository.unpinSmoothWeekMedication).mockResolvedValue();
    const res = await request(app).delete(`${base}/${id}`);
    expect(res.status).toBe(204);
    expect(pinRepository.unpinSmoothWeekMedication).toHaveBeenCalledWith(
      'user-1',
      id
    );
  });

  it('passes repository failures to the error handler', async () => {
    vi.mocked(pinRepository.listSmoothWeekPins).mockRejectedValue(
      new Error('boom')
    );
    const res = await request(app).get(base);
    expect(res.status).toBe(500);
  });
});
