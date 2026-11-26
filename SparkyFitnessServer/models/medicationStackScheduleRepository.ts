import type { PoolClient } from 'pg';
import {
  courseBucket,
  type MedicationStackSchedule,
  type StackTiming,
} from '@workspace/shared';
import { courseProblem } from './medicationCourseRepository.js';

/**
 * SQL for stack schedules and the bindings that say which medicines follow
 * them. Every function takes the caller's client: the schedule service owns the
 * transaction and the lock order (stack, then medicines by ascending id, then
 * each medicine's course).
 */

const TIME = "to_char(time_of_day, 'HH24:MI:SS')";
const SCHEDULE_COLUMNS = `stack_id, ${TIME} AS time_of_day, schedule_type_id, days_of_week, interval_days,
  cycle_on_days, cycle_off_days, start_date::text AS start_date, version, updated_at`;

export interface StoredStackSchedule extends StackTiming {
  stack_id: string;
  version: number;
  updated_at: string;
}
type ScheduleRow = Omit<StoredStackSchedule, 'updated_at' | 'time_of_day'> & {
  time_of_day: string | null;
  updated_at: Date | string;
};
const normalTime = (time: string | null) =>
  time && time.length === 8 && time.endsWith(':00') ? time.slice(0, 5) : time;
export const storedSchedule = (row: ScheduleRow): StoredStackSchedule => ({
  ...row,
  time_of_day: normalTime(row.time_of_day),
  updated_at: new Date(row.updated_at).toISOString(),
});
export const publicSchedule = (
  row: StoredStackSchedule
): MedicationStackSchedule => {
  const { stack_id: _stack, ...rest } = row;
  return rest;
};

/** Serialises every writer of one stack. First in the lock order. */
export async function lockStack(
  client: PoolClient,
  owner: string,
  stackId: string
): Promise<{ id: string; name: string }> {
  const { rows } = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM medication_stacks WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [stackId, owner]
  );
  if (!rows[0]) throw courseProblem('Stack not found.', 404);
  return rows[0];
}

export async function loadSchedule(
  client: PoolClient,
  owner: string,
  stackId: string
): Promise<StoredStackSchedule | null> {
  const { rows } = await client.query<ScheduleRow>(
    `SELECT ${SCHEDULE_COLUMNS} FROM medication_stack_schedules WHERE stack_id = $1 AND user_id = $2`,
    [stackId, owner]
  );
  return rows[0] ? storedSchedule(rows[0]) : null;
}

const values = (schedule: StackTiming) => [
  schedule.schedule_type_id,
  schedule.time_of_day,
  schedule.days_of_week,
  schedule.interval_days,
  schedule.cycle_on_days,
  schedule.cycle_off_days,
  schedule.start_date,
];

export async function insertSchedule(
  client: PoolClient,
  owner: string,
  stackId: string,
  schedule: StackTiming
): Promise<StoredStackSchedule> {
  const { rows } = await client.query<ScheduleRow>(
    `INSERT INTO medication_stack_schedules(stack_id, user_id, schedule_type_id, time_of_day, days_of_week, interval_days, cycle_on_days, cycle_off_days, start_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${SCHEDULE_COLUMNS}`,
    [stackId, owner, ...values(schedule)]
  );
  return storedSchedule(rows[0]!);
}

export async function updateSchedule(
  client: PoolClient,
  owner: string,
  stackId: string,
  schedule: StackTiming
): Promise<StoredStackSchedule> {
  const { rows } = await client.query<ScheduleRow>(
    `UPDATE medication_stack_schedules
     SET schedule_type_id = $3, time_of_day = $4, days_of_week = $5, interval_days = $6,
         cycle_on_days = $7, cycle_off_days = $8, start_date = $9, version = version + 1
     WHERE stack_id = $1 AND user_id = $2 RETURNING ${SCHEDULE_COLUMNS}`,
    [stackId, owner, ...values(schedule)]
  );
  return storedSchedule(rows[0]!);
}

/** The bindings go with it (ON DELETE CASCADE). */
export async function deleteSchedule(
  client: PoolClient,
  owner: string,
  stackId: string
): Promise<void> {
  await client.query(
    'DELETE FROM medication_stack_schedules WHERE stack_id = $1 AND user_id = $2',
    [stackId, owner]
  );
}

