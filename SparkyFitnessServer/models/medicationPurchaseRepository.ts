import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  allocateMedicationPurchase,
  medicationPurchaseInputSchema,
  medicationPurchaseCreateSchema,
  medicationPurchaseUpdateSchema,
  medicationPurchaseDeleteSchema,
  type MedicationPurchaseValues,
  type MedicationPurchaseCreateInput,
  type MedicationPurchaseUpdateInput,
  type MedicationPurchaseDeleteInput,
  type MedicationPurchaseView,
  type MedicationPurchaseItem,
  type MedicationPurchaseEditorData,
  type MedicationVialCost,
  type MedicationPackCost,
  packUnitCost,
} from '@workspace/shared';
import { getClient, dbContextStorage } from '../db/poolManager.js';
import { encrypt, decrypt, ENCRYPTION_KEY } from '../security/encryption.js';
const problem = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });
export function assertMedicationFinancialOwner(
  userId: string,
  expectedOwnerId?: string
) {
  const actor = dbContextStorage.getStore()?.authenticatedUserId ?? userId;
  if (
    actor !== userId ||
    (expectedOwnerId !== undefined && expectedOwnerId !== userId)
  )
    throw problem(
      'Purchases are only available for the expected signed-in owner.',
      403
    );
}
const assertOwner = assertMedicationFinancialOwner;
interface Envelope {
  encryptedText: string | null;
  iv: string | null;
  tag: string | null;
}
interface HeaderRow {
  id: string;
  user_id: string;
  vendor: string | null;
  reference_encrypted: Envelope | null;
  ordered_date: string;
  received_date: string | null;
  currency: string;
  shipping_cost: string;
  tax_cost: string;
  other_fees: string;
  discount: string;
  allocation_method: 'value' | 'quantity' | 'none';
  notes_encrypted: Envelope | null;
  revision: number;
  created_at: string;
}
type ItemRow = MedicationPurchaseItem & {
  purchase_id: string;
  sort_index: number;
};
interface PackRow {
  id: string;
  medication_id: string;
}
interface PenRow {
  id: string;
  medication_id: string;
  kind: string;
}
const HEADER_COLS =
  'id,user_id,vendor,reference_encrypted,ordered_date::text,received_date::text,currency,shipping_cost::text,tax_cost::text,other_fees::text,discount::text,allocation_method,notes_encrypted,revision,created_at::text';
const ITEM_COLS = `i.id,i.purchase_id,i.kind,i.medication_id,i.category,i.description,i.quantity,i.unit_cost::text,i.units_per_pack,i.units_per_dose::text,i.sort_index,m.name AS medication_name,
 COALESCE((SELECT array_agg(v.pen_id ORDER BY v.pen_id) FROM medication_purchase_vials v WHERE v.purchase_item_id=i.id AND v.user_id=i.user_id),ARRAY[]::uuid[]) AS vial_ids,
 COALESCE((SELECT array_agg(k.pack_id ORDER BY k.pack_id) FROM medication_purchase_packs k WHERE k.purchase_item_id=i.id AND k.user_id=i.user_id),ARRAY[]::uuid[]) AS pack_ids`;
