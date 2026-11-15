import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import { labComparisonResponseSchema } from '@workspace/shared';
import labRoutes from '../routes/v2/labResultRoutes.js';
import errorHandler from '../middleware/errorHandler.js';

// Supply synthetic authenticated identities; real profile-switch permission middleware and RLS remain active.
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.userId = id;
    req.authenticatedUserId = id;
    req.originalUserId = id;
    next();
  },
}));
const app = express();
app.use(express.json());
app.use('/api/v2/lab-results', labRoutes);
app.use(errorHandler);
import { getSystemClient, endPool } from '../db/poolManager.js';
import { listLatestLabPanels } from '../models/labResultRepository.js';
describe.runIf(process.env.LAB_COMPARISON_INTEGRATION === '1')(
  'latest imported lab panels PostgreSQL',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const newer = randomUUID(),
      older = randomUUID(),
      undated = randomUUID();
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
            [id, `lab-comparison-${id}@example.test`]
          );
        for (const [id, date] of [
          [newer, '2026-11-15'],
          [older, '2026-11-01'],
          [undated, null],
        ])
          await c.query(
            'INSERT INTO lab_reports(id,user_id,lab_name,collected_on) VALUES($1,$2,$3,$4)',
            [id, owner, 'Synthetic lab', date]
          );
        await c.query(
          "INSERT INTO lab_results(user_id,marker_key,entry_date,value_numeric,unit,source,report_id) SELECT $1,'sodium','2026-11-15',1,'mmol/L','report',$2 FROM generate_series(1,1001)",
          [owner, newer]
        );
        // A corrupt foreign association must not leak despite the report UUID being valid.
        await c.query(
          "INSERT INTO lab_results(user_id,marker_key,entry_date,value_numeric,unit,source,report_id) VALUES($1,'potassium','2026-11-15',999,'mmol/L','report',$2)",
          [other, newer]
        );
        await c.query(
          "INSERT INTO lab_results(user_id,marker_key,entry_date,value_numeric,unit,source) VALUES($1,'potassium','2026-11-15',1,'mmol/L','manual')",
          [owner]
        );
      } finally {
        c.release();
      }
    });
    afterAll(async () => {
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, other],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });
    it('preserves report groups, includes undated honestly, excludes ungrouped and foreign results', async () => {
      const result = await listLatestLabPanels(owner);
      expect(result.panels.map((p) => p.id)).toEqual([newer, older, undated]);
      expect(result.panels[2].collected_on).toBeNull();
      expect(result.panels[0].results).toHaveLength(1001);
      expect(
        result.panels
          .flatMap((p) => p.results)
          .every((r) => r.marker_key === 'sodium')
      ).toBe(true);
      expect((await listLatestLabPanels(other)).panels).toEqual([]);
    });
    it('serializes the real endpoint and enforces existing check-in access', async () => {
      const response = await request(app)
        .get('/api/v2/lab-results/panels/latest')
        .set('x-test-user', owner);
      expect(response.status).toBe(200);
      expect(labComparisonResponseSchema.safeParse(response.body).success).toBe(
        true
      );
      expect(response.body.panels[0].results).toHaveLength(1001);
      expect(response.body.panels[0]).not.toHaveProperty('user_id');
      expect(
        (
          await request(app)
            .get('/api/v2/lab-results/panels/latest')
            .set('x-test-user', other)
            .set('x-on-behalf-of-user-id', owner)
        ).status
      ).toBe(403);
    });
    it('caps reports at three with deterministic same-day ordering', async () => {
      const c = await getSystemClient();
      const a = '00000000-0000-4000-a000-000000000001',
        b = '00000000-0000-4000-a000-000000000002';
      try {
        for (const id of [a, b])
          await c.query(
            "INSERT INTO lab_reports(id,user_id,collected_on,created_at) VALUES($1,$2,'2026-11-20','2026-11-20T00:00:00Z')",
            [id, owner]
          );
      } finally {
        c.release();
      }
      expect(
        (await listLatestLabPanels(owner)).panels.map((p) => p.id)
      ).toEqual([b, a, newer]);
    });
  }
);
