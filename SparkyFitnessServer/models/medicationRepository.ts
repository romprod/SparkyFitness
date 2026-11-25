import type { Medication, MedicationSchedule } from '@workspace/shared';
import type { PoolClient } from 'pg';
import {
  guardLegacyScheduleMutation,
  transitionCourseMedicationActivity,
} from './medicationCourseRepository.js';
import { lockLogMedication } from '../services/medicationCourseLogService.js';
import { getClient } from '../db/poolManager.js';
import type {
  CreateMedicationBody,
  UpdateMedicationBody,
  CreateScheduleBody,
  UpdateScheduleBody,
  MoveSchedulesBody,
} from '../schemas/medicationSchemas.js';

// Column lists kept in one place so SELECTs stay consistent.
type MedicationRow = Medication;
type ScheduleRow = MedicationSchedule;

const MED_COLS = `id, user_id, name, display_name, type_id, route_id,
  strength_value, strength_unit, dose_amount, dose_unit, rxnorm_rxcui, ndc,
  prescriber, pharmacy, rx_number, reason_text, effectiveness_rating,
  color, icon, photo_path, is_active, is_quick, is_glp1, is_supplement, nutrients, notes,
  source, custom_fields, created_at, updated_at`;

const SCHEDULE_COLS = `id, medication_id, user_id, schedule_type_id, time_of_day,
  dose_amount, days_of_week, interval_days, day_of_month, cycle_on_days, cycle_off_days,
  with_meal, prn_reason, prn_max_per_day, start_date, end_date, active,
  source, custom_fields, created_at, updated_at`;

/** `joined` is a client whose transaction the caller owns; the caller releases it. */
async function createMedication(
  userId: string,
  data: CreateMedicationBody,
  joined?: PoolClient
) {
  const client: PoolClient = joined ?? (await getClient(userId));
  try {
    const result = await client.query(
      `INSERT INTO medications (
         user_id, name, display_name, type_id, route_id, strength_value, strength_unit,
         dose_amount, dose_unit, rxnorm_rxcui, ndc, prescriber, pharmacy, rx_number,
         reason_text, effectiveness_rating, color, icon, photo_path, is_active, is_quick,
         is_glp1, is_supplement, nutrients, notes, source, custom_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         COALESCE($20, TRUE), COALESCE($21, FALSE), COALESCE($22, FALSE),
         COALESCE($23, FALSE), COALESCE($24, '{}'::jsonb), $25,
         COALESCE($26, 'manual'), COALESCE($27, '{}'::jsonb))
       RETURNING ${MED_COLS}`,
      [
        userId,
        data.name,
        data.display_name ?? null,
        data.type_id ?? null,
        data.route_id ?? null,
        data.strength_value ?? null,
        data.strength_unit ?? null,
        data.dose_amount ?? null,
        data.dose_unit ?? null,
        data.rxnorm_rxcui ?? null,
        data.ndc ?? null,
        data.prescriber ?? null,
        data.pharmacy ?? null,
        data.rx_number ?? null,
        data.reason_text ?? null,
        data.effectiveness_rating ?? null,
        data.color ?? null,
        data.icon ?? null,
        data.photo_path ?? null,
        data.is_active ?? null,
        data.is_quick ?? null,
        data.is_glp1 ?? null,
        data.is_supplement ?? null,
        data.nutrients ? JSON.stringify(data.nutrients) : null,
        data.notes ?? null,
        data.source ?? null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
      ]
    );
    return result.rows[0];
  } finally {
    if (!joined) client.release();
  }
}