async function encode(value: string | null): Promise<Envelope | null> {
  return value ? ((await encrypt(value, ENCRYPTION_KEY)) as Envelope) : null;
}
async function decode(value: Envelope | null): Promise<string | null> {
  return value
    ? ((await decrypt(
        value.encryptedText,
        value.iv,
        value.tag,
        ENCRYPTION_KEY
      )) as string | null)
    : null;
}
async function readPurchases(
  client: PoolClient,
  userId: string,
  id?: string
): Promise<MedicationPurchaseView[]> {
  const headers = await client.query<HeaderRow>(
    `SELECT ${HEADER_COLS} FROM medication_purchases WHERE user_id=$1${id ? ' AND id=$2' : ''} ORDER BY ordered_date DESC,created_at DESC,id`,
    id ? [userId, id] : [userId]
  );
  if (!headers.rows.length) return [];
  const items = await client.query<ItemRow>(
    `SELECT ${ITEM_COLS} FROM medication_purchase_items i LEFT JOIN medications m ON m.id=i.medication_id AND m.user_id=i.user_id WHERE i.user_id=$1 AND i.purchase_id=ANY($2::uuid[]) ORDER BY i.sort_index,i.id`,
    [userId, headers.rows.map((h) => h.id)]
  );
  return Promise.all(
    headers.rows.map(async (header) => {
      const rows = items.rows.filter((item) => item.purchase_id === header.id);
      const totals = allocateMedicationPurchase({
        ...header,
        lines: rows.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        })),
      });
      const allocated = new Map(totals.lines.map((line) => [line.id, line]));
      const lines: MedicationPurchaseItem[] = rows.map(
        ({ purchase_id: _parent, sort_index: _sort, ...item }) => ({
          ...item,
          ...allocated.get(item.id)!,
        })
      );
      return {
        id: header.id,
        vendor: header.vendor,
        reference: await decode(header.reference_encrypted),
        ordered_date: header.ordered_date,
        received_date: header.received_date,
        currency: header.currency,
        shipping_cost: header.shipping_cost,
        tax_cost: header.tax_cost,
        other_fees: header.other_fees,
        discount: header.discount,
        allocation_method: header.allocation_method,
        notes: await decode(header.notes_encrypted),
        revision: header.revision,
        created_at: header.created_at,
        items: lines,
        totals,
        vials_expected: lines
          .filter((line) => line.kind === 'medication')
          .reduce((sum, line) => sum + line.quantity, 0),
        vials_linked: lines
          .filter((line) => line.kind === 'medication')
          .reduce((sum, line) => sum + line.vial_ids.length, 0),
        packs_linked: lines
          .filter((line) => line.kind === 'medication')
          .reduce((sum, line) => sum + line.pack_ids.length, 0),
      };
    })
  );
}
async function readSnapshot<T>(
  userId: string,
  read: (client: PoolClient) => Promise<T>
): Promise<T> {
  assertOwner(userId);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function listPurchases(userId: string) {
  return readSnapshot(userId, (client) => readPurchases(client, userId));
}
export async function getPurchase(userId: string, id: string) {
  return readSnapshot(
    userId,
    async (client) => (await readPurchases(client, userId, id))[0] ?? null
  );
}
export async function getEditorData(
  userId: string,
  purchaseId?: string
): Promise<MedicationPurchaseEditorData> {
  return readSnapshot(userId, async (client) => {
    if (
      purchaseId &&
      !(
        await client.query(
          'SELECT id FROM medication_purchases WHERE id=$1 AND user_id=$2',
          [purchaseId, userId]
        )
      ).rowCount
    )
      throw problem('Invoice not found.', 404);
    const medications = await client.query<
      MedicationPurchaseEditorData['medications'][number]
    >('SELECT id,name FROM medications WHERE user_id=$1 ORDER BY name,id', [
      userId,
    ]);
    const vials = await client.query<
      MedicationPurchaseEditorData['vials'][number]
    >(
      "SELECT p.id,p.medication_id,m.name AS medication_name,p.label,p.label_mass_mg::text,prep.mass_mg::text AS prepared_mass_mg,p.status,p.lot_number,p.expiry_date::text,v.purchase_item_id FROM medication_pens p JOIN medications m ON m.id=p.medication_id AND m.user_id=p.user_id LEFT JOIN medication_preparations prep ON prep.pen_id=p.id AND prep.user_id=p.user_id AND prep.medication_id=p.medication_id LEFT JOIN medication_purchase_vials v ON v.pen_id=p.id AND v.user_id=p.user_id LEFT JOIN medication_purchase_items i ON i.id=v.purchase_item_id AND i.user_id=v.user_id WHERE p.user_id=$1 AND p.kind='vial' AND (v.pen_id IS NULL OR i.purchase_id=$2) ORDER BY p.status,m.name,p.id",
      [userId, purchaseId ?? null]
    );
    const packs = await client.query<
      MedicationPurchaseEditorData['packs'][number]
    >(
      'SELECT p.id,p.medication_id,m.name AS medication_name,p.label,p.unit_label,p.units_total::text,p.status,p.lot_number,p.expiry_date::text,k.purchase_item_id FROM medication_packs p JOIN medications m ON m.id=p.medication_id AND m.user_id=p.user_id LEFT JOIN medication_purchase_packs k ON k.pack_id=p.id AND k.user_id=p.user_id LEFT JOIN medication_purchase_items i ON i.id=k.purchase_item_id AND i.user_id=k.user_id WHERE p.user_id=$1 AND (k.pack_id IS NULL OR i.purchase_id=$2) ORDER BY p.status,m.name,p.id',
      [userId, purchaseId ?? null]
    );
    return {
      medications: medications.rows,
      vials: vials.rows,
      packs: packs.rows,
    };
  });
}
export async function getVialCosts(
  userId: string
): Promise<MedicationVialCost[]> {
  return readSnapshot(userId, async (client) => {
    const invoices = await readPurchases(client, userId);
    const costs = new Map<string, MedicationVialCost>();
    for (const invoice of invoices)
      for (const item of invoice.items)
        for (const penId of item.vial_ids)
          costs.set(penId, {
            pen_id: penId,
            is_costed: true,
            purchase_id: invoice.id,
            purchase_item_id: item.id,
            currency: invoice.currency,
            landed_unit: item.landed_unit,
          });
    const pens = await client.query<{ id: string }>(
      "SELECT id FROM medication_pens WHERE user_id=$1 AND kind='vial' ORDER BY id",
      [userId]
    );
    return pens.rows.map(
      (pen) => costs.get(pen.id) ?? { pen_id: pen.id, is_costed: false }
    );
  });
}
export async function getPackCosts(
  userId: string
): Promise<MedicationPackCost[]> {
  return readSnapshot(userId, async (client) => {
    const invoices = await readPurchases(client, userId);
    const linked = new Map<
      string,
      {
        purchase_id: string;
        item_id: string;
        currency: string;
        landed: string | null;
      }
    >();
    for (const invoice of invoices)
      for (const item of invoice.items)
        for (const packId of item.pack_ids)
          linked.set(packId, {
            purchase_id: invoice.id,
            item_id: item.id,
            currency: invoice.currency,
            landed: item.landed_unit,
          });
    const packs = await client.query<{
      id: string;
      units_total: string;
      units_used: string;
    }>(
      'SELECT id,units_total::text,units_used::text FROM medication_packs WHERE user_id=$1 ORDER BY id',
      [userId]
    );
    return packs.rows.map((pack): MedicationPackCost => {
      const link = linked.get(pack.id);
      if (!link) return { pack_id: pack.id, is_costed: false };
      const cost = packUnitCost({
        landedPack: link.landed,
        unitsTotal: pack.units_total,
        unitsUsed: pack.units_used,
      });
      return {
        pack_id: pack.id,
        is_costed: true,
        purchase_id: link.purchase_id,
        purchase_item_id: link.item_id,
        currency: link.currency,
        landed_pack: link.landed,
        landed_per_unit: cost?.perUnit ?? null,
        consumed: cost?.consumed ?? null,
      };
    });
  });
}
function normalized(input: unknown): MedicationPurchaseValues {
  const data = medicationPurchaseInputSchema.parse(input);
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      vial_ids: [...new Set(item.vial_ids)],
      pack_ids: [...new Set(item.pack_ids)],
      medication_id:
        item.kind === 'medication' ? (item.medication_id ?? null) : null,
      category:
        item.kind === 'consumable' ? (item.category ?? 'other') : undefined,
      description:
        item.description || (item.kind === 'medication' ? 'Medication' : ''),
      units_per_pack: item.kind === 'consumable' ? item.units_per_pack : null,
      units_per_dose: item.kind === 'consumable' ? item.units_per_dose : null,
    })),
  };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
