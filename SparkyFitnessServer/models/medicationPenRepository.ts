import {
  badPreparation,
  preparationValues,
  resolveBud,
} from '../services/medicationPreparationService.js';
import { calculateVialStock, type MedicationPen } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import type {
  CreatePenBody,
  UpdatePenBody,
} from '../schemas/medicationSchemas.js';

const PREPARATION_SQL = `(SELECT to_jsonb(p) - 'user_id' - 'medication_id' - 'pen_id'
  FROM medication_preparations p WHERE p.pen_id = medication_pens.id
    AND p.user_id = medication_pens.user_id AND p.medication_id = medication_pens.medication_id)`;
const PEN_COLS = `id, medication_id, user_id, kind, label, dose_mg, concentration_mg_ml,
  volume_ml, doses_total, doses_used, status, finished_at, opened_at, expiry_date, bud_date,
  reorder_flag, reorder_threshold, notes, source, custom_fields, created_at, updated_at,
  lot_number, storage_location, bud_mode, bud_interval_days, bud_base_date, bud_source,
  ${PREPARATION_SQL} AS preparation`;

async function createPen(
  userId: string,
  medicationId: string,
  data: CreatePenBody
) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    if (data.preparation && data.kind !== 'vial')
      throw badPreparation('Preparation requires a vial.');
    if (data.preparation && Number(data.doses_used ?? 0) !== 0)
      throw badPreparation(
        'Only unused stock can receive a preparation snapshot.'
      );
    const canonical = data.preparation
      ? preparationValues(data.preparation)
      : null;
    if (canonical && data.preparation) {
      if (
        (data.concentration_mg_ml !== null &&
          data.concentration_mg_ml !== undefined &&
          data.concentration_mg_ml !== canonical.concentration_mg_ml) ||
        (data.volume_ml !== null &&
          data.volume_ml !== undefined &&
          data.volume_ml !== data.preparation.final_volume_ml)
      ) {
        throw badPreparation(
          'Vial concentration and volume must match its preparation.'
        );
      }
      data = {
        ...data,
        concentration_mg_ml: canonical.concentration_mg_ml,
        volume_ml: data.preparation.final_volume_ml,
      };
    }
    data = { ...data, ...resolveBud(data) };
    const owner = await client.query(
      'SELECT id FROM medications WHERE id = $1 AND user_id = $2 FOR KEY SHARE',
      [medicationId, userId]
    );
    if (!owner.rows[0]) throw badPreparation('Medication not found.');
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
    const pen = result.rows[0];
    if (data.preparation && canonical) {
      await client.query(
        `INSERT INTO medication_preparations (pen_id,user_id,medication_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date,diluent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          pen.id,
          userId,
          medicationId,
          data.preparation.mode,
          data.preparation.mass_value,
          data.preparation.mass_unit,
          data.preparation.final_volume_ml,
          canonical.mass_mg,
          canonical.concentration_mg_ml,
          data.preparation.prepared_date,
          data.preparation.diluent ?? null,
        ]
      );
    }
    await client.query(
      'UPDATE medication_pens SET lot_number=$3,storage_location=$4,bud_mode=$5,bud_interval_days=$6,bud_base_date=$7,bud_source=$8 WHERE id=$1 AND user_id=$2',
      [
        pen.id,
        userId,
        data.lot_number ?? null,
        data.storage_location ?? null,
        data.bud_mode ?? null,
        data.bud_interval_days ?? null,
        data.bud_base_date ?? null,
        data.bud_source ?? null,
      ]
    );
    const saved = await client.query(
      `SELECT ${PEN_COLS} FROM medication_pens WHERE id=$1 AND user_id=$2`,
      [pen.id, userId]
    );
    await client.query('COMMIT');
    return saved.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
          (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id = medication_pens.id AND i.user_id = medication_pens.user_id AND (i.dose_mg IS NULL OR i.dose_mg < 0 OR (i.dose_mg = 0 AND (i.volume_ml IS NULL OR i.dose_input_unit IS NULL)))) AS stock_missing_doses,
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
          status:
            stock && !pen.finished_at && pen.status !== 'discarded'
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
    if (data.lifecycle_intent && data.status === undefined)
      throw badPreparation('A deliberate lifecycle change requires a status.');
    if (
      existing?.finished_at &&
      !data.lifecycle_intent &&
      data.status !== undefined &&
      data.status !== existing.status
    ) {
      throw badPreparation(
        'Use an explicit lifecycle action to change retired stock.'
      );
    }

    if (!existing) {
      await client.query('COMMIT');
      return null;
    }
    const snapshot = await client.query(
      'SELECT * FROM medication_preparations WHERE pen_id=$1 AND user_id=$2',
      [id, userId]
    );
    const prep = snapshot.rows[0];
    if (prep) {
      if (data.preparation) {
        const same =
          data.preparation.mode === prep.mode &&
          data.preparation.mass_unit === prep.mass_unit &&
          data.preparation.mass_value === Number(prep.mass_value) &&
          data.preparation.final_volume_ml === Number(prep.final_volume_ml) &&
          data.preparation.prepared_date === prep.prepared_date &&
          (data.preparation.diluent ?? null) === prep.diluent;
        if (!same)
          throw badPreparation('Saved preparation inputs are immutable.');
      }
      if (
        (data.kind !== undefined && data.kind !== 'vial') ||
        (data.volume_ml !== undefined &&
          data.volume_ml !== Number(prep.final_volume_ml)) ||
        (data.concentration_mg_ml !== undefined &&
          data.concentration_mg_ml !== Number(prep.concentration_mg_ml))
      ) {
        throw badPreparation(
          'Vial concentration and volume must match its immutable preparation.'
        );
      }
    } else if (data.preparation) {
      const history = await client.query(
        'SELECT COUNT(*) AS count FROM injection_entries WHERE pen_id=$1 AND user_id=$2',
        [id, userId]
      );
      if (
        Number(data.doses_used ?? 0) !== 0 ||
        Number(existing.doses_used) !== 0 ||
        Number(history.rows[0]?.count) > 0
      )
        throw badPreparation(
          'Only unused stock can receive a preparation snapshot.'
        );
      if ((data.kind ?? existing.kind) !== 'vial')
        throw badPreparation('Preparation requires a vial.');
      const canonical = preparationValues(data.preparation);
      if (
        (data.concentration_mg_ml !== null &&
          data.concentration_mg_ml !== undefined &&
          data.concentration_mg_ml !== canonical.concentration_mg_ml) ||
        (data.volume_ml !== null &&
          data.volume_ml !== undefined &&
          data.volume_ml !== data.preparation.final_volume_ml)
      )
        throw badPreparation(
          'Vial concentration and volume must match its preparation.'
        );
      await client.query(
        `INSERT INTO medication_preparations (pen_id,user_id,medication_id,mode,mass_value,mass_unit,final_volume_ml,mass_mg,concentration_mg_ml,prepared_date,diluent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          userId,
          existing.medication_id,
          data.preparation.mode,
          data.preparation.mass_value,
          data.preparation.mass_unit,
          data.preparation.final_volume_ml,
          canonical.mass_mg,
          canonical.concentration_mg_ml,
          data.preparation.prepared_date,
          data.preparation.diluent ?? null,
        ]
      );
      data = {
        ...data,
        concentration_mg_ml: canonical.concentration_mg_ml,
        volume_ml: data.preparation.final_volume_ml,
      };
    }
    data = { ...data, ...resolveBud(data, existing) };
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
    if (data.lifecycle_intent && data.status) {
      await client.query(
        "UPDATE medication_pens SET finished_at=CASE WHEN $3 IN ('finished','discarded') THEN NOW() ELSE NULL END WHERE id=$1 AND user_id=$2",
        [id, userId, data.status]
      );
      await client.query(
        'INSERT INTO medication_stock_status_audit(user_id,pen_id,old_status,new_status) VALUES($1,$2,$3,$4)',
        [userId, id, existing.status, data.status]
      );
    }
    const updates: string[] = [];
    const values: unknown[] = [id, userId];
    let index = 3;

    const fields: (keyof UpdatePenBody)[] = [
      'lot_number',
      'storage_location',
      'bud_mode',
      'bud_interval_days',
      'bud_base_date',
      'bud_source',
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
    await client.query('BEGIN');
    const pen = await client.query(
      'SELECT doses_used FROM medication_pens WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [id, userId]
    );
    const history = await client.query(
      'SELECT COUNT(*) AS count FROM injection_entries WHERE pen_id=$1 AND user_id=$2',
      [id, userId]
    );
    if (
      Number(pen.rows[0]?.doses_used) > 0 ||
      Number(history.rows[0]?.count) > 0
    ) {
      throw badPreparation(
        'Stock with recorded use cannot be removed; retain it for injection history.'
      );
    }
    const result = await client.query(
      'DELETE FROM medication_pens WHERE id=$1 AND user_id=$2 RETURNING id',
      [id, userId]
    );
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { createPen, listPens, updatePen, deletePen };
export default { createPen, listPens, updatePen, deletePen };
