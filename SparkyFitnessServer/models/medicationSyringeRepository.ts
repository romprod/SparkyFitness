import type {
  CalculatedDrawInput,
  DrawPreviewInput,
  MedicationSyringe,
  MedicationSyringeInput,
} from '@workspace/shared';
import { computeDraw, drawConcentration } from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { badPreparation } from '../services/medicationPreparationService.js';
const COLS =
  'id,name,graduation_type,units_per_ml,capacity_ml::text,capacity_units,increment::text,is_default,created_at,updated_at';
export async function listSyringes(userId: string) {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query<MedicationSyringe>(
      `SELECT ${COLS} FROM medication_syringes WHERE user_id=$1 ORDER BY name,id`,
      [userId]
    );
    return {
      syringes: result.rows,
      default_syringe_id: result.rows.find((s) => s.is_default)?.id ?? null,
    };
  } finally {
    client.release();
  }
}
export async function saveSyringe(
  userId: string,
  data: MedicationSyringeInput,
  id?: string
) {
  const client: PoolClient = await getClient(userId);
  try {
    const values = [
      userId,
      data.name,
      data.graduation_type,
      data.units_per_ml,
      data.capacity_ml,
      data.capacity_units,
      data.increment,
    ];
    const result = id
      ? await client.query(
          `UPDATE medication_syringes SET name=$2,graduation_type=$3,units_per_ml=$4,capacity_ml=$5,capacity_units=$6,increment=$7,updated_at=NOW() WHERE user_id=$1 AND id=$8 RETURNING ${COLS}`,
          [...values, id]
        )
      : await client.query(
          `INSERT INTO medication_syringes(user_id,name,graduation_type,units_per_ml,capacity_ml,capacity_units,increment) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
          values
        );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}
export async function setDefaultSyringe(userId: string, id: string | null) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `medication-syringe-default:${userId}`,
    ]);
    if (id) {
      const row = await client.query(
        'SELECT id FROM medication_syringes WHERE id=$1 AND user_id=$2 FOR KEY SHARE',
        [id, userId]
      );
      if (!row.rows[0]) throw badPreparation('Syringe not found.');
    }
    await client.query(
      'UPDATE medication_syringes SET is_default=false WHERE user_id=$1 AND is_default',
      [userId]
    );
    if (id)
      await client.query(
        'UPDATE medication_syringes SET is_default=true WHERE id=$1 AND user_id=$2',
        [id, userId]
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function deleteSyringe(userId: string, id: string) {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM medication_syringes WHERE id=$1 AND user_id=$2 RETURNING id',
      [id, userId]
    );
    return result.rows.length > 0;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23503'
    )
      throw Object.assign(
        new Error('Syringe is linked to recorded doses and cannot be removed.'),
        { statusCode: 409 }
      );
    throw error;
  } finally {
    client.release();
  }
}
/** Caller holds the vial lock when this read is used for a write. */
export async function calculateStoredDraw(
  client: PoolClient,
  userId: string,
  penId: string,
  input: CalculatedDrawInput,
  medicationId?: string,
  editingInjectionId?: string
) {
  const vial = await client.query(
    `SELECT v.kind,v.medication_id,v.concentration_mg_ml::text,v.volume_ml::text,v.doses_used,
 p.id AS preparation_id,p.mass_value::text,p.mass_unit,p.final_volume_ml::text,
 (SELECT COALESCE(SUM(i.dose_mg),0)::text FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS used_mg,
 (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS linked_count,
 (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id AND (i.dose_mg IS NULL OR i.dose_mg<0 OR (i.dose_mg=0 AND (i.volume_ml IS NULL OR i.dose_input_unit IS NULL)))) AS missing_count
 FROM medication_pens v LEFT JOIN medication_preparations p ON p.pen_id=v.id AND p.user_id=v.user_id
 WHERE v.id=$1 AND v.user_id=$2`,
    [penId, userId]
  );
  const row = vial.rows[0];
  if (
    !row ||
    row.kind !== 'vial' ||
    (medicationId && row.medication_id !== medicationId)
  )
    throw badPreparation('Vial not found for this medication.');
  const syringe = await client.query<MedicationSyringe>(
    `SELECT ${COLS} FROM medication_syringes WHERE id=$1 AND user_id=$2 FOR SHARE`,
    [input.syringe_id, userId]
  );
  if (!syringe.rows[0]) throw badPreparation('Syringe not found.');
  let credit = '0';
  if (editingInjectionId) {
    const original = await client.query(
      'SELECT pen_id,preparation_id,syringe_id,dose_mg::text,volume_ml::text,dose_input_unit FROM injection_entries WHERE id=$1 AND user_id=$2',
      [editingInjectionId, userId]
    );
    const entry = original.rows[0];
    if (
      !entry ||
      entry.pen_id !== penId ||
      entry.preparation_id !== row.preparation_id ||
      entry.syringe_id !== input.syringe_id ||
      entry.volume_ml === null ||
      entry.dose_input_unit === null
    )
      throw badPreparation(
        'The edited injection does not match this vial, preparation and syringe.'
      );
    credit = entry.dose_mg;
  }
  const concentration = drawConcentration(
    row.mass_value !== null
      ? {
          mass_value: row.mass_value,
          mass_unit: row.mass_unit,
          final_volume_ml: row.final_volume_ml,
        }
      : { concentration_mg_ml: row.concentration_mg_ml ?? '0' }
  );
  // Exact decimal balance is required here; do not route through number-based display stock.
  const remaining =
    Number(row.missing_count) === 0 &&
    Number(row.doses_used) === Number(row.linked_count) &&
    row.volume_ml !== null
      ? remainingDrawVolume(
          concentration,
          row.final_volume_ml ?? row.volume_ml,
          row.used_mg,
          credit
        )
      : undefined;
  try {
    return {
      ...computeDraw({
        dose: input.dose,
        concentrationMcgPerMl: concentration,
        syringe: syringe.rows[0],
        ...(remaining === undefined ? {} : { remainingMl: remaining }),
      }),
      syringeCapacityMl: syringe.rows[0].capacity_ml,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Concentration must be greater than zero'
    ) {
      throw badPreparation(
        'A known positive vial concentration is required for draw calculations.'
      );
    }
    throw error;
  }
}
import { remainingDrawVolume } from '@workspace/shared';
export async function previewDraw(
  userId: string,
  penId: string,
  input: DrawPreviewInput
) {
  const client: PoolClient = await getClient(userId);
  try {
    return await calculateStoredDraw(
      client,
      userId,
      penId,
      input,
      undefined,
      input.editing_injection_id
    );
  } finally {
    client.release();
  }
}
