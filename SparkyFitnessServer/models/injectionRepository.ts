import type { PoolClient } from 'pg';
import {
  courseLogFields,
  lockLogMedication,
  lockStoredCourseLog,
  validateCourseLog,
  type StoredCourseLog,
} from '../services/medicationCourseLogService.js';
import {
  drawDeliveredMg,
  resolvePreparedMedicationRoute,
} from '@workspace/shared';
import {
  calculateMedicationDrawReview,
  lockDrawMedication,
} from '../services/medicationDrawReviewService.js';
import { badPreparation } from '../services/medicationPreparationService.js';
import { medicationDoseInMg } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import type {
  CreateInjectionBody,
  UpdateInjectionBody,
} from '../schemas/medicationSchemas.js';

const MASS_STOCK_SQL =
  "kind = 'vial' AND concentration_mg_ml > 0 AND volume_ml > 0 AND NOT EXISTS (SELECT 1 FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id AND (si.dose_mg IS NULL OR si.dose_mg < 0 OR (si.dose_mg = 0 AND (si.volume_ml IS NULL OR si.dose_input_unit IS NULL)))) AND doses_used = (SELECT COUNT(*) FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id)";
const USED_MASS_SQL =
  '(SELECT COALESCE(SUM(si.dose_mg),0) FROM injection_entries si WHERE si.pen_id = medication_pens.id AND si.user_id = medication_pens.user_id)';

const INJECTION_COLS = `id, medication_id, user_id, pen_id, preparation_id, injected_at, entry_date,
  site, administration_route, dose_mg, dose_mg::text AS dose_mg_exact, volume_ml::text, syringe_units::text, dose_input_unit, syringe_id, notes, source, custom_fields, created_at, updated_at, scheduled_for, course_revision_id, course_rule_id, course_step_id, scheduled_day, course_slot_key, course_origin, medication_name_snapshot`;

/**
 * Create an injection entry. When `deduct_pen` is true, the pen's doses_used is incremented
 * and its status advanced (sealed -> in_use -> finished) inside the same transaction so
 * inventory stays consistent. When `deduct_pen` is true without a `pen_id`, the best
 * candidate pen is auto-picked (in-use first, else oldest sealed with doses remaining).
 * A missing `dose_mg` is resolved from the active titration step, else the medication's
 * default dose.
 */
