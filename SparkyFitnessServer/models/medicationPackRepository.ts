import type { PoolClient } from 'pg';
import {
  instantToDay,
  isValidTimeZone,
  observedDaysLeft,
  packDeduction,
  packDosesLeft,
  packUnitFamily,
  planPackStock,
  type SharedScheduleRule,
  packUnitsRemaining,
  type MedicationPackCreate,
  type MedicationPackList,
  type MedicationPackUpdate,
  type MedicationPackView,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

export const PACK_WINDOW_DAYS = 14;
const TAKEN = ['taken', 'prn_taken'];

interface PackRow {
  id: string;
  medication_id: string;
  medication_name: string;
  med_dose_amount: string | null;
  med_dose_unit: string | null;
  label: string | null;
  unit_label: string;
  status: 'sealed' | 'in_use' | 'finished' | 'discarded';
  units_total: string;
  units_used: string;
  opened_at: string | null;
  expiry_date: string | null;
  lot_number: string | null;
  storage_location: string | null;
  reorder_threshold_units: string | null;
  notes: string | null;
}

const PACK_SELECT = `SELECT p.id, p.medication_id, COALESCE(m.display_name, m.name) AS medication_name,
  m.dose_amount::text AS med_dose_amount, m.dose_unit AS med_dose_unit,
  p.label, p.unit_label, p.status, p.units_total::text, p.units_used::text,
  p.opened_at::text, p.expiry_date::text, p.lot_number, p.storage_location,
  p.reorder_threshold_units::text, p.notes
  FROM medication_packs p JOIN medications m ON m.id = p.medication_id AND m.user_id = p.user_id`;

/** The owner's calendar day, from their stored timezone. */
export async function userToday(
  client: PoolClient,
  userId: string,
  now: Date = new Date()
): Promise<string> {
  const prefs = await client.query<{
    timezone: string | null;
    lead: number | null;
    buffer: number | null;
  }>(
    'SELECT timezone, medication_reorder_lead_days AS lead, medication_reorder_buffer_days AS buffer FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  const zone = prefs.rows[0]?.timezone;
  return instantToDay(now, zone && isValidTimeZone(zone) ? zone : 'UTC');
}

export function packView(
  row: PackRow,
  today: string,
  pace: { units: string; doses: number } | undefined,
  leadPlusBuffer: number,
  plan?: { emptyDate: string | null; daysLeft: number | null; last: boolean }
): MedicationPackView {
  const remaining = packUnitsRemaining(row.units_total, row.units_used);
  const dose = packDeduction({
    doseAmount: row.med_dose_amount,
    doseUnit: row.med_dose_unit,
    packUnitLabel: row.unit_label,
  });
  const open = row.status === 'in_use';
  const days =
    open && pace
      ? observedDaysLeft({
          remaining,
          unitsTakenInWindow: pace.units,
          dosesInWindow: pace.doses,
          windowDays: PACK_WINDOW_DAYS,
        })
      : null;
  const threshold = row.reorder_threshold_units;
  const lowByThreshold =
    threshold !== null &&
    (row.status === 'sealed' || open) &&
    Number(remaining) <= Number(threshold);
  const lowByPace = open && days !== null && days <= leadPlusBuffer;
  // Only the last stocked pack triggers a plan warning; a spare pack means no reorder yet.
  const lowByPlan =
    (open || row.status === 'sealed') &&
    !!plan?.last &&
    plan.daysLeft !== null &&
    plan.daysLeft <= leadPlusBuffer;
  return {
    id: row.id,
    medication_id: row.medication_id,
    medication_name: row.medication_name,
    label: row.label,
    unit_label: row.unit_label,
    status: row.status,
    units_total: row.units_total,
    units_used: row.units_used,
    units_remaining: remaining,
    overdrawn: Number(remaining) < 0,
    doses_left: dose.deducted ? packDosesLeft(remaining, dose.units) : null,
    observed_days_left: days,
    planned_days_left: plan?.daysLeft ?? null,
    planned_empty_date: plan?.emptyDate ?? null,
    low: lowByThreshold || lowByPace || lowByPlan,
    opened_at: row.opened_at,
    expiry_date: row.expiry_date,
    expired: row.expiry_date !== null && row.expiry_date < today,
    lot_number: row.lot_number,
    storage_location: row.storage_location,
    reorder_threshold_units: threshold,
    notes: row.notes,
  };
}

interface ScheduleRow {
  medication_id: string;
  schedule_type_id: string;
  time_of_day: string | null;
  dose_amount: string | null;
  days_of_week: number[] | null;
  interval_days: number | null;
  day_of_month: number | null;
  cycle_on_days: number | null;
  cycle_off_days: number | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  created_at: string | null;
}

/**
 * Schedule-based run-out for each pack, per medication, in the order logging would draw them.
 * Skipped for a medication with an active managed course (its plan is authoritative and is not
 * modelled here), when no schedule gives a dose, or when the dose unit differs from the pack unit.
 */
async function planFor(
  client: PoolClient,
  userId: string,
  rows: PackRow[],
  today: string
) {
  const result = new Map<
    string,
    { emptyDate: string | null; daysLeft: number | null; last: boolean }
  >();
  const stocked = rows.filter(
    (p) =>
      (p.status === 'in_use' || p.status === 'sealed') &&
      !(p.expiry_date !== null && p.expiry_date < today)
  );
  const medicationIds = [...new Set(stocked.map((p) => p.medication_id))];
  if (medicationIds.length === 0) return result;
  const zoneRow = await client.query<{ timezone: string | null }>(
    'SELECT timezone FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  const zone =
    zoneRow.rows[0]?.timezone && isValidTimeZone(zoneRow.rows[0].timezone)
      ? zoneRow.rows[0].timezone
      : 'UTC';
  const managed = new Set(
    (
      await client.query<{ medication_id: string }>(
        `SELECT DISTINCT c.medication_id FROM medication_courses c
           JOIN medication_course_revisions r ON r.id = c.current_revision_id AND r.user_id = c.user_id
          WHERE c.user_id = $1 AND c.deleted_at IS NULL AND r.status = 'active'
            AND c.medication_id = ANY($2::uuid[])`,
        [userId, medicationIds]
      )
    ).rows.map((r) => r.medication_id)
  );
  const schedules = await client.query<ScheduleRow>(
    `SELECT medication_id, schedule_type_id, time_of_day::text, dose_amount::text, days_of_week,
            interval_days, day_of_month, cycle_on_days, cycle_off_days,
            start_date::text, end_date::text, active, created_at::text
       FROM medication_schedules WHERE user_id = $1 AND medication_id = ANY($2::uuid[])`,
    [userId, medicationIds]
  );
  const takenToday = await client.query<{
    medication_id: string;
    taken: string;
  }>(
    `SELECT medication_id, count(*)::text AS taken FROM medication_entries
      WHERE user_id = $1 AND medication_id = ANY($2::uuid[]) AND status = ANY($3)
        AND entry_date = $4::date GROUP BY medication_id`,
    [userId, medicationIds, TAKEN, today]
  );
  for (const medicationId of medicationIds) {
    if (managed.has(medicationId)) continue;
    const packs = stocked.filter(
      (p) =>
        p.medication_id === medicationId &&
        packDeduction({
          doseAmount: p.med_dose_amount,
          doseUnit: p.med_dose_unit,
          packUnitLabel: p.unit_label,
        }).deducted
    );
    if (packs.length === 0) continue;
    const rules: SharedScheduleRule[] = schedules.rows
      .filter((r) => r.medication_id === medicationId)
      .map((r) => ({
        schedule_type_id: r.schedule_type_id,
        time_of_day: r.time_of_day,
        days_of_week: r.days_of_week,
        interval_days: r.interval_days,
        day_of_month: r.day_of_month,
        cycle_on_days: r.cycle_on_days,
        cycle_off_days: r.cycle_off_days,
        // Same fallback the checklist uses when a rule has no start date.
        start_date:
          r.start_date ??
          (r.created_at ? instantToDay(r.created_at, zone) : null),
        end_date: r.end_date,
        active: r.active,
        dose_amount: r.dose_amount === null ? null : Number(r.dose_amount),
      }));
    const planned = planPackStock({
      today,
      schedules: rules,
      defaultDoseAmount: packs[0]!.med_dose_amount,
      takenToday: Number(
        takenToday.rows.find((r) => r.medication_id === medicationId)?.taken ??
          0
      ),
      packs: packs.map((p) => ({
        id: p.id,
        remaining: packUnitsRemaining(p.units_total, p.units_used),
      })),
    });
    if (planned.noDemand) continue;
    packs.forEach((p, i) =>
      result.set(p.id, {
        ...planned.byPack.get(p.id)!,
        last: i === packs.length - 1,
      })
    );
  }
  return result;
}

/** Every pack the owner can see, with derived remaining, doses left and observed pace. */
export async function listPacks(
  userId: string,
  now: Date = new Date()
): Promise<MedicationPackList> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const today = await userToday(client, userId, now);
    const prefs = await client.query<{
      lead: number | null;
      buffer: number | null;
    }>(
      'SELECT medication_reorder_lead_days AS lead, medication_reorder_buffer_days AS buffer FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    const leadPlusBuffer =
      Number(prefs.rows[0]?.lead ?? 14) + Number(prefs.rows[0]?.buffer ?? 3);
    const packs = await client.query<PackRow>(
      `${PACK_SELECT} WHERE p.user_id = $1
       ORDER BY CASE p.status WHEN 'in_use' THEN 0 WHEN 'sealed' THEN 1 ELSE 2 END,
                p.expiry_date NULLS LAST, medication_name, p.created_at, p.id`,
      [userId]
    );
    const openMedications = [
      ...new Set(
        packs.rows
          .filter((p) => p.status === 'in_use')
          .map((p) => p.medication_id)
      ),
    ];
    const pace = new Map<string, { units: string; doses: number }>();
    if (openMedications.length > 0) {
      const taken = await client.query<{
        medication_id: string;
        dose_amount_snapshot: string | null;
        dose_unit_snapshot: string | null;
      }>(
        `SELECT medication_id, dose_amount_snapshot::text, dose_unit_snapshot
           FROM medication_entries
          WHERE user_id = $1 AND medication_id = ANY($2::uuid[]) AND status = ANY($3)
            AND entry_date > ($4::date - $5::int) AND entry_date <= $4::date`,
        [userId, openMedications, TAKEN, today, PACK_WINDOW_DAYS]
      );
      for (const pack of packs.rows.filter((p) => p.status === 'in_use')) {
        const family = packUnitFamily(pack.unit_label);
        let units = 0;
        let doses = 0;
        for (const row of taken.rows) {
          if (
            row.medication_id !== pack.medication_id ||
            packUnitFamily(row.dose_unit_snapshot) !== family
          )
            continue;
          units += Number(row.dose_amount_snapshot ?? 0);
          doses++;
        }
        pace.set(pack.id, { units: String(units), doses });
      }
    }
    const plans = await planFor(client, userId, packs.rows, today);
    const result = {
      today,
      packs: packs.rows.map((row) =>
        packView(
          row,
          today,
          pace.get(row.id),
          leadPlusBuffer,
          plans.get(row.id)
        )
      ),
    };
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const invalid = (message: string) =>
  Object.assign(new Error(message), { statusCode: 422 });

export async function createPack(
  userId: string,
  medicationId: string,
  data: MedicationPackCreate
) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const med = await client.query(
      'SELECT 1 FROM medications WHERE id = $1 AND user_id = $2',
      [medicationId, userId]
    );
    if (med.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const status = data.status ?? 'sealed';
    const used = data.units_used ?? 0;
    if (status === 'finished' || status === 'discarded')
      throw invalid('Add a pack as sealed or in use.');
    const today = await userToday(client, userId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO medication_packs (medication_id, user_id, label, unit_label, units_total, units_used,
         status, opened_at, expiry_date, lot_number, storage_location, reorder_threshold_units, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        medicationId,
        userId,
        data.label ?? null,
        data.unit_label.trim(),
        data.units_total,
        used,
        status,
        status === 'in_use' ? today : null,
        data.expiry_date ?? null,
        data.lot_number ?? null,
        data.storage_location ?? null,
        data.reorder_threshold_units ?? null,
        data.notes ?? null,
      ]
    );
    await client.query('COMMIT');
    return inserted.rows[0]!.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePack(
  userId: string,
  id: string,
  data: MedicationPackUpdate
): Promise<boolean> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const existing = await client.query<{
      status: string;
      units_total: string;
      units_used: string;
    }>(
      'SELECT status, units_total::text, units_used::text FROM medication_packs WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId]
    );
    const current = existing.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return false;
    }
    if (
      data.status !== undefined &&
      data.status !== current.status &&
      !data.lifecycle_intent
    )
      throw invalid(
        'Use an explicit lifecycle action to change a pack status.'
      );
    if (
      data.units_total !== undefined &&
      data.units_used === undefined &&
      Number(data.units_total) <= 0
    )
      throw invalid('A pack needs a positive total.');
    const today = await userToday(client, userId);
    const sets: string[] = [];
    const values: unknown[] = [id, userId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (data.label !== undefined) add('label', data.label);
    if (data.unit_label !== undefined)
      add('unit_label', data.unit_label.trim());
    if (data.units_total !== undefined) add('units_total', data.units_total);
    if (data.units_used !== undefined) add('units_used', data.units_used);
    if (data.expiry_date !== undefined) add('expiry_date', data.expiry_date);
    if (data.lot_number !== undefined) add('lot_number', data.lot_number);
    if (data.storage_location !== undefined)
      add('storage_location', data.storage_location);
    if (data.reorder_threshold_units !== undefined)
      add('reorder_threshold_units', data.reorder_threshold_units);
    if (data.notes !== undefined) add('notes', data.notes);
    if (data.status !== undefined && data.status !== current.status) {
      add('status', data.status);
      if (data.status === 'in_use')
        sets.push(`opened_at = COALESCE(opened_at, '${today}'::date)`);
      if (data.status === 'finished' || data.status === 'discarded')
        sets.push('finished_at = NOW()');
      else sets.push('finished_at = NULL');
    }
    if (sets.length > 0)
      await client.query(
        `UPDATE medication_packs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        values
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

export async function deletePack(userId: string, id: string): Promise<boolean> {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM medication_packs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}