async function listMedications(
  userId: string,
  opts: { glp1Only?: boolean; activeOnly?: boolean } = {}
) {
  const client: PoolClient = await getClient(userId);
  try {
    const where: string[] = ['user_id = $1'];
    if (opts.glp1Only) where.push('is_glp1 = TRUE');
    if (opts.activeOnly) where.push('is_active = TRUE');
    const medsResult = await client.query<MedicationRow>(
      `SELECT ${MED_COLS} FROM medications
       WHERE ${where.join(' AND ')}
       ORDER BY is_active DESC, name ASC`,
      [userId]
    );

    if (medsResult.rows.length === 0) return [];

    const medIds = medsResult.rows.map((m) => m.id);
    const schedulesResult = await client.query<ScheduleRow>(
      `SELECT ${SCHEDULE_COLS} FROM medication_schedules
       WHERE medication_id = ANY($1) AND user_id = $2
       ORDER BY time_of_day NULLS LAST, created_at ASC`,
      [medIds, userId]
    );

    const schedulesByMedId: Record<string, ScheduleRow[]> = {};
    for (const sched of schedulesResult.rows) {
      if (!schedulesByMedId[sched.medication_id]) {
        schedulesByMedId[sched.medication_id] = [];
      }
      schedulesByMedId[sched.medication_id].push(sched);
    }

    return medsResult.rows.map((med) => ({
      ...med,
      schedules: schedulesByMedId[med.id] || [],
    }));
  } finally {
    client.release();
  }
}

