import { calculateVialStock, type MedicationPen } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import type {
  CreatePenBody,
  UpdatePenBody,
} from '../schemas/medicationSchemas.js';

const PEN_COLS = `id, medication_id, user_id, kind, label, dose_mg, concentration_mg_ml,
  volume_ml, doses_total, doses_used, status, opened_at, expiry_date, bud_date,
  reorder_flag, reorder_threshold, notes, source, custom_fields, created_at, updated_at`;

async function createPen(
  userId: string,
  medicationId: string,
  data: CreatePenBody
) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO medication_pens (
         medication_id, user_id, kind, label, dose_mg, concentration_mg_ml, volume_ml,
         doses_total, doses_used, status, opened_at, expiry_date, bud_date,
         reorder_flag, reorder_threshold, notes, source, custom_fields)
       VALUES ($1,$2, COALESCE($3,'pen'),$4,$5,$6,$7,$8, COALESCE($9,0),
         COALESCE($10,'sealed'),$11,$12,$13, COALESCE($14, FALSE),$15,$16,
         COALESCE($17,'manual'), COALESCE($18,'{}'::jsonb))
       RETURNING ${PEN_COLS}`,
      [
        medicationId,
        userId,
        data.kind ?? null,
        data.label ?? null,
        data.dose_mg ?? null,
        data.concentration_mg_ml ?? null,
        data.volume_ml ?? null,
        data.doses_total ?? null,
        data.doses_used ?? null,
        data.status ?? null,
        data.opened_at ?? null,
        data.expiry_date ?? null,
        data.bud_date ?? null,
        data.reorder_flag ?? null,
        data.reorder_threshold ?? null,
        data.notes ?? null,
        data.source ?? null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function listPens(userId: string, medicationId?: string) {
  const client = await getClient(userId);
  try {
    const params: string[] = [userId];
    let where = 'user_id = $1';
    if (medicationId) {
      params.push(medicationId);
      where += ' AND medication_id = $2';
    }
    const result = await client.query(
      `SELECT ${PEN_COLS},
          (SELECT COALESCE(SUM(i.dose_mg),0) FROM injection_entries i WHERE i.pen_id = medication_pens.id AND i.user_id = medication_pens.user_id) AS stock_used_mg,
          (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id = medication_pens.id AND i.user_id = medication_pens.user_id AND (i.dose_mg IS NULL OR i.dose_mg <= 0)) AS stock_missing_doses,
          (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id = medication_pens.id AND i.user_id = medication_pens.user_id) AS stock_linked_count
       FROM medication_pens
       WHERE ${where}
       ORDER BY (status = 'in_use') DESC, expiry_date NULLS LAST, created_at DESC`,
      params
    );
    return result.rows.map(
      (
        row: MedicationPen & {
          stock_used_mg: string;
          stock_missing_doses: string;
          stock_linked_count: string;
        }
      ) => {
        const {
          stock_used_mg,
          stock_missing_doses,
          stock_linked_count,
          ...pen
        } = row;
        const unknown =
          Number(stock_missing_doses) > 0 ||
          Number(pen.doses_used) !== Number(stock_linked_count);
        const stock =
          pen.kind === 'vial' && !unknown
            ? calculateVialStock(
                pen.concentration_mg_ml === null
                  ? null
                  : Number(pen.concentration_mg_ml),
                pen.volume_ml === null ? null : Number(pen.volume_ml),
                Number(stock_used_mg),
                Number(stock_missing_doses)
              )
            : null;
        return {
          ...pen,
          status: stock
            ? stock.remainingMg <= 0
              ? 'finished'
              : pen.status === 'finished'
                ? 'in_use'
                : pen.status
            : pen.status,
          stock,
          stock_unknown: pen.kind === 'vial' && stock === null,
        };
      }
    );
  } finally {
    client.release();
  }
}

async function updatePen(userId: string, id: string, data: UpdatePenBody) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM medication_pens WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId]
    );
    const existing = locked.rows[0];
    if (existing) {
      const history = await client.query(
        'SELECT COUNT(*) AS count FROM injection_entries WHERE pen_id = $1 AND user_id = $2',
        [id, userId]
      );
      if (
        Number(history.rows[0]?.count) > 0 ||
        Number(existing.doses_used) > 0
      ) {
        for (const field of [
          'kind',
          'volume_ml',
          'concentration_mg_ml',
        ] as const) {
          if (
            data[field] !== undefined &&
            (field === 'kind'
              ? data[field] !== existing[field]
              : Number(data[field]) !== Number(existing[field]))
          ) {
            throw Object.assign(
              new Error(
                'Preparation details cannot change after stock has been used. Add a new vial instead.'
              ),
              { status: 400, statusCode: 400 }
            );
          }
        }
      }
    }
    const updates: string[] = [];
    const values: unknown[] = [id, userId];
    let index = 3;

    const fields: (keyof UpdatePenBody)[] = [
      'kind',
      'label',
      'dose_mg',
      'concentration_mg_ml',
      'volume_ml',
      'doses_total',
      'doses_used',
      'status',
      'opened_at',
      'expiry_date',
      'bud_date',
      'reorder_flag',
      'reorder_threshold',
      'notes',
      'custom_fields',
    ];

    for (const key of fields) {
      if (data[key] !== undefined) {
        updates.push(`${key} = $${index}`);
        if (key === 'custom_fields') {
          values.push(
            data.custom_fields ? JSON.stringify(data.custom_fields) : '{}'
          );
        } else {
          values.push(data[key]);
        }
        index++;
      }
    }

    if (updates.length === 0) {
      const current = await client.query(
        `SELECT ${PEN_COLS} FROM medication_pens WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      await client.query('COMMIT');
      return current.rows[0] ?? null;
    }

    const query = `UPDATE medication_pens SET
                     ${updates.join(',\n')},
                     updated_at = NOW()
                   WHERE id = $1 AND user_id = $2
                   RETURNING ${PEN_COLS}`;

    const result = await client.query(query, values);
    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deletePen(userId: string, id: string) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM medication_pens WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

export { createPen, listPens, updatePen, deletePen };
export default { createPen, listPens, updatePen, deletePen };
