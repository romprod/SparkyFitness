import express from 'express';
// @ts-expect-error TS7016 cookie-parser has no declarations in this workspace.
import cookieParser from 'cookie-parser';
// @ts-expect-error TS7016 supertest has no declarations in this workspace.
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';

describe.runIf(process.env.PURCHASE_HTTP_INTEGRATION === '1')(
  'invoice real authentication HTTP PostgreSQL',
  () => {
    const owner = randomUUID(),
      delegate = randomUUID();
    let med: string;
    let fullKey: string;
    let readKey: string;
    let delegateKey: string;
    let app: express.Express;
    let purchaseId: string;
    const payload = (expected_owner_id = owner) => ({
      expected_owner_id,
      operation_id: randomUUID(),
      ordered_date: '2026-11-15',
      currency: 'AUD',
      items: [
        {
          kind: 'medication',
          medication_id: med,
          quantity: 1,
          unit_cost: '10',
          vial_ids: [],
        },
      ],
    });
    const count = async () => {
      const c = await getSystemClient();
      try {
        return (
          await c.query(
            'SELECT COUNT(*)::int AS count FROM medication_purchases WHERE user_id=$1',
            [owner]
          )
        ).rows[0].count as number;
      } finally {
        c.release();
      }
    };
    beforeAll(async () => {
      const c = await getSystemClient();
      try {
        for (const id of [owner, delegate])
          await c.query(
            'INSERT INTO public."user"(id,email,email_verified,name) VALUES($1,$2,true,$3)',
            [id, `purchase-http-${id}@example.test`, 'Synthetic HTTP owner']
          );
        med = (
          await c.query(
            "INSERT INTO medications(user_id,name,type_id) VALUES($1,'Synthetic HTTP medication','injection') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await c.query(
          "INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status) VALUES($1,$2,$3,$4::jsonb,true,'active')",
          [
            owner,
            delegate,
            `purchase-http-${delegate}@example.test`,
            JSON.stringify({ can_manage_medications: true }),
          ]
        );
      } finally {
        c.release();
      }
      const { auth } = await import('../auth.js');
      const makeKey = async (userId: string, write: boolean) => {
        // Same server-only key creation API used by the existing owner API-key route.
        // @ts-expect-error TS2339 the configured plugin endpoint is absent from inferred auth.api.
        const value = (await auth.api.createApiKey({
          body: {
            userId,
            name: 'Synthetic invoice HTTP scope',
            expiresIn: 31536000,
            permissions: { sparky: write ? ['read', 'write'] : ['read'] },
          },
        })) as { key?: string };
        if (typeof value.key !== 'string' || !value.key)
          throw new Error('Synthetic key creation failed');
        return value.key;
      };
      fullKey = await makeKey(owner, true);
      readKey = await makeKey(owner, false);
      delegateKey = await makeKey(delegate, true);
      const { default: router } =
        await import('../routes/v2/medicationPurchaseRoutes.js');
      const { default: errorHandler } =
        await import('../middleware/errorHandler.js');
      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/v2/medication-purchases', router);
      app.use(errorHandler);
      const created = await request(app)
        .post('/api/v2/medication-purchases')
        .set('x-api-key', fullKey)
        .send(payload());
      expect(created.status).toBe(201);
      purchaseId = created.body.id;
      expect(typeof purchaseId === 'string').toBe(true);
    }, 30000);
    afterAll(async () => {
      const { clearApiKeySessionCache } =
        await import('../utils/apiKeySessionCache.js');
      clearApiKeySessionCache();
      fullKey = '';
      readKey = '';
      delegateKey = '';
      const c = await getSystemClient();
      try {
        await c.query('DELETE FROM public."user" WHERE id=ANY($1::uuid[])', [
          [owner, delegate],
        ]);
      } finally {
        c.release();
        await endPool();
      }
    });
    it('authenticates full owner key and reads its created invoice through the real router', async () => {
      const result = await request(app)
        .get('/api/v2/medication-purchases/' + purchaseId)
        .set('x-api-key', fullKey)
        .query({ expected_owner_id: owner });
      expect(result.status).toBe(200);
      expect(result.body.id === purchaseId).toBe(true);
      expect(result.body.items.length).toBe(1);
      expect(await count()).toBe(1);
    });
    it('allows real read-only owner key reads and denies every financial write without changes', async () => {
      expect(
        (
          await request(app)
            .get('/api/v2/medication-purchases')
            .set('x-api-key', readKey)
        ).status
      ).toBe(200);
      const before = await count();
      expect(
        (
          await request(app)
            .post('/api/v2/medication-purchases')
            .set('x-api-key', readKey)
            .send(payload())
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch('/api/v2/medication-purchases/' + purchaseId)
            .set('x-api-key', readKey)
            .send({ ...payload(), expected_revision: 1 })
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .delete('/api/v2/medication-purchases/' + purchaseId)
            .set('x-api-key', readKey)
            .send({ expected_owner_id: owner, expected_revision: 1 })
        ).status
      ).toBe(403);
      expect(await count()).toBe(before);
    });
    it('denies real full delegate key in switched and on-behalf contexts despite medication permission', async () => {
      const before = await count();
      expect(
        (
          await request(app)
            .get('/api/v2/medication-purchases')
            .set('x-api-key', delegateKey)
            .set('Cookie', `sparky_active_user_id=${owner}`)
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v2/medication-purchases')
            .set('x-api-key', delegateKey)
            .set('x-on-behalf-of-user-id', owner)
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v2/medication-purchases')
            .set('x-api-key', delegateKey)
            .set('Cookie', `sparky_active_user_id=${owner}`)
            .send(payload())
        ).status
      ).toBe(403);
      expect(await count()).toBe(before);
    });
    it('rejects full owner key expected-owner mismatch with403 and no writes', async () => {
      const before = await count();
      expect(
        (
          await request(app)
            .post('/api/v2/medication-purchases')
            .set('x-api-key', fullKey)
            .send(payload(delegate))
        ).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v2/medication-purchases')
            .set('x-api-key', fullKey)
            .query({ expected_owner_id: delegate })
        ).status
      ).toBe(403);
      expect(await count()).toBe(before);
    });
  }
);