async function getMedicationById(userId: string, id: string) {
  const client: PoolClient = await getClient(userId);
  try {
    const med = await client.query(
      `SELECT ${MED_COLS} FROM medications WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (!med.rows[0]) return null;
    const schedules = await client.query(
      `SELECT ${SCHEDULE_COLS} FROM medication_schedules
       WHERE medication_id = $1 AND user_id = $2 ORDER BY time_of_day NULLS LAST, created_at ASC`,
      [id, userId]
    );
    return { ...med.rows[0], schedules: schedules.rows };
  } finally {
    client.release();
  }
}

async function updateMedication(
  userId: string,
  id: string,
  data: UpdateMedicationBody
) {
  const client: PoolClient = await getClient(userId);
  const activityTransaction = data.is_active !== undefined;
  let activeBefore: boolean | undefined;
  try {
    if (activityTransaction) {
      await client.query('BEGIN');
      const previous = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM medications WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [id, userId]
      );
      activeBefore = previous.rows[0]?.is_active;
    }

    const updates: string[] = [];
    const values: unknown[] = [id, userId];
    let index = 3;

    const fields: (keyof UpdateMedicationBody)[] = [
      'name',
      'display_name',
      'type_id',
      'route_id',
      'strength_value',
      'strength_unit',
      'dose_amount',
      'dose_unit',
      'rxnorm_rxcui',
      'ndc',
      'prescriber',
      'pharmacy',
      'rx_number',
      'reason_text',
      'effectiveness_rating',
      'color',
      'icon',
      'photo_path',
      'is_active',
      'is_quick',
      'is_glp1',
      'is_supplement',
      'nutrients',
      'notes',
      'custom_fields',
    ];

    for (const key of fields) {
      if (data[key] !== undefined) {
        updates.push(`${key} = $${index}`);
        if (key === 'custom_fields' || key === 'nutrients') {
          const jsonValue = data[key];
          values.push(jsonValue ? JSON.stringify(jsonValue) : '{}');
        } else {
          values.push(data[key]);
        }
        index++;
      }
    }

    if (updates.length === 0) {
      const current = await client.query(
        `SELECT ${MED_COLS} FROM medications WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (activityTransaction) await client.query('COMMIT');
      return current.rows[0] ?? null;
    }

    const query = `UPDATE medications SET
                     ${updates.join(',\n')},
                     updated_at = NOW()
                   WHERE id = $1 AND user_id = $2
                   RETURNING ${MED_COLS}`;

    const result = await client.query(query, values);
    if (activityTransaction) {
      if (activeBefore !== undefined && data.is_active !== undefined)
        await transitionCourseMedicationActivity(
          client,
          userId,
          id,
          activeBefore,
          data.is_active
        );
      await client.query('COMMIT');
    }
    return result.rows[0] ?? null;
  } catch (error) {
    if (activityTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteMedication(userId: string, id: string) {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM medications WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // A component of a blend stays until it is taken out of the blend: dropping it would
    // quietly change every share.
    if (
      (error as { constraint?: string }).constraint ===
      'medication_blend_components_component_fk'
    ) {
      const blends = await client.query<{ name: string }>(
        `SELECT DISTINCT COALESCE(NULLIF(b.display_name, ''), b.name) AS name
           FROM medication_blend_components c
           JOIN medications b ON b.id = c.blend_medication_id
          WHERE c.component_medication_id = $1
          ORDER BY 1`,
        [id]
      );
      throw Object.assign(
        new Error(
          `This medication is a component of ${blends.rows.map((r) => r.name).join(', ')}. Remove it from the blend before deleting it.`
        ),
        { statusCode: 409, status: 409 }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

// --- Schedules ------------------------------------------------------------

async function addSchedule(
  userId: string,
  medicationId: string,
  data: CreateScheduleBody
) {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO medication_schedules (
         medication_id, user_id, schedule_type_id, time_of_day, dose_amount, days_of_week,
         interval_days, day_of_month, cycle_on_days, cycle_off_days, with_meal,
         prn_reason, prn_max_per_day, start_date, end_date, active, source, custom_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         COALESCE($16, TRUE), COALESCE($17,'manual'), COALESCE($18,'{}'::jsonb))
       RETURNING ${SCHEDULE_COLS}`,
      [
        medicationId,
        userId,
        data.schedule_type_id,
        data.time_of_day ?? null,
        data.dose_amount ?? null,
        data.days_of_week ?? null,
        data.interval_days ?? null,
        data.day_of_month ?? null,
        data.cycle_on_days ?? null,
        data.cycle_off_days ?? null,
        data.with_meal ?? null,
        data.prn_reason ?? null,
        data.prn_max_per_day ?? null,
        data.start_date ?? null,
        data.end_date ?? null,
        data.active ?? null,
        data.source ?? null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function updateSchedule(
  userId: string,
  scheduleId: string,
  data: UpdateScheduleBody
) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const parent = await client.query<{ medication_id: string }>(
      'SELECT medication_id FROM medication_schedules WHERE id=$1 AND user_id=$2',
      [scheduleId, userId]
    );
    await lockLogMedication(
      client,
      userId,
      parent.rows[0]?.medication_id ?? null
    );
    await client.query(
      'SELECT id FROM medication_schedules WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [scheduleId, userId]
    );
    await guardLegacyScheduleMutation(client, userId, scheduleId, data);

    const updates: string[] = [];
    const values: unknown[] = [scheduleId, userId];
    let index = 3;

    // source is deliberately absent — it is set at creation and never updated.
    const fields: (keyof UpdateScheduleBody)[] = [
      'schedule_type_id',
      'time_of_day',
      'dose_amount',
      'days_of_week',
      'interval_days',
      'day_of_month',
      'cycle_on_days',
      'cycle_off_days',
      'with_meal',
      'prn_reason',
      'prn_max_per_day',
      'start_date',
      'end_date',
      'active',
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
        `SELECT ${SCHEDULE_COLS} FROM medication_schedules WHERE id = $1 AND user_id = $2`,
        [scheduleId, userId]
      );
      await client.query('COMMIT');
      return current.rows[0] ?? null;
    }

    const result = await client.query(
      `UPDATE medication_schedules SET
         ${updates.join(',\n')},
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SCHEDULE_COLS}`,
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

async function deleteSchedule(userId: string, scheduleId: string) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const parent = await client.query<{ medication_id: string }>(
      'SELECT medication_id FROM medication_schedules WHERE id=$1 AND user_id=$2',
      [scheduleId, userId]
    );
    await lockLogMedication(
      client,
      userId,
      parent.rows[0]?.medication_id ?? null
    );
    await client.query(
      'SELECT id FROM medication_schedules WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [scheduleId, userId]
    );
    await guardLegacyScheduleMutation(client, userId, scheduleId, null);

    const result = await client.query(
      'DELETE FROM medication_schedules WHERE id = $1 AND user_id = $2 RETURNING id',
      [scheduleId, userId]
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

type MovableScheduleRow = ScheduleRow & {
  source: string | null;
  custom_fields: Record<string, unknown> | null;
};

const moveProblem = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.parse(day + 'T00:00:00Z') / DAY_MS;

/**
 * Ends the named plain schedules and starts copies the day after, in one transaction, so history
 * keeps the rules that were in force and the medication is never left with none or with both.
 * Weekly rules start on `end_date + 1` with their weekdays rotated; every-N-days rules start
 * exactly N days after `end_date`, which is the roll from the dose taken on `end_date`.
 */
async function moveSchedules(
  userId: string,
  medicationId: string,
  body: MoveSchedulesBody
) {
  const ids = [...new Set(body.schedule_ids)];
  const gap = dayNumber(body.new_start_date) - dayNumber(body.end_date);
  if (!(gap >= 1))
    throw moveProblem(
      'The moved schedule must start after the old one ends.',
      422
    );
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await lockLogMedication(client, userId, medicationId);
    const found = await client.query<MovableScheduleRow>(
      `SELECT id, medication_id, schedule_type_id, time_of_day, dose_amount, days_of_week,
              interval_days, day_of_month, cycle_on_days, cycle_off_days, with_meal,
              prn_reason, prn_max_per_day, start_date::text AS start_date,
              end_date::text AS end_date, active, source, custom_fields
         FROM medication_schedules
        WHERE user_id = $1 AND medication_id = $2 AND id = ANY($3::uuid[])
        ORDER BY id FOR UPDATE`,
      [userId, medicationId, ids]
    );
    if (found.rows.length !== ids.length)
      throw moveProblem('Schedule not found.', 404);
    const handed = await client.query(
      'SELECT 1 FROM medication_course_handoffs WHERE user_id = $1 AND schedule_id = ANY($2::uuid[])',
      [userId, ids]
    );
    if ((handed.rowCount ?? 0) > 0)
      throw moveProblem(
        'This schedule is retained for a course. Edit the course instead.'
      );

    const created: ScheduleRow[] = [];
    for (const row of found.rows) {
      const type = row.schedule_type_id;
      const weekly = type === 'weekly' || type === 'specific_days';
      if (row.active === false)
        throw moveProblem('Only an active schedule can be moved.', 422);
      if (weekly) {
        if (!row.days_of_week?.length || body.rotate_days === undefined)
          throw moveProblem(
            'A weekly schedule needs the days to rotate by.',
            422
          );
        if (gap !== 1)
          throw moveProblem(
            'A weekly move starts the day after the old rule ends.',
            422
          );
      } else if (type === 'every_n_days') {
        if (body.rotate_days !== undefined)
          throw moveProblem('An every-N-days schedule is not rotated.', 422);
        if (!row.interval_days || gap !== row.interval_days || !row.start_date)
          throw moveProblem(
            'An every-N-days move starts one interval after the dose.',
            422
          );
      } else {
        throw moveProblem('This kind of schedule cannot be moved.', 422);
      }
      if (row.start_date && body.end_date < row.start_date)
        throw moveProblem('The old schedule cannot end before it starts.', 422);
      if (row.end_date && row.end_date < body.new_start_date)
        throw moveProblem(
          'This schedule ends before the move would start.',
          422
        );

      const days = weekly
        ? [
            ...new Set(
              (row.days_of_week ?? []).map(
                (day) => (day + body.rotate_days!) % 7
              )
            ),
          ].sort((a, b) => a - b)
        : (row.days_of_week ?? null);
      await client.query(
        'UPDATE medication_schedules SET end_date = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2',
        [row.id, userId, body.end_date]
      );
      const copy = await client.query<ScheduleRow>(
        `INSERT INTO medication_schedules (
           medication_id, user_id, schedule_type_id, time_of_day, dose_amount, days_of_week,
           interval_days, day_of_month, cycle_on_days, cycle_off_days, with_meal,
           prn_reason, prn_max_per_day, start_date, end_date, active, source, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,$16,$17)
         RETURNING ${SCHEDULE_COLS}`,
        [
          medicationId,
          userId,
          row.schedule_type_id,
          row.time_of_day,
          row.dose_amount,
          days,
          row.interval_days,
          row.day_of_month,
          row.cycle_on_days,
          row.cycle_off_days,
          row.with_meal,
          row.prn_reason,
          row.prn_max_per_day,
          body.new_start_date,
          row.end_date,
          row.source,
          JSON.stringify(row.custom_fields ?? {}),
        ]
      );
      created.push(copy.rows[0]!);
    }
    await client.query('COMMIT');
    return { ended_ids: found.rows.map((row) => row.id), created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export {
  createMedication,
  listMedications,
  getMedicationById,
  updateMedication,
  deleteMedication,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  moveSchedules,
};
export default {
  createMedication,
  listMedications,
  getMedicationById,
  updateMedication,
  deleteMedication,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  moveSchedules,
};
