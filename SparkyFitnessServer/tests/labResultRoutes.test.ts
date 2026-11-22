import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import errorHandler from '../middleware/errorHandler.js';
import labResultRoutes from '../routes/v2/labResultRoutes.js';
import * as labRepo from '../models/labResultRepository.js';

vi.mock('../models/labResultRepository.js', () => ({
  listLabMarkers: vi.fn(),
  listLabPanels: vi.fn(),
  createManualLabPanel: vi.fn(),
  deleteLabPanel: vi.fn(),
  listLatestLabPanels: vi.fn(),
  createLabMarker: vi.fn(),
  updateLabMarker: vi.fn(),
  deleteLabMarker: vi.fn(),
  listLabResults: vi.fn(),
  listLabExportRecords: vi.fn(),
  listLatestLabResults: vi.fn(),
  getLabResultById: vi.fn(),
  createLabResult: vi.fn(),
  updateLabResult: vi.fn(),
  deleteLabResult: vi.fn(),
  importLabReport: vi.fn(),
  deleteLabReports: vi.fn(),
  deleteResultsForMarkerKey: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: vi.fn(
    () =>
      (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction
      ) =>
        next()
  ),
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'Europe/London'),
}));

vi.mock('../middleware/onBehalfOfMiddleware.js', () => ({
  default: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api/v2/lab-results', labResultRoutes);
app.use(errorHandler);

const ID = uuidv4();
const result = {
  id: ID,
  user_id: 'test-user-id',
  marker_key: 'hba1c',
  custom_marker_id: null,
  entry_date: '2026-09-12',
  value_numeric: 5.1,
  value_text: null,
  unit: '%',
  ref_range_low: 4.8,
  ref_range_high: 5.6,
  lab_name: null,
  notes: null,
  source: 'manual' as const,
  created_at: '2026-09-12T10:00:00.000Z',
  updated_at: '2026-09-12T10:00:00.000Z',
};

describe('Lab result routes (v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('manual panels', () => {
    it('lists full real panel history', async () => {
      vi.mocked(labRepo.listLabPanels).mockResolvedValue({ panels: [] });
      expect(
        (await request(app).get('/api/v2/lab-results/panels')).body
      ).toEqual({ panels: [] });
      expect(labRepo.listLabPanels).toHaveBeenCalledWith(
        'test-user-id',
        'test-user-id'
      );
    });
    it('saves raw panel values through the actor-scoped repository', async () => {
      vi.mocked(labRepo.createManualLabPanel).mockResolvedValue({
        report: {
          id: ID,
          user_id: 'test-user-id',
          lab_name: null,
          collected_on: '2026-11-15',
          created_at: result.created_at,
          origin: 'manual',
        },
        results: [result],
      });
      const response = await request(app)
        .post('/api/v2/lab-results/panels')
        .send({
          entry_date: '2026-11-15',
          results: [{ marker_key: 'sodium', value_text: '<3', unit: 'mmol/L' }],
        });
      expect(response.status).toBe(201);
      expect(labRepo.createManualLabPanel).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({
          results: [expect.objectContaining({ value_text: '<3' })],
        }),
        'test-user-id'
      );
    });
    it('rejects a stale draft owner before any repository write', async () => {
      const response = await request(app)
        .post('/api/v2/lab-results/panels')
        .send({
          expected_owner_id: ID,
          entry_date: '2026-11-15',
          results: [
            {
              custom_marker_name: 'Synthetic race marker',
              value_text: 'Positive',
              unit: 'index',
            },
          ],
        });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        'The active profile changed. Review the panel again.'
      );
      expect(labRepo.createManualLabPanel).not.toHaveBeenCalled();
    });
    it('rejects duplicate markers before any write and scopes panel deletion', async () => {
      const row = { marker_key: 'sodium', value_text: '1', unit: 'mmol/L' };
      expect(
        (
          await request(app)
            .post('/api/v2/lab-results/panels')
            .send({ entry_date: '2026-11-15', results: [row, row] })
        ).status
      ).toBe(400);
      expect(labRepo.createManualLabPanel).not.toHaveBeenCalled();
      vi.mocked(labRepo.deleteLabPanel).mockResolvedValue(null);
      expect(
        (await request(app).delete(`/api/v2/lab-results/panels/${ID}`)).status
      ).toBe(404);
      expect(labRepo.deleteLabPanel).toHaveBeenCalledWith(
        'test-user-id',
        ID,
        'test-user-id'
      );
    });
  });

  describe('markers', () => {
    it('lists the custom markers', async () => {
      vi.mocked(labRepo.listLabMarkers).mockResolvedValue([]);
      const res = await request(app).get('/api/v2/lab-results/markers');
      expect(res.statusCode).toBe(200);
      expect(labRepo.listLabMarkers).toHaveBeenCalledWith(
        'test-user-id',
        'test-user-id'
      );
    });

    it('rejects a reversed range', async () => {
      const res = await request(app)
        .post('/api/v2/lab-results/markers')
        .send({ name: 'ApoB', ref_range_low: 9, ref_range_high: 3 });
      expect(res.statusCode).toBe(400);
      expect(labRepo.createLabMarker).not.toHaveBeenCalled();
    });

    it('creates a marker', async () => {
      vi.mocked(labRepo.createLabMarker).mockResolvedValue({
        id: ID,
        user_id: 'test-user-id',
        name: 'ApoB',
        unit: 'mg/dL',
        ref_range_low: null,
        ref_range_high: 90,
        created_at: result.created_at,
        updated_at: result.updated_at,
      });
      const res = await request(app)
        .post('/api/v2/lab-results/markers')
        .send({ name: 'ApoB', unit: 'mg/dL', ref_range_high: 90 });
      expect(res.statusCode).toBe(201);
      expect(labRepo.createLabMarker).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ name: 'ApoB', unit: 'mg/dL' }),
        'test-user-id'
      );
    });

    it('returns 404 for a malformed or unknown marker id', async () => {
      expect(
        (await request(app).delete('/api/v2/lab-results/markers/nope'))
          .statusCode
      ).toBe(404);
      vi.mocked(labRepo.deleteLabMarker).mockResolvedValue(false);
      expect(
        (await request(app).delete(`/api/v2/lab-results/markers/${ID}`))
          .statusCode
      ).toBe(404);
    });
  });

  describe('entries', () => {
    it('lists with filters and a default limit', async () => {
      vi.mocked(labRepo.listLabResults).mockResolvedValue([result]);
      const res = await request(app).get(
        '/api/v2/lab-results/entries?markerKey=hba1c'
      );
      expect(res.statusCode).toBe(200);
      expect(labRepo.listLabResults).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ markerKey: 'hba1c', limit: 1000 }),
        'test-user-id'
      );
    });

    it('returns 400 for conflicting filters', async () => {
      const res = await request(app).get(
        `/api/v2/lab-results/entries?markerKey=hba1c&markerId=${ID}`
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns the latest result per marker', async () => {
      vi.mocked(labRepo.listLatestLabResults).mockResolvedValue([result]);
      const res = await request(app).get('/api/v2/lab-results/latest');
      expect(res.body).toHaveLength(1);
    });

    it('creates several results for one marker on one day', async () => {
      vi.mocked(labRepo.createLabResult).mockResolvedValue(result);
      const body = {
        marker_key: 'hba1c',
        entry_date: '2026-09-12',
        value_numeric: 5.1,
        unit: '%',
      };
      expect(
        (await request(app).post('/api/v2/lab-results/entries').send(body))
          .statusCode
      ).toBe(201);
      expect(
        (await request(app).post('/api/v2/lab-results/entries').send(body))
          .statusCode
      ).toBe(201);
      expect(labRepo.createLabResult).toHaveBeenCalledTimes(2);
    });

    it('returns 400 for an invalid body', async () => {
      const res = await request(app)
        .post('/api/v2/lab-results/entries')
        .send({ marker_key: 'hba1c', entry_date: '2026-09-12' });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when the custom marker is not the user’s', async () => {
      vi.mocked(labRepo.createLabResult).mockResolvedValue(null);
      const res = await request(app).post('/api/v2/lab-results/entries').send({
        custom_marker_id: ID,
        entry_date: '2026-09-12',
        value_numeric: 3,
      });
      expect(res.statusCode).toBe(400);
    });

    it('updates a result and 404s when it is missing', async () => {
      vi.mocked(labRepo.updateLabResult).mockResolvedValueOnce(result);
      expect(
        (
          await request(app)
            .put(`/api/v2/lab-results/entries/${ID}`)
            .send({ notes: 'fasting' })
        ).statusCode
      ).toBe(200);
      vi.mocked(labRepo.updateLabResult).mockResolvedValueOnce(null);
      expect(
        (
          await request(app)
            .put(`/api/v2/lab-results/entries/${ID}`)
            .send({ notes: 'fasting' })
        ).statusCode
      ).toBe(404);
    });

    it('answers a database range violation with 400, not 500', async () => {
      const dbError = Object.assign(new Error('violates check constraint'), {
        code: '23514',
        constraint: 'lab_results_ref_range_check',
      });
      vi.mocked(labRepo.updateLabResult).mockRejectedValue(dbError);
      const res = await request(app)
        .put(`/api/v2/lab-results/entries/${ID}`)
        .send({ ref_range_high: 5 });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(
        'ref_range_low must not exceed ref_range_high'
      );
    });

    it('deletes a result', async () => {
      vi.mocked(labRepo.deleteLabResult).mockResolvedValue(true);
      const res = await request(app).delete(
        `/api/v2/lab-results/entries/${ID}`
      );
      expect(res.statusCode).toBe(200);
    });
  });

  describe('CSV download', () => {
    it('serves every result as a private CSV with the marker named', async () => {
      vi.mocked(labRepo.listLabExportRecords).mockResolvedValue([
        {
          entry_date: '2026-11-01',
          lab_name: 'Synthetic Lab',
          marker_key: 'hba1c',
          custom_marker_name: null,
          value_numeric: 6.1,
          value_text: null,
          unit: '%',
          ref_range_low: 4,
          ref_range_high: 5.6,
          source: 'report',
          notes: null,
        },
      ]);
      const response = await request(app).get('/api/v2/lab-results/export');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="lab-results-\d{4}-\d{2}-\d{2}\.csv"$/
      );
      expect(response.text).toBe(
        'collected_date,lab,marker,value,unit,reference_low,reference_high,flag,source,notes\r\n' +
          '2026-11-01,Synthetic Lab,HbA1c,6.1,%,4,5.6,high,report,\r\n'
      );
      expect(labRepo.listLabExportRecords).toHaveBeenCalledWith(
        'test-user-id',
        'test-user-id'
      );
    });
  });

  describe('imports', () => {
    const reportBody = {
      lab_name: 'Quest',
      entry_date: '2026-09-12',
      results: [
        { marker_key: 'hba1c', value_numeric: 5.1, unit: '%' },
        { marker_name: 'ApoB', value_numeric: 80, unit: 'mg/dL' },
      ],
    };

    it('saves a reviewed report', async () => {
      vi.mocked(labRepo.importLabReport).mockResolvedValue({
        report: {
          id: ID,
          user_id: 'test-user-id',
          lab_name: 'Quest',
          collected_on: '2026-09-12',
          created_at: result.created_at,
        },
        results: [result],
      });
      const res = await request(app)
        .post('/api/v2/lab-results/imports')
        .send(reportBody);
      expect(res.statusCode).toBe(201);
      expect(labRepo.importLabReport).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ entry_date: '2026-09-12' }),
        'test-user-id'
      );
    });

    it('rejects a result with both or neither marker, and an empty report', async () => {
      const post = (results: unknown[]) =>
        request(app)
          .post('/api/v2/lab-results/imports')
          .send({ entry_date: '2026-09-12', results });
      expect(
        (
          await post([
            { marker_key: 'hba1c', marker_name: 'x', value_numeric: 1 },
          ])
        ).statusCode
      ).toBe(400);
      expect((await post([{ value_numeric: 1 }])).statusCode).toBe(400);
      expect((await post([])).statusCode).toBe(400);
      expect(labRepo.importLabReport).not.toHaveBeenCalled();
    });

    it('deletes every import, or one report', async () => {
      vi.mocked(labRepo.deleteLabReports).mockResolvedValue({
        reports: 2,
        results: 9,
        markers: 1,
      });
      const all = await request(app).delete('/api/v2/lab-results/imports');
      expect(all.body).toEqual({ reports: 2, results: 9, markers: 1 });
      expect(labRepo.deleteLabReports).toHaveBeenLastCalledWith(
        'test-user-id',
        null,
        'test-user-id'
      );

      await request(app).delete(`/api/v2/lab-results/imports/${ID}`);
      expect(labRepo.deleteLabReports).toHaveBeenLastCalledWith(
        'test-user-id',
        ID,
        'test-user-id'
      );
    });

    it('answers 404 for an unknown or malformed report id', async () => {
      vi.mocked(labRepo.deleteLabReports).mockResolvedValue(null);
      expect(
        (await request(app).delete(`/api/v2/lab-results/imports/${ID}`))
          .statusCode
      ).toBe(404);
      expect(
        (await request(app).delete('/api/v2/lab-results/imports/nope'))
          .statusCode
      ).toBe(404);
    });
  });

  describe('deleting the results of a built-in marker', () => {
    it('deletes them by marker key', async () => {
      vi.mocked(labRepo.deleteResultsForMarkerKey).mockResolvedValue(3);
      const res = await request(app).delete(
        '/api/v2/lab-results/entries?markerKey=hba1c'
      );
      expect(res.body).toEqual({ results: 3 });
    });

    it('rejects a missing or unknown marker key', async () => {
      expect(
        (await request(app).delete('/api/v2/lab-results/entries')).statusCode
      ).toBe(400);
      expect(
        (
          await request(app).delete(
            '/api/v2/lab-results/entries?markerKey=nope'
          )
        ).statusCode
      ).toBe(400);
      expect(labRepo.deleteResultsForMarkerKey).not.toHaveBeenCalled();
    });
  });
});

describe('latest explicit report panels', () => {
  it('uses acting-user check-in access and returns the existing report groups', async () => {
    vi.mocked(labRepo.listLatestLabPanels).mockResolvedValue({ panels: [] });
    const response = await request(app).get(
      '/api/v2/lab-results/panels/latest'
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ panels: [] });
    expect(labRepo.listLatestLabPanels).toHaveBeenCalledWith(
      'test-user-id',
      'test-user-id'
    );
  });
});
