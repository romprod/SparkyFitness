import { randomUUID } from 'node:crypto';
import express from 'express';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createManualLabPanelBodySchema } from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import {
  createManualLabPanel,
  deleteLabPanel,
  deleteLabReports,
  importLabReport,
  listLabPanels,
  listLatestLabPanels,
} from '../models/labResultRepository.js';
import labRoutes from '../routes/v2/labResultRoutes.js';
import errorHandler from '../middleware/errorHandler.js';
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.sendStatus(401);
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

describe.runIf(process.env.MANUAL_LAB_PANELS_INTEGRATION === '1')(
  'manual panels real PostgreSQL/RLS',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const draft = (results: unknown[]) =>
      createManualLabPanelBodySchema.parse({
        entry_date: '2026-11-15',
        lab_name: 'Synthetic lab',
        notes: 'Synthetic panel note',
        results,
      });
    const raw = {
      marker_key: 'sodium',
      value_text: '<3',
      value_numeric: 3,
      unit: 'mmol/L',
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, other])
          await c.query(
            'INSERT INTO public."user" (id,email,email_verified) VALUES ($1,$2,true)',
            [id, `manual-panel-${id}@example.test`]
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
    it('persists raw qualifiers/categories, exact decimals, notes and real groups in full history', async () => {
      const saved = await createManualLabPanel(
        owner,
        draft([
          raw,
          {
            custom_marker_name: 'Synthetic category',
            value_text: 'Positive',
            unit: 'index',
          },
          { marker_key: 'potassium', value_text: '4.1', unit: 'mmol/L' },
        ])
      );
      expect(saved.report).toMatchObject({
        origin: 'manual',
        notes: 'Synthetic panel note',
        collected_on: '2026-11-15',
      });
      expect(
        saved.results.map((r) => [r.value_text, r.value_numeric, r.unit])
      ).toEqual([
        ['<3', null, 'mmol/L'],
        ['Positive', null, 'index'],
        ['4.1', 4.1, 'mmol/L'],
      ]);
      expect(
        (await listLatestLabPanels(owner)).panels.some(
          (p) => p.id === saved.report.id
        )
      ).toBe(true);
      expect((await listLabPanels(other)).panels).toEqual([]);
      await deleteLabPanel(owner, saved.report.id);
    });
    it('rolls back all rows and created markers on a late owned-ID duplicate or foreign marker', async () => {
      const foreign = await createManualLabPanel(
        other,
        draft([
          {
            custom_marker_name: 'Foreign synthetic',
            value_text: '1',
            unit: '',
          },
        ])
      );
      const foreignId = foreign.results[0].custom_marker_id;
      const before = await listLabPanels(owner);
      await expect(
        createManualLabPanel(
          owner,
          draft([
            {
              custom_marker_name: 'Rollback synthetic',
              value_text: '1',
              unit: '',
            },
            { custom_marker_id: foreignId, value_text: '2', unit: '' },
          ])
        )
      ).rejects.toThrow('Unknown custom marker');
      expect(await listLabPanels(owner)).toEqual(before);
      const own = await createManualLabPanel(
        owner,
        draft([
          { custom_marker_name: 'Owned synthetic', value_text: '1', unit: '' },
        ])
      );
      await expect(
        createManualLabPanel(
          owner,
          draft([
            {
              custom_marker_id: own.results[0].custom_marker_id,
              value_text: '1',
              unit: '',
            },
            {
              custom_marker_name: 'owned synthetic',
              value_text: '2',
              unit: '',
            },
          ])
        )
      ).rejects.toThrow('Duplicate marker');
      const c = await getSystemClient();
      try {
        expect(
          (
            await c.query(
              "SELECT id FROM lab_markers WHERE user_id=$1 AND name='Rollback synthetic'",
              [owner]
            )
          ).rowCount
        ).toBe(0);
      } finally {
        c.release();
      }
      await deleteLabPanel(owner, own.report.id);
      await deleteLabPanel(other, foreign.report.id);
    });
    it('bulk import delete keeps manual panels, their rows and shared custom markers', async () => {
      const manual = await createManualLabPanel(
        owner,
        draft([
          {
            custom_marker_name: 'Shared synthetic',
            value_text: 'Positive',
            unit: 'index',
          },
        ])
      );
      await importLabReport(owner, {
        entry_date: '2026-11-14',
        results: [
          { marker_name: 'Shared synthetic', value_numeric: 1, unit: 'index' },
        ],
      });
      expect(await deleteLabReports(owner, manual.report.id)).toBeNull();
      expect(await deleteLabReports(owner, null)).toMatchObject({
        reports: 1,
        results: 1,
        markers: 0,
      });
      const history = await listLabPanels(owner);
      expect(history.panels).toHaveLength(1);
      expect(history.panels[0].id).toBe(manual.report.id);
      expect(history.panels[0].results).toHaveLength(1);
      expect(await deleteLabPanel(other, manual.report.id)).toBeNull();
      expect(await deleteLabPanel(owner, manual.report.id)).toMatchObject({
        reports: 1,
        results: 1,
        markers: 1,
      });
    });
    it('rejects an owner switch after a draft opens without reports, results or custom marker writes', async () => {
      const c = await getSystemClient();
      const counts = async () =>
        (
          await c.query(
            'SELECT (SELECT count(*) FROM lab_reports WHERE user_id=ANY($1::uuid[]))::int AS reports,(SELECT count(*) FROM lab_results WHERE user_id=ANY($1::uuid[]))::int AS results,(SELECT count(*) FROM lab_markers WHERE user_id=ANY($1::uuid[]))::int AS markers',
            [[owner, other]]
          )
        ).rows[0];
      try {
        const before = await counts();
        const response = await request(app)
          .post('/api/v2/lab-results/panels')
          .set('x-test-user', other)
          .send({
            ...draft([
              {
                custom_marker_name: 'Synthetic owner race marker',
                value_text: 'Positive',
                unit: 'index',
              },
            ]),
            expected_owner_id: owner,
          });
        expect(response.status).toBe(409);
        expect(await counts()).toEqual(before);
        const matching = await request(app)
          .post('/api/v2/lab-results/panels')
          .set('x-test-user', owner)
          .send({ ...draft([raw]), expected_owner_id: owner });
        expect(matching.status).toBe(201);
        expect(matching.body.report.user_id).toBe(owner);
        await deleteLabPanel(owner, matching.body.report.id);
      } finally {
        c.release();
      }
    });
    it('allows a check-in delegate to create, read and delete an owner panel with attribution', async () => {
      const c = await getSystemClient();
      try {
        await c.query(
          "INSERT INTO public.family_access (owner_user_id,family_user_id,family_email,access_permissions,is_active,status) VALUES ($1,$2,$3,$4::jsonb,true,'active')",
          [
            owner,
            other,
            `delegate-${other}@example.test`,
            JSON.stringify({ can_manage_checkin: true }),
          ]
        );
      } finally {
        c.release();
      }
      try {
        const saved = await request(app)
          .post('/api/v2/lab-results/panels')
          .set('x-test-user', other)
          .set('x-on-behalf-of-user-id', owner)
          .send({ ...draft([raw]), expected_owner_id: owner });
        expect(saved.status).toBe(201);
        expect(saved.body.report.user_id).toBe(owner);
        const history = await request(app)
          .get('/api/v2/lab-results/panels')
          .set('x-test-user', other)
          .set('x-on-behalf-of-user-id', owner);
        expect(history.status).toBe(200);
        expect(
          history.body.panels.some(
            (p: { id: string }) => p.id === saved.body.report.id
          )
        ).toBe(true);
        const inspect = await getSystemClient();
        try {
          expect(
            (
              await inspect.query(
                'SELECT created_by_user_id FROM lab_reports WHERE id=$1',
                [saved.body.report.id]
              )
            ).rows[0].created_by_user_id
          ).toBe(other);
        } finally {
          inspect.release();
        }
        expect(
          (
            await request(app)
              .delete(`/api/v2/lab-results/panels/${saved.body.report.id}`)
              .set('x-test-user', other)
              .set('x-on-behalf-of-user-id', owner)
          ).status
        ).toBe(200);
      } finally {
        const clean = await getSystemClient();
        try {
          await clean.query(
            'DELETE FROM family_access WHERE owner_user_id=$1 AND family_user_id=$2',
            [owner, other]
          );
        } finally {
          clean.release();
        }
      }
    });
    it('HTTP endpoints deny unrelated profile reads/writes/deletes through actual permission middleware', async () => {
      for (const method of ['get', 'post', 'delete'] as const) {
        const url =
          method === 'delete'
            ? `/api/v2/lab-results/panels/${randomUUID()}`
            : '/api/v2/lab-results/panels';
        const client = request(app);
        const req = client[method](url)
          .set('x-test-user', other)
          .set('x-on-behalf-of-user-id', owner);
        const response = await (method === 'post'
          ? req.send(draft([raw]))
          : req);
        expect(response.status).toBe(403);
      }
    });
  }
);
