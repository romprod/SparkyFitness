import { medicationDoseInMg } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import type {
  CreateInjectionBody,
  UpdateInjectionBody,
} from '../schemas/medicationSchemas.js';

const MASS_STOCK_SQL =
  "kind = 'vial' AND concentration_mg_ml > 0 AND volume_ml > 0 AND NOT EXISTS (SELECT 1 FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id AND (si.dose_mg IS NULL OR si.dose_mg <= 0)) AND doses_used = (SELECT COUNT(*) FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id)";
const USED_MASS_SQL =
  '(SELECT COALESCE(SUM(si.dose_mg),0) FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id)';

const INJECTION_COLS = `id, medication_id, user_id, pen_id, preparation_id, injected_at, entry_date,
  site, dose_mg, notes, source, custom_fields, created_at, updated_at`;

/**
 * Create an injection entry. When `deduct_pen` is true, the pen's doses_used is incremented
 * and its status advanced (sealed -> in_use -> finished) inside the same transaction so
 * inventory stays consistent. When `deduct_pen` is true without a `pen_id`, the best
 * candidate pen is auto-picked (in-use first, else oldest sealed with doses remaining).
 * A missing `dose_mg` is resolved from the active titration step, else the medication's
 * default dose.
 */
async function createInjection(userId: string, data: CreateInjectionBody) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');

    // The pen this injection deducts from — and the only pen_id we persist on the
    // row. We record a pen_id ONLY when a dose is actually taken from it, so a stored
    // pen_id reliably means "deducted", which is exactly what deleteInjection's restore
    // depends on. When deduct_pen is set without a pen_id, auto-pick the best candidate
    // (in-use first, else oldest sealed with doses left).
    let resolvedPenId: string | null = null;
    if (data.deduct_pen) {
      resolvedPenId = data.pen_id ?? null;
      if (!resolvedPenId) {
        const penPick = await client.query(
          `SELECT id FROM medication_pens
            WHERE user_id = $1 AND medication_id = $2
              AND (status IN ('in_use', 'sealed') OR (status = 'finished' AND ${MASS_STOCK_SQL} AND ${USED_MASS_SQL} < concentration_mg_ml * volume_ml))
              AND (CASE WHEN ${MASS_STOCK_SQL} THEN ${USED_MASS_SQL} < concentration_mg_ml * volume_ml ELSE doses_total IS NULL OR doses_used < doses_total END)
            ORDER BY (status = 'in_use') DESC, opened_at ASC NULLS LAST,
                     expiry_date ASC NULLS LAST, created_at ASC
            LIMIT 1
            FOR UPDATE`,
          [userId, data.medication_id]
        );
        resolvedPenId = penPick.rows[0]?.id ?? null;
      }
    }

    // A separate lock statement ensures preparations committed while waiting are
    // visible to the INSERT's fresh READ COMMITTED snapshot.
    if (resolvedPenId) {
      const locked = await client.query(
        'SELECT id FROM medication_pens WHERE id=$1 AND user_id=$2 AND medication_id=$3 FOR UPDATE',
        [resolvedPenId, userId, data.medication_id]
      );
      if (!locked.rows[0])
        throw Object.assign(
          new Error('The selected stock does not belong to this medication.'),
          { statusCode: 400 }
        );
    }

    let resolvedDoseMg = data.dose_mg ?? null;
    if (resolvedDoseMg === null) {
      const doseResult = await client.query(
        `SELECT
           (SELECT dose_mg FROM medication_titration_steps
             WHERE user_id = $1 AND medication_id = $2 AND status = 'active'
             ORDER BY step_order DESC LIMIT 1) AS dose_mg,
           m.dose_amount, m.dose_unit, m.is_glp1
         FROM medications m WHERE m.id = $2 AND m.user_id = $1`,
        [userId, data.medication_id]
      );
      const defaults = doseResult.rows[0] as
        | {
            dose_mg: number | null;
            dose_amount: number | null;
            dose_unit: string | null;
            is_glp1: boolean;
          }
        | undefined;
      resolvedDoseMg =
        defaults?.dose_mg ?? (defaults ? medicationDoseInMg(defaults) : null);
    }

    const injection = await client.query(
      `WITH locked_pen AS (
         SELECT id FROM medication_pens
         WHERE id = $3 AND user_id = $2 AND medication_id = $1
         FOR UPDATE
       )
       INSERT INTO injection_entries (
         medication_id, user_id, pen_id, preparation_id, injected_at, entry_date, site, dose_mg, notes,
         source, custom_fields)
       SELECT $1,$2,$3, (SELECT p.id FROM medication_preparations p WHERE p.pen_id=$3 AND p.user_id=$2 AND p.medication_id=$1), COALESCE($4::timestamptz, NOW()), COALESCE($5::date, CURRENT_DATE),$6,$7,$8,
         COALESCE($9,'manual'), COALESCE($10::jsonb,'{}'::jsonb)
       WHERE $3 IS NULL OR EXISTS (SELECT 1 FROM locked_pen)
       RETURNING ${INJECTION_COLS}`,
      [
        data.medication_id,
        userId,
        resolvedPenId,
        data.injected_at ?? null,
        data.entry_date ?? null,
        data.site ?? null,
        resolvedDoseMg,
        data.notes ?? null,
        data.source ?? null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
      ]
    );

    if (!injection.rows[0]) {
      throw Object.assign(
        new Error('The selected stock does not belong to this medication.'),
        { statusCode: 400 }
      );
    }
    let pen = null;
    if (resolvedPenId) {
      const penResult = await client.query(
        `UPDATE medication_pens
           SET doses_used = doses_used + 1,
               status = CASE
                 WHEN ${MASS_STOCK_SQL.replace('doses_used =', 'doses_used + 1 =')} THEN CASE WHEN ${USED_MASS_SQL} >= concentration_mg_ml * volume_ml THEN 'finished' ELSE 'in_use' END
                 WHEN doses_total IS NOT NULL AND doses_used + 1 >= doses_total THEN 'finished'
                 ELSE 'in_use'
               END,
               opened_at = COALESCE(opened_at, CURRENT_DATE),
               reorder_flag = CASE
                 WHEN ${MASS_STOCK_SQL.replace('doses_used =', 'doses_used + 1 =')} THEN
                   CASE WHEN reorder_threshold IS NOT NULL AND dose_mg > 0
                     AND FLOOR(GREATEST(0, concentration_mg_ml * volume_ml - ${USED_MASS_SQL}) / dose_mg) <= reorder_threshold THEN TRUE ELSE reorder_flag END
                 WHEN reorder_threshold IS NOT NULL AND doses_total IS NOT NULL
                      AND (doses_total - (doses_used + 1)) <= reorder_threshold THEN TRUE
                 ELSE reorder_flag
               END,
               updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, doses_total, doses_used, status, reorder_flag`,
        [resolvedPenId, userId]
      );
      pen = penResult.rows[0] ?? null;
    }

    await client.query('COMMIT');
    return { ...injection.rows[0], pen };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listInjections(
  userId: string,
  opts: {
    medicationId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  } = {}
) {
  const client = await getClient(userId);
  try {
    const params: Array<string | number> = [userId];
    let where = 'user_id = $1';
    if (opts.medicationId) {
      params.push(opts.medicationId);
      where += ` AND medication_id = $${params.length}`;
    }
    if (opts.fromDate) {
      params.push(opts.fromDate);
      where += ` AND entry_date >= $${params.length}`;
    }
    if (opts.toDate) {
      params.push(opts.toDate);
      where += ` AND entry_date <= $${params.length}`;
    }
    let limitClause = '';
    if (opts.limit) {
      params.push(opts.limit);
      limitClause = ` LIMIT $${params.length}`;
    }
    const result = await client.query(
      `SELECT ${INJECTION_COLS} FROM injection_entries
       WHERE ${where}
       ORDER BY injected_at DESC${limitClause}`,
      params
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function updateInjection(
  userId: string,
  id: string,
  data: UpdateInjectionBody
) {
  const client = await getClient(userId);
  try {
    const updates: string[] = [];
    const values: unknown[] = [id, userId];
    let index = 3;

    const fields: (keyof UpdateInjectionBody)[] = [
      'injected_at',
      'entry_date',
      'site',
      'dose_mg',
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
        `SELECT ${INJECTION_COLS} FROM injection_entries WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      return current.rows[0] ?? null;
    }

    const result = await client.query(
      `UPDATE injection_entries SET
         ${updates.join(',\n')},
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING ${INJECTION_COLS}`,
      values
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Delete an injection entry. When the entry deducted a pen (pen_id is set), the dose is
 * credited back in the same transaction: doses_used is decremented and the pen's
 * finished status / reorder flag are reversed when applicable. A null pen_id means no
 * deduction ever happened, so there is nothing to restore.
 */
async function deleteInjection(userId: string, id: string) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'DELETE FROM injection_entries WHERE id = $1 AND user_id = $2 RETURNING id, pen_id',
      [id, userId]
    );
    const deleted = result.rows[0];
    if (deleted?.pen_id) {
      await client.query(
        `UPDATE medication_pens
           SET doses_used = GREATEST(doses_used - 1, 0),
               status = CASE
                 WHEN ${MASS_STOCK_SQL.replace('doses_used =', 'GREATEST(doses_used - 1, 0) =')} AND ${USED_MASS_SQL} < concentration_mg_ml * volume_ml THEN 'in_use'
                 WHEN status = 'finished' AND doses_total IS NOT NULL
                      AND GREATEST(doses_used - 1, 0) < doses_total THEN 'in_use'
                 ELSE status
               END,
               reorder_flag = CASE
                 WHEN ${MASS_STOCK_SQL.replace('doses_used =', 'doses_used + 1 =')} THEN
                   CASE WHEN reorder_threshold IS NOT NULL AND dose_mg > 0
                     AND FLOOR(GREATEST(0, concentration_mg_ml * volume_ml - ${USED_MASS_SQL}) / dose_mg) <= reorder_threshold THEN TRUE ELSE reorder_flag END
                 WHEN reorder_threshold IS NOT NULL AND doses_total IS NOT NULL
                      AND (doses_total - GREATEST(doses_used - 1, 0)) > reorder_threshold THEN FALSE
                 ELSE reorder_flag
               END,
               updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [deleted.pen_id, userId]
      );
    }
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { createInjection, listInjections, updateInjection, deleteInjection };
export default {
  createInjection,
  listInjections,
  updateInjection,
  deleteInjection,
};
