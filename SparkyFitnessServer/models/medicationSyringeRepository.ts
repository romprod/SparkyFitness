import type {
  CalculatedDrawInput,
  DrawPreviewInput,
  MedicationSyringe,
  MedicationSyringeInput,
} from '@workspace/shared';
import {
  computeDraw,
  drawConcentration,
  normalizeMedicationDevice,
  normalizeDeviceDose,
  resolvePreparedMedicationRoute,
  isDeviceEligibleForRoute,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { badPreparation } from '../services/medicationPreparationService.js';
const COLS =
  's.id,s.name,s.device_type,s.graduation_type,s.units_per_ml,s.capacity_ml::text,s.capacity_units,s.increment::text,(s.user_id IS NULL) AS is_shared,(s.id=(SELECT default_syringe_id FROM medication_device_preferences WHERE user_id=$1)) IS TRUE AS is_default,s.created_at,s.updated_at';
export interface StoredDrawContext {
  vial: Record<string, unknown>;
  device: MedicationSyringe;
  previous: Record<string, unknown> | null;
  concentrationMcgPerMl: string;
}
export async function listSyringes(userId: string) {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query<MedicationSyringe>(
      `SELECT ${COLS} FROM medication_syringes s WHERE s.user_id=$1 OR s.user_id IS NULL ORDER BY s.name,s.id`,
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
    await client.query('BEGIN');
    // Older clients omit the newly introduced category on edits. Preserve it
    // rather than turning an existing pen or pump into a syringe.
    if (id && data.device_type === undefined) {
      const existing = await client.query<MedicationSyringe>(
        `SELECT ${COLS} FROM medication_syringes s WHERE s.user_id=$1 AND s.id=$2 FOR UPDATE`,
        [userId, id]
      );
      if (!existing.rows[0]) {
        await client.query('COMMIT');
        return null;
      }
      data = {
        ...data,
        device_type: existing.rows[0].device_type ?? 'syringe',
      };
    }
    const normalized = normalizeMedicationDevice(data);
    const values = [
      userId,
      normalized.name,
      normalized.graduation_type,
      normalized.units_per_ml,
      normalized.capacity_ml,
      normalized.capacity_units,
      normalized.increment,
      normalized.device_type,
    ];
    const result = id
      ? await client.query(
          `UPDATE medication_syringes s SET name=$2,graduation_type=$3,units_per_ml=$4,capacity_ml=$5,capacity_units=$6,increment=$7,device_type=$8,updated_at=NOW() WHERE s.user_id=$1 AND s.id=$9 RETURNING ${COLS}`,
          [...values, id]
        )
      : await client.query(
          `INSERT INTO medication_syringes AS s(user_id,name,graduation_type,units_per_ml,capacity_ml,capacity_units,increment,device_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
          values
        );
    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
        'SELECT id FROM medication_syringes WHERE id=$1 AND (user_id=$2 OR user_id IS NULL)',
        [id, userId]
      );
      if (!row.rows[0]) throw badPreparation('Syringe not found.');
    }
    await client.query(
      `INSERT INTO medication_device_preferences(user_id,default_syringe_id) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET default_syringe_id=EXCLUDED.default_syringe_id`,
      [userId, id]
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
  editingInjectionId?: string,
  onContext?: (context: StoredDrawContext) => void
) {
  const vial = await client.query(
    `SELECT v.kind,v.medication_id,m.type_id,m.route_id,v.status,v.finished_at,v.concentration_mg_ml::text,v.volume_ml::text,v.doses_used,to_jsonb(p)::text AS preparation_state,
 p.id AS preparation_id,p.mass_value::text,p.mass_unit,p.final_volume_ml::text,
 (SELECT COALESCE(SUM(i.dose_mg),0)::text FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS used_mg,
 (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS linked_count,
 (SELECT COUNT(*) FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id AND (i.dose_mg IS NULL OR i.dose_mg<0 OR (i.dose_mg=0 AND (i.volume_ml IS NULL OR i.dose_input_unit IS NULL)))) AS missing_count
 FROM medication_pens v JOIN medications m ON m.id=v.medication_id AND m.user_id=v.user_id LEFT JOIN medication_preparations p ON p.pen_id=v.id AND p.user_id=v.user_id
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
    `SELECT ${COLS} FROM medication_syringes s WHERE s.id=$2 AND (s.user_id=$1 OR s.user_id IS NULL)`,
    [userId, input.syringe_id]
  );
  if (!syringe.rows[0]) throw badPreparation('Syringe not found.');
  let device = syringe.rows[0];
  // PostgreSQL row-locking SELECT also applies UPDATE policies. Shared devices
  // are deliberately read-only, so only lock/re-read an owned device. The FK
  // protects a shared reference against concurrent deletion when it is saved.
  if (device.is_shared === false) {
    const locked = await client.query<MedicationSyringe>(
      `SELECT ${COLS} FROM medication_syringes s WHERE s.id=$2 AND s.user_id=$1 FOR SHARE`,
      [userId, input.syringe_id]
    );
    if (!locked.rows[0]) throw badPreparation('Syringe not found.');
    device = locked.rows[0];
  }
  let credit = '0';
  let previous: Record<string, unknown> | null = null;
  if (editingInjectionId) {
    const original = await client.query(
      'SELECT id,updated_at::text,administration_route,pen_id,preparation_id,syringe_id,dose_mg::text,volume_ml::text,dose_input_unit FROM injection_entries WHERE id=$1 AND user_id=$2',
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
    previous = entry;
  }
  const snapshotRoute = previous?.administration_route;
  const route =
    snapshotRoute === 'injection' || snapshotRoute === 'nasal'
      ? snapshotRoute
      : resolvePreparedMedicationRoute(row);
  if (!route || !isDeviceEligibleForRoute(device.device_type, route))
    throw badPreparation('Device does not match the medication route.');
  let normalizedDose;
  try {
    normalizedDose = normalizeDeviceDose(input.dose, device);
  } catch {
    throw badPreparation('Dose unit does not match the selected device.');
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
    onContext?.({
      vial: row,
      device,
      previous,
      concentrationMcgPerMl: concentration,
    });
    return {
      ...computeDraw({
        dose: normalizedDose,
        concentrationMcgPerMl: concentration,
        syringe: device,
        ...(remaining === undefined ? {} : { remainingMl: remaining }),
      }),
      syringeCapacityMl: device.capacity_ml,
      administrationRoute: route,
      doseInputUnit: normalizedDose.unit,
      device: {
        id: device.id,
        device_type: device.device_type ?? 'syringe',
        increment: device.increment,
        capacity_ml: device.capacity_ml,
        graduation_type: device.graduation_type,
        units_per_ml: device.units_per_ml,
      },
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