async function advisory(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `medication-purchases:${userId}`,
  ]);
  const account = await client.query(
    'SELECT id FROM public."user" WHERE id=$1 FOR KEY SHARE',
    [userId]
  );
  if (!account.rowCount) throw problem('Account not found.', 404);
}
async function lockContext(
  client: PoolClient,
  userId: string,
  id?: string,
  data?: MedicationPurchaseValues
) {
  const existing = await client.query<{
    id: string;
    medication_id: string | null;
    kind: 'medication' | 'consumable';
  }>(
    'SELECT id,medication_id,kind FROM medication_purchase_items WHERE user_id=$1 AND purchase_id=$2 ORDER BY id',
    [userId, id ?? null]
  );
  const initial = await client.query<{ pen_id: string }>(
    'SELECT v.pen_id FROM medication_purchase_vials v JOIN medication_purchase_items i ON i.id=v.purchase_item_id AND i.user_id=v.user_id WHERE v.user_id=$1 AND i.purchase_id=$2 ORDER BY v.pen_id',
    [userId, id ?? null]
  );
  const initialPacks = await client.query<{ pack_id: string }>(
    'SELECT k.pack_id FROM medication_purchase_packs k JOIN medication_purchase_items i ON i.id=k.purchase_item_id AND i.user_id=k.user_id WHERE k.user_id=$1 AND i.purchase_id=$2 ORDER BY k.pack_id',
    [userId, id ?? null]
  );
  const lineIds =
    data?.items.flatMap((item) => (item.id ? [item.id] : [])) ?? [];
  if (new Set(lineIds).size !== lineIds.length)
    throw problem('The same invoice line appears more than once.');
  const requested = data?.items.flatMap((item) => item.vial_ids) ?? [];
  if (new Set(requested).size !== requested.length)
    throw problem('The same vial is matched to more than one line.');
  const requestedPacks = data?.items.flatMap((item) => item.pack_ids) ?? [];
  if (new Set(requestedPacks).size !== requestedPacks.length)
    throw problem('The same pack is matched to more than one line.');
  const packIds = [
    ...new Set([...initialPacks.rows.map((k) => k.pack_id), ...requestedPacks]),
  ].sort();
  const packReferences = await client.query<PackRow>(
    'SELECT id,medication_id FROM medication_packs WHERE user_id=$1 AND id=ANY($2::uuid[])',
    [userId, packIds]
  );
  const penIds = [
    ...new Set([...initial.rows.map((v) => v.pen_id), ...requested]),
  ].sort();
  const references = await client.query<PenRow>(
    'SELECT id,medication_id,kind FROM medication_pens WHERE user_id=$1 AND id=ANY($2::uuid[])',
    [userId, penIds]
  );
  const medIds = [
    ...new Set([
      ...existing.rows.flatMap((item) =>
        item.medication_id ? [item.medication_id] : []
      ),
      ...(data?.items.flatMap((item) =>
        item.medication_id ? [item.medication_id] : []
      ) ?? []),
      ...references.rows.map((pen) => pen.medication_id),
      ...packReferences.rows.map((pack) => pack.medication_id),
    ]),
  ].sort();
  const medications = await client.query<{ id: string }>(
    'SELECT id FROM medications WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR KEY SHARE',
    [userId, medIds]
  );
  const pens = await client.query<PenRow>(
    'SELECT id,medication_id,kind FROM medication_pens WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
    [userId, penIds]
  );
  const packs = await client.query<PackRow>(
    'SELECT id,medication_id FROM medication_packs WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR KEY SHARE',
    [userId, packIds]
  );
  const header = id
    ? (
        await client.query<HeaderRow>(
          `SELECT ${HEADER_COLS} FROM medication_purchases WHERE user_id=$1 AND id=$2 FOR UPDATE`,
          [userId, id]
        )
      ).rows[0]
    : undefined;
  if (id && !header) throw problem('Invoice not found.', 404);
  const items = await client.query<{
    id: string;
    medication_id: string | null;
    kind: 'medication' | 'consumable';
  }>(
    'SELECT id,medication_id,kind FROM medication_purchase_items WHERE user_id=$1 AND purchase_id=$2 ORDER BY id FOR UPDATE',
    [userId, id ?? null]
  );
  const current = await client.query<{ pen_id: string }>(
    'SELECT v.pen_id FROM medication_purchase_vials v JOIN medication_purchase_items i ON i.id=v.purchase_item_id AND i.user_id=v.user_id WHERE v.user_id=$1 AND i.purchase_id=$2 ORDER BY v.pen_id',
    [userId, id ?? null]
  );
  const currentPacks = await client.query<{ pack_id: string }>(
    'SELECT k.pack_id FROM medication_purchase_packs k JOIN medication_purchase_items i ON i.id=k.purchase_item_id AND i.user_id=k.user_id WHERE k.user_id=$1 AND i.purchase_id=$2 ORDER BY k.pack_id',
    [userId, id ?? null]
  );
  if (
    canonical(initial.rows) !== canonical(current.rows) ||
    canonical(initialPacks.rows) !== canonical(currentPacks.rows)
  )
    throw problem('Inventory links changed. Reload the invoice.', 409);
  if (data) {
    const byItem = new Map(items.rows.map((item) => [item.id, item]));
    const medSet = new Set(medications.rows.map((m) => m.id));
    const byPen = new Map(pens.rows.map((pen) => [pen.id, pen]));
    const byPack = new Map(packs.rows.map((pack) => [pack.id, pack]));
    for (const item of data.items) {
      if (item.id && !byItem.has(item.id))
        throw problem('An invoice line does not belong to this invoice.');
      if (item.kind === 'medication') {
        if (!item.medication_id) {
          if (
            !item.id ||
            byItem.get(item.id)?.kind !== 'medication' ||
            byItem.get(item.id)?.medication_id !== null
          )
            throw problem('Choose a medication for this line.');
        } else if (!medSet.has(item.medication_id))
          throw problem('Medication not found.');
      } else if (item.vial_ids.length || item.pack_ids.length)
        throw problem('Consumable lines cannot match vials or packs.');
      for (const penId of item.vial_ids) {
        const pen = byPen.get(penId);
        if (
          !pen ||
          pen.kind !== 'vial' ||
          pen.medication_id !== item.medication_id
        )
          throw problem(
            'A matched vial is missing or is a different medication.'
          );
      }
    }
    for (const item of data.items)
      for (const packId of item.pack_ids) {
        const pack = byPack.get(packId);
        if (!pack || pack.medication_id !== item.medication_id)
          throw problem(
            'A matched pack is missing or is a different medication.'
          );
      }
    const packClaims = await client.query<{ purchase_id: string }>(
      'SELECT i.purchase_id FROM medication_purchase_packs k JOIN medication_purchase_items i ON i.id=k.purchase_item_id AND i.user_id=k.user_id WHERE k.user_id=$1 AND k.pack_id=ANY($2::uuid[])',
      [userId, requestedPacks]
    );
    if (packClaims.rows.some((claim) => claim.purchase_id !== id))
      throw problem('A matched pack is already on another invoice.', 409);
    const claims = await client.query<{ pen_id: string; purchase_id: string }>(
      'SELECT v.pen_id,i.purchase_id FROM medication_purchase_vials v JOIN medication_purchase_items i ON i.id=v.purchase_item_id AND i.user_id=v.user_id WHERE v.user_id=$1 AND v.pen_id=ANY($2::uuid[])',
      [userId, requested]
    );
    if (claims.rows.some((claim) => claim.purchase_id !== id))
      throw problem('A matched vial is already on another invoice.', 409);
  }
  return { header, items: items.rows };
}
async function writePurchase(
  client: PoolClient,
  userId: string,
  id: string,
  data: MedicationPurchaseValues,
  expectedRevision?: number
) {
  const reference = await encode(data.reference),
    notes = await encode(data.notes);
  const values = [
    userId,
    id,
    data.vendor,
    reference,
    data.ordered_date,
    data.received_date,
    data.currency,
    data.shipping_cost,
    data.tax_cost,
    data.other_fees,
    data.discount,
    data.allocation_method,
    notes,
  ];
  if (expectedRevision === undefined)
    await client.query(
      'INSERT INTO medication_purchases(user_id,id,vendor,reference_encrypted,ordered_date,received_date,currency,shipping_cost,tax_cost,other_fees,discount,allocation_method,notes_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      values
    );
  else {
    const result = await client.query(
      'UPDATE medication_purchases SET vendor=$3,reference_encrypted=$4,ordered_date=$5,received_date=$6,currency=$7,shipping_cost=$8,tax_cost=$9,other_fees=$10,discount=$11,allocation_method=$12,notes_encrypted=$13,revision=revision+1 WHERE user_id=$1 AND id=$2 AND revision=$14 RETURNING id',
      [...values, expectedRevision]
    );
    if (!result.rowCount)
      throw problem('Invoice changed. Reload before saving.', 409);
  }
  await client.query(
    'DELETE FROM medication_purchase_vials WHERE user_id=$1 AND purchase_item_id IN (SELECT id FROM medication_purchase_items WHERE purchase_id=$2 AND user_id=$1)',
    [userId, id]
  );
  await client.query(
    'DELETE FROM medication_purchase_packs WHERE user_id=$1 AND purchase_item_id IN (SELECT id FROM medication_purchase_items WHERE purchase_id=$2 AND user_id=$1)',
    [userId, id]
  );
  const kept: string[] = [];
  for (const [index, item] of data.items.entries()) {
    const itemId = item.id ?? randomUUID();
    kept.push(itemId);
    const fields = [
      userId,
      id,
      itemId,
      item.kind,
      item.medication_id ?? null,
      item.kind === 'consumable' ? (item.category ?? 'other') : null,
      item.description,
      item.quantity,
      item.unit_cost,
      item.units_per_pack,
      item.units_per_dose,
      index,
    ];
    await client.query(
      'INSERT INTO medication_purchase_items(user_id,purchase_id,id,kind,medication_id,category,description,quantity,unit_cost,units_per_pack,units_per_dose,sort_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,medication_id=EXCLUDED.medication_id,category=EXCLUDED.category,description=EXCLUDED.description,quantity=EXCLUDED.quantity,unit_cost=EXCLUDED.unit_cost,units_per_pack=EXCLUDED.units_per_pack,units_per_dose=EXCLUDED.units_per_dose,sort_index=EXCLUDED.sort_index WHERE medication_purchase_items.user_id=$1 AND medication_purchase_items.purchase_id=$2',
      fields
    );
    for (const penId of item.vial_ids)
      await client.query(
        'INSERT INTO medication_purchase_vials(user_id,pen_id,purchase_item_id) VALUES($1,$2,$3)',
        [userId, penId, itemId]
      );
    for (const packId of item.pack_ids)
      await client.query(
        'INSERT INTO medication_purchase_packs(user_id,pack_id,purchase_item_id) VALUES($1,$2,$3)',
        [userId, packId, itemId]
      );
  }
  await client.query(
    'DELETE FROM medication_purchase_items WHERE user_id=$1 AND purchase_id=$2 AND NOT(id=ANY($3::uuid[]))',
    [userId, id, kept]
  );
}
export async function createPurchase(
  userId: string,
  input: MedicationPurchaseCreateInput
): Promise<MedicationPurchaseView> {
  const parsed = medicationPurchaseCreateSchema.parse(input);
  assertOwner(userId, parsed.expected_owner_id);
  const data = normalized(parsed),
    requestHash = hash(data);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await advisory(client, userId);
    const receipt = await client.query<{
      request_hash: string;
      purchase_id: string;
    }>(
      'SELECT request_hash,purchase_id FROM medication_purchase_operations WHERE user_id=$1 AND operation_id=$2',
      [userId, parsed.operation_id]
    );
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_hash !== requestHash)
        throw problem(
          'This operation was already used for a different invoice.',
          409
        );
      const prior = (
        await readPurchases(client, userId, receipt.rows[0].purchase_id)
      )[0];
      if (!prior)
        throw problem(
          'This invoice was already created and subsequently deleted.',
          410
        );
      await client.query('COMMIT');
      return prior;
    }
    await lockContext(client, userId, undefined, data);
    const id = randomUUID();
    await writePurchase(client, userId, id, data);
    await client.query(
      'INSERT INTO medication_purchase_operations(user_id,operation_id,request_hash,purchase_id) VALUES($1,$2,$3,$4)',
      [userId, parsed.operation_id, requestHash, id]
    );
    const result = (await readPurchases(client, userId, id))[0]!;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function updatePurchase(
  userId: string,
  id: string,
  input: MedicationPurchaseUpdateInput
): Promise<MedicationPurchaseView> {
  const parsed = medicationPurchaseUpdateSchema.parse(input);
  assertOwner(userId, parsed.expected_owner_id);
  const data = normalized(parsed);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await advisory(client, userId);
    const state = await lockContext(client, userId, id, data);
    if (state.header?.revision !== parsed.expected_revision)
      throw problem('Invoice changed. Reload before saving.', 409);
    await writePurchase(client, userId, id, data, parsed.expected_revision);
    const result = (await readPurchases(client, userId, id))[0]!;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function deletePurchase(
  userId: string,
  id: string,
  input: MedicationPurchaseDeleteInput
): Promise<boolean> {
  const parsed = medicationPurchaseDeleteSchema.parse(input);
  assertOwner(userId, parsed.expected_owner_id);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await advisory(client, userId);
    const state = await lockContext(client, userId, id);
    if (state.header?.revision !== parsed.expected_revision)
      throw problem('Invoice changed. Reload before deleting.', 409);
    await client.query(
      'DELETE FROM medication_purchases WHERE user_id=$1 AND id=$2',
      [userId, id]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