async function createInjection(userId: string, data: CreateInjectionBody) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await lockLogMedication(client, userId, data.medication_id);
    await validateCourseLog(
      client,
      userId,
      data.medication_id,
      data,
      data.entry_date
    );
    const medication = await lockDrawMedication(
      client,
      userId,
      data.medication_id
    );
    if (!medication) throw badPreparation('Medication not found.');

    // The pen this injection deducts from — and the only pen_id we persist on the
    // row. We record a pen_id ONLY when a dose is actually taken from it, so a stored
    // pen_id reliably means "deducted", which is exactly what deleteInjection's restore
    // depends on. When deduct_pen is set without a pen_id, auto-pick the best candidate
    // (in-use first, else oldest sealed with doses left).
    if (data.calculated_draw && (!data.pen_id || !data.deduct_pen))
      throw badPreparation('A calculated draw requires selected vial stock.');
    let resolvedPenId: string | null = null;
    if (data.deduct_pen) {
      resolvedPenId = data.pen_id ?? null;
      if (!resolvedPenId) {
        const penPick = await client.query(
          `SELECT id FROM medication_pens
            WHERE user_id = $1 AND medication_id = $2
              AND finished_at IS NULL AND status <> 'discarded'
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

    const draw =
      data.calculated_draw && resolvedPenId
        ? await calculateMedicationDrawReview(
            client,
            userId,
            resolvedPenId,
            data.calculated_draw,
            data.medication_id,
            undefined,
            true
          )
        : null;
    const blocker = draw?.warnings.find((w) => w.severity === 'block');
    if (blocker) throw badPreparation(blocker.message);
    if (draw) resolvedDoseMg = Number(drawDeliveredMg(draw));

    const injection = await client.query(
      `WITH locked_pen AS (
         SELECT id FROM medication_pens
         WHERE id = $3 AND user_id = $2 AND medication_id = $1
         FOR UPDATE
       )
       INSERT INTO injection_entries (
         medication_id, user_id, pen_id, preparation_id, injected_at, entry_date, site, dose_mg, notes,
         source, custom_fields,volume_ml,syringe_units,dose_input_unit,syringe_id,administration_route,scheduled_for,course_revision_id,course_rule_id,course_step_id,scheduled_day,course_slot_key,course_origin,medication_name_snapshot)
       SELECT $1,$2,$3, (SELECT p.id FROM medication_preparations p WHERE p.pen_id=$3 AND p.user_id=$2 AND p.medication_id=$1), COALESCE($4::timestamptz, NOW()), COALESCE($5::date, CURRENT_DATE),$6,$7,$8,
         COALESCE($9,'manual'), COALESCE($10::jsonb,'{}'::jsonb),$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,(SELECT COALESCE(NULLIF(m.display_name,''),m.name) FROM medications m WHERE m.id=$1 AND m.user_id=$2)
       WHERE $3 IS NULL OR EXISTS (SELECT 1 FROM locked_pen)
       RETURNING ${INJECTION_COLS}`,
      [
        data.medication_id,
        userId,
        resolvedPenId,
        data.injected_at ?? null,
        data.entry_date ?? null,
        draw?.administrationRoute === 'nasal' ? null : (data.site ?? null),
        draw ? drawDeliveredMg(draw) : resolvedDoseMg,
        data.notes ?? null,
        data.source ?? null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
        draw?.deliveredVolumeMl ?? null,
        draw?.markingScale === 'units' ? draw.markingValue : null,
        draw?.doseInputUnit ?? null,
        data.calculated_draw?.syringe_id ?? null,
        draw?.administrationRoute ?? resolvePreparedMedicationRoute(medication),
        data.scheduled_for ?? null,
        ...courseLogFields.map((key) => data[key] ?? null),
        data.course_revision_id ? true : null,
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
                 WHEN finished_at IS NOT NULL OR status = 'discarded' THEN status
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
  const client: PoolClient = await getClient(userId);
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

async function editCalculatedInjection(
  client: import('pg').PoolClient,
  userId: string,
  id: string,
  penId: string,
  data: UpdateInjectionBody
) {
  try {
    const parent = await client.query(
      'SELECT medication_id FROM medication_pens WHERE id=$1 AND user_id=$2',
      [penId, userId]
    );
    if (parent.rows[0])
      await lockDrawMedication(client, userId, parent.rows[0].medication_id);
    await client.query(
      'SELECT id FROM medication_pens WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [penId, userId]
    );
    const reference = await client.query(
      'SELECT syringe_id FROM injection_entries WHERE id=$1 AND user_id=$2',
      [id, userId]
    );
    if (reference.rows[0]?.syringe_id)
      await client.query(
        'SELECT id FROM medication_syringes WHERE id=$1 AND user_id=$2 FOR SHARE',
        [reference.rows[0].syringe_id, userId]
      );
    const locked = await client.query(
      'SELECT * FROM injection_entries WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [id, userId]
    );
    const entry = locked.rows[0];
    if (!entry) {
      await client.query('COMMIT');
      return null;
    }
    if (!entry.syringe_id)
      throw badPreparation(
        'Original syringe is missing; an amount correction needs the original syringe.'
      );
    if (
      data.calculated_draw &&
      data.calculated_draw.syringe_id !== entry.syringe_id
    )
      throw badPreparation('Use the original device for this correction.');
    if (
      !data.calculated_draw &&
      (data.dose_mg === null || data.dose_mg === undefined)
    )
      throw badPreparation('Enter a dose amount for this correction.');
    const draw = await calculateMedicationDrawReview(
      client,
      userId,
      penId,
      data.calculated_draw ?? {
        syringe_id: entry.syringe_id,
        dose: { value: String(data.dose_mg), unit: 'mg' },
      },
      entry.medication_id,
      id,
      true
    );
    const blocker = draw.warnings.find((w) => w.severity === 'block');
    if (blocker) throw badPreparation(blocker.message);
    const attributionFields = [...courseLogFields, 'scheduled_for'] as const;
    const attributionUpdates = attributionFields.filter(
      (key) => data[key] !== undefined
    );
    if (attributionUpdates.length)
      await client.query(
        `UPDATE injection_entries SET ${attributionUpdates.map((key, index) => `${key}=$${index + 3}`).join(',')} WHERE id=$1 AND user_id=$2`,
        [id, userId, ...attributionUpdates.map((key) => data[key])]
      );
    const result = await client.query(
      `UPDATE injection_entries SET dose_mg=$3,volume_ml=$4,syringe_units=$5,dose_input_unit=$14,injected_at=COALESCE($6::timestamptz,injected_at),entry_date=COALESCE($7::date,entry_date),site=CASE WHEN $8 THEN $9 ELSE site END,notes=CASE WHEN $10 THEN $11 ELSE notes END,custom_fields=CASE WHEN $12 THEN $13::jsonb ELSE custom_fields END,updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING ${INJECTION_COLS}`,
      [
        id,
        userId,
        drawDeliveredMg(draw),
        draw.deliveredVolumeMl,
        draw.markingScale === 'units' ? draw.markingValue : null,
        data.injected_at ?? null,
        data.entry_date ?? null,
        entry.administration_route === 'nasal' || data.site !== undefined,
        entry.administration_route === 'nasal' ? null : (data.site ?? null),
        data.notes !== undefined,
        data.notes ?? null,
        data.custom_fields !== undefined,
        JSON.stringify(data.custom_fields ?? {}),
        draw.doseInputUnit,
      ]
    );
    await client.query(
      `UPDATE medication_pens SET status=CASE WHEN finished_at IS NOT NULL OR status='discarded' THEN status WHEN ${MASS_STOCK_SQL} THEN CASE WHEN ${USED_MASS_SQL} >= concentration_mg_ml*volume_ml THEN 'finished' ELSE 'in_use' END ELSE status END,updated_at=NOW() WHERE id=$1 AND user_id=$2`,
      [penId, userId]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function updateInjection(
  userId: string,
  id: string,
  data: UpdateInjectionBody
) {
  const client: PoolClient = await getClient(userId);
  let manualQuantityTransaction = false;
  let manualPenId: string | null = null;
  try {
    if (Object.keys(data).length === 0) {
      const unchanged = await client.query(
        `SELECT ${INJECTION_COLS} FROM injection_entries WHERE id=$1 AND user_id=$2`,
        [id, userId]
      );
      return unchanged.rows[0] ?? null;
    }

    await client.query('BEGIN');
    manualQuantityTransaction = true;
    const parent = await client.query<StoredCourseLog>(
      'SELECT medication_id FROM injection_entries WHERE id=$1 AND user_id=$2',
      [id, userId]
    );
    await lockLogMedication(
      client,
      userId,
      parent.rows[0]?.medication_id ?? null
    );
    const storedResult = await client.query<StoredCourseLog>(
      'SELECT * FROM injection_entries WHERE id=$1 AND user_id=$2',
      [id, userId]
    );
    const stored = storedResult.rows[0];
    if (data.course_revision_id === null && stored?.course_revision_id) {
      // Detaching a plan relationship must not erase the actual's captured timing facts.
      data = { ...data, scheduled_for: undefined, scheduled_day: undefined };
    }
    if (stored)
      await validateCourseLog(
        client,
        userId,
        stored.medication_id,
        data,
        data.entry_date,
        stored,
        'injection'
      );

    if (data.dose_mg !== undefined || data.calculated_draw) {
      const current = await client.query(
        'SELECT * FROM injection_entries WHERE id=$1 AND user_id=$2',
        [id, userId]
      );
      const entry = current.rows[0];
      if (
        data.calculated_draw &&
        (!entry?.dose_input_unit ||
          entry.volume_ml === null ||
          entry.volume_ml === undefined)
      )
        throw badPreparation('This entry has no calculated draw to correct.');
      if (
        entry &&
        !entry.dose_input_unit &&
        data.dose_mg !== null &&
        data.dose_mg !== undefined &&
        data.dose_mg <= 0
      )
        throw badPreparation('Manual dose must be positive.');
      if (
        entry &&
        entry.volume_ml !== null &&
        entry.volume_ml !== undefined &&
        entry.dose_input_unit &&
        (data.calculated_draw ||
          data.dose_mg === null ||
          Number(data.dose_mg) !== Number(entry.dose_mg))
      ) {
        if (!entry.pen_id)
          throw badPreparation(
            'Original vial is missing; this amount cannot be recomputed.'
          );
        manualQuantityTransaction = false;
        return await editCalculatedInjection(
          client,
          userId,
          id,
          entry.pen_id,
          data
        );
      }
      if (
        entry &&
        entry.volume_ml !== null &&
        entry.volume_ml !== undefined &&
        entry.dose_input_unit
      ) {
        // An echoed amount is metadata, not a stale numeric correction.
        const { dose_mg: _echoedDose, ...metadata } = data;
        void _echoedDose;
        data = metadata;
      }
    }
    if (data.dose_mg !== undefined) {
      manualQuantityTransaction = true;
      const ref = await client.query(
        'SELECT medication_id,pen_id FROM injection_entries WHERE id=$1 AND user_id=$2',
        [id, userId]
      );
      if (ref.rows[0]?.medication_id)
        await lockDrawMedication(client, userId, ref.rows[0].medication_id);
      manualPenId = ref.rows[0]?.pen_id ?? null;
      if (manualPenId)
        await client.query(
          'SELECT id FROM medication_pens WHERE id=$1 AND user_id=$2 FOR UPDATE',
          [manualPenId, userId]
        );
      await client.query(
        'SELECT id FROM injection_entries WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [id, userId]
      );
    }
    if (data.site !== undefined) {
      const route = await client.query(
        'SELECT administration_route FROM injection_entries WHERE id=$1 AND user_id=$2',
        [id, userId]
      );
      if (route.rows[0]?.administration_route === 'nasal')
        data = { ...data, site: null };
    }
    const updates: string[] = [];
    const values: unknown[] = [id, userId];
    let index = 3;

    const fields: (keyof UpdateInjectionBody)[] = [
      ...courseLogFields,
      'scheduled_for',
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
      await client.query('COMMIT');
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
    if (manualQuantityTransaction) {
      if (manualPenId)
        await client.query(
          `UPDATE medication_pens SET status=CASE WHEN finished_at IS NOT NULL OR status='discarded' THEN status WHEN ${MASS_STOCK_SQL} THEN CASE WHEN ${USED_MASS_SQL} >= concentration_mg_ml*volume_ml THEN 'finished' ELSE 'in_use' END ELSE status END,updated_at=NOW() WHERE id=$1 AND user_id=$2`,
          [manualPenId, userId]
        );
      await client.query('COMMIT');
    }
    return result.rows[0] ?? null;
  } catch (error) {
    if (manualQuantityTransaction) await client.query('ROLLBACK');
    throw error;
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
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const original = await client.query(
      'SELECT * FROM injection_entries WHERE id=$1 AND user_id=$2',
      [id, userId]
    );
    await lockLogMedication(
      client,
      userId,
      original.rows[0]?.medication_id ?? null
    );
    if (
      original.rows[0]?.medication_id ||
      original.rows[0]?.course_revision_id ||
      original.rows[0]?.phase_family_id
    ) {
      const refreshed = await client.query<StoredCourseLog>(
        'SELECT * FROM injection_entries WHERE id=$1 AND user_id=$2',
        [id, userId]
      );
      if (refreshed.rows[0])
        await lockStoredCourseLog(
          client,
          userId,
          refreshed.rows[0],
          'injection'
        );
    }
    if (original.rows[0]?.pen_id)
      await client.query(
        'SELECT id FROM medication_pens WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [original.rows[0].pen_id, userId]
      );
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
                 WHEN finished_at IS NOT NULL OR status = 'discarded' THEN status
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
