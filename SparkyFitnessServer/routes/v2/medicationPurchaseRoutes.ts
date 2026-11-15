import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import {
  medicationPurchaseCreateSchema,
  medicationPurchaseUpdateSchema,
  medicationPurchaseDeleteSchema,
} from '@workspace/shared';
import * as purchases from '../../models/medicationPurchaseRepository.js';
import { authenticate } from '../../middleware/authMiddleware.js';

/** Existing app-wide owner API-key semantics apply: read-only keys may read self,
 * while authenticate blocks writes. Medication delegation never grants invoice access.
 * Financial data stays with the authenticated owner, including switched profiles. */
export const requirePurchaseOwner: RequestHandler = (req, res, next) => {
  const owner = req.authenticatedUserId || req.originalUserId || req.userId;
  const targets: unknown[] = [
    req.userId,
    req.originalUserId,
    req.headers['x-on-behalf-of-user-id'],
    req.query.userId,
    req.query.targetUserId,
    req.query.expected_owner_id,
    req.body?.user_id,
    req.body?.targetUserId,
    req.body?.expected_owner_id,
  ];
  const foreign = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(foreign)
      : typeof value === 'string' && value.length > 0 && value !== owner;
  if (!owner || targets.some(foreign)) {
    res
      .status(403)
      .json({ error: 'Medication purchases are private to their owner.' });
    return;
  }
  next();
};

const router = express.Router();
router.use(authenticate);
router.use(requirePurchaseOwner);

export const purchaseIdParamsSchema = z.object({ id: z.string().uuid() });
const editorQuerySchema = z.object({
  purchase_id: z.string().uuid().optional(),
});
router.get('/', async (req, res, next) => {
  try {
    res.json({ purchases: await purchases.listPurchases(req.userId) });
  } catch (error) {
    next(error);
  }
});
router.get('/editor-data', async (req, res, next) => {
  try {
    const query = editorQuerySchema.safeParse(req.query);
    if (!query.success) {
      res
        .status(400)
        .json({ error: 'Invalid request', details: query.error.flatten() });
      return;
    }
    res.json(await purchases.getEditorData(req.userId, query.data.purchase_id));
  } catch (error) {
    next(error);
  }
});
router.get('/vial-costs', async (req, res, next) => {
  try {
    res.json({ vials: await purchases.getVialCosts(req.userId) });
  } catch (error) {
    next(error);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    const params = purchaseIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Invalid purchase ID' });
      return;
    }
    const result = await purchases.getPurchase(req.userId, params.data.id);
    if (!result) {
      res.status(404).json({ error: 'Purchase not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.post('/', async (req, res, next) => {
  try {
    const body = medicationPurchaseCreateSchema.safeParse(req.body);
    if (!body.success) {
      res
        .status(400)
        .json({ error: 'Invalid request', details: body.error.flatten() });
      return;
    }
    res.status(201).json(await purchases.createPurchase(req.userId, body.data));
  } catch (error) {
    next(error);
  }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const params = purchaseIdParamsSchema.safeParse(req.params);
    const body = medicationPurchaseUpdateSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const result = await purchases.updatePurchase(
      req.userId,
      params.data.id,
      body.data
    );
    if (!result) {
      res.status(404).json({ error: 'Purchase not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const params = purchaseIdParamsSchema.safeParse(req.params);
    const body = medicationPurchaseDeleteSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const result = await purchases.deletePurchase(
      req.userId,
      params.data.id,
      body.data
    );
    if (!result) {
      res.status(404).json({ error: 'Purchase not found.' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
export default router;