/** Locks the medicines one by one in ascending id order. PostgreSQL does not promise lock order for ORDER BY ... FOR UPDATE. */
export async function lockMedicinesAscending(
  client: PoolClient,
  owner: string,
  medicationIds: string[]
): Promise<Map<string, { name: string; is_active: boolean }>> {
  const found = new Map<string, { name: string; is_active: boolean }>();
  for (const id of [...new Set(medicationIds)].sort()) {
    const { rows } = await client.query<{
      id: string;
      name: string;
      is_active: boolean;
    }>(
      `SELECT id, COALESCE(NULLIF(display_name, ''), name) AS name, is_active
       FROM medications WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [owner, id]
    );
    if (rows[0])
      found.set(id, { name: rows[0].name, is_active: rows[0].is_active });
  }
  return found;
}

export interface MemberRow {
  medication_id: string;
  position: number;
}
export async function stackMemberRows(
  client: PoolClient,
  owner: string,
  stackId: string
): Promise<MemberRow[]> {
  const { rows } = await client.query<MemberRow>(
    'SELECT medication_id, position FROM medication_stack_members WHERE stack_id = $1 AND user_id = $2 ORDER BY position, medication_id',
    [stackId, owner]
  );
  return rows;
}

export interface BindingRow {
  medication_id: string;
  stack_id: string;
  applied_version: number;
}
export async function stackBindings(
  client: PoolClient,
  owner: string,
  stackId: string
): Promise<Map<string, BindingRow>> {
  const { rows } = await client.query<BindingRow>(
    'SELECT medication_id, stack_id, applied_version FROM medication_stack_schedule_bindings WHERE stack_id = $1 AND user_id = $2',
    [stackId, owner]
  );
  return new Map(rows.map((row) => [row.medication_id, row]));
}

/** For each medicine, the other stack whose schedule it follows (name included). */
export async function otherStackBindings(
  client: PoolClient,
  owner: string,
  stackId: string,
  medicationIds: string[]
): Promise<Map<string, string>> {
  if (!medicationIds.length) return new Map();
  const { rows } = await client.query<{
    medication_id: string;
    name: string;
  }>(
    `SELECT b.medication_id, s.name
     FROM medication_stack_schedule_bindings b
     JOIN medication_stacks s ON s.id = b.stack_id AND s.user_id = b.user_id
     WHERE b.user_id = $1 AND b.stack_id <> $2 AND b.medication_id = ANY($3::uuid[])`,
    [owner, stackId, medicationIds]
  );
  return new Map(rows.map((row) => [row.medication_id, row.name]));
}

/**
 * Binds a medicine to the stack. A medicine follows at most one stack: a binding
 * to another stack (a concurrent save on a sibling stack) is a 409.
 */
export async function bindMedication(
  client: PoolClient,
  owner: string,
  stackId: string,
  medicationId: string,
  appliedVersion: number | null
): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO medication_stack_schedule_bindings(medication_id, stack_id, user_id, applied_version)
     VALUES ($1, $2, $3, COALESCE($4, 0))
     ON CONFLICT (medication_id) DO UPDATE
       SET applied_version = COALESCE($4, medication_stack_schedule_bindings.applied_version)
       WHERE medication_stack_schedule_bindings.stack_id = EXCLUDED.stack_id`,
    [medicationId, stackId, owner, appliedVersion]
  );
  if (!rowCount)
    throw courseProblem(
      'That medicine already follows the schedule of another stack.'
    );
}

export interface FollowedSchedule extends StoredStackSchedule {
  stack_name: string;
  applied_version: number;
}
/** The schedule a medicine follows, if any: one primary-key probe for medicines that follow nothing. */
export async function followedSchedule(
  client: PoolClient,
  owner: string,
  medicationId: string
): Promise<FollowedSchedule | null> {
  const { rows } = await client.query<
    ScheduleRow & { stack_name: string; applied_version: number }
  >(
    `SELECT s.stack_id, ${TIME.replace('time_of_day', 's.time_of_day')} AS time_of_day, s.schedule_type_id, s.days_of_week,
       s.interval_days, s.cycle_on_days, s.cycle_off_days, s.start_date::text AS start_date, s.version, s.updated_at,
       st.name AS stack_name, b.applied_version
     FROM medication_stack_schedule_bindings b
     JOIN medication_stack_schedules s ON s.stack_id = b.stack_id AND s.user_id = b.user_id
     JOIN medication_stacks st ON st.id = b.stack_id AND st.user_id = b.user_id
     WHERE b.medication_id = $1 AND b.user_id = $2`,
    [medicationId, owner]
  );
  const row = rows[0];
  return row
    ? {
        ...storedSchedule(row),
        stack_name: row.stack_name,
        applied_version: row.applied_version,
      }
    : null;
}

export async function markApplied(
  client: PoolClient,
  owner: string,
  medicationId: string,
  version: number
): Promise<void> {
  await client.query(
    'UPDATE medication_stack_schedule_bindings SET applied_version = $3 WHERE medication_id = $1 AND user_id = $2',
    [medicationId, owner, version]
  );
}

type Reason =
  | 'has_own_schedule'
  | 'paused'
  | 'follows_other_stack'
  | 'latest_not_applied'
  | 'not_bound';
export interface MemberScheduleView {
  schedule_status: 'following' | 'pending' | 'not_following';
  schedule_note: Reason | null;
  schedule_note_stack_name: string | null;
  schedule_bound: boolean;
}

/**
 * How each member of the owner's scheduled stacks stands, for the stack list.
 * Keyed `${stackId}:${medicationId}`. Stacks without a schedule are not read.
 */
export async function memberScheduleViews(
  client: PoolClient,
  owner: string,
  today: string
): Promise<Map<string, MemberScheduleView>> {
  const { rows } = await client.query<{
    stack_id: string;
    medication_id: string;
    version: number;
    bound_stack_id: string | null;
    applied_version: number | null;
    bound_stack_name: string | null;
    tip_status: 'active' | 'paused' | 'completed' | null;
    tip_start: string | null;
    tip_end: string | null;
    legacy_running: boolean;
  }>(
    `SELECT sm.stack_id, sm.medication_id, s.version,
       b.stack_id AS bound_stack_id, b.applied_version, bs.name AS bound_stack_name,
       tip.status AS tip_status, tip.start_date::text AS tip_start, tip.end_date::text AS tip_end,
       EXISTS (
         SELECT 1 FROM medication_schedules ms
         WHERE ms.user_id = sm.user_id AND ms.medication_id = sm.medication_id AND ms.active = true
           AND (ms.end_date IS NULL OR ms.end_date >= $2::date)
       ) AS legacy_running
     FROM medication_stack_members sm
     JOIN medication_stack_schedules s ON s.stack_id = sm.stack_id AND s.user_id = sm.user_id
     LEFT JOIN medication_stack_schedule_bindings b ON b.medication_id = sm.medication_id AND b.user_id = sm.user_id
     LEFT JOIN medication_stacks bs ON bs.id = b.stack_id AND bs.user_id = b.user_id
     LEFT JOIN LATERAL (
       SELECT r.status, r.start_date, r.end_date
       FROM medication_courses c
       JOIN medication_course_revisions r ON r.id = c.current_revision_id AND r.user_id = c.user_id
       WHERE c.user_id = sm.user_id AND c.medication_id = sm.medication_id
         AND c.deleted_at IS NULL AND r.deleted_at IS NULL
       ORDER BY (r.status <> 'completed') DESC, c.captured_at DESC LIMIT 1
     ) tip ON true
     WHERE sm.user_id = $1`,
    [owner, today]
  );
  const views = new Map<string, MemberScheduleView>();
  for (const row of rows) {
    const here = row.bound_stack_id === row.stack_id;
    const live = row.tip_status
      ? ['active', 'scheduled', 'paused'].includes(
          courseBucket(
            {
              status: row.tip_status,
              start_date: row.tip_start,
              end_date: row.tip_end,
            },
            today
          )
        )
      : false;
    const paused = row.tip_status === 'paused';
    let view: MemberScheduleView;
    if (here) {
      if ((row.applied_version ?? 0) >= row.version)
        view = {
          schedule_status: 'following',
          schedule_note: null,
          schedule_note_stack_name: null,
          schedule_bound: true,
        };
      else if (live)
        view = {
          schedule_status: 'not_following',
          schedule_note: paused ? 'paused' : 'latest_not_applied',
          schedule_note_stack_name: null,
          schedule_bound: true,
        };
      else
        view = {
          schedule_status: 'pending',
          schedule_note: null,
          schedule_note_stack_name: null,
          schedule_bound: true,
        };
    } else {
      const other = row.bound_stack_id !== null;
      view = {
        schedule_status: 'not_following',
        schedule_note: other
          ? 'follows_other_stack'
          : row.legacy_running
            ? 'has_own_schedule'
            : paused
              ? 'paused'
              : 'not_bound',
        schedule_note_stack_name: other ? row.bound_stack_name : null,
        schedule_bound: false,
      };
    }
    views.set(`${row.stack_id}:${row.medication_id}`, view);
  }
  return views;
}
