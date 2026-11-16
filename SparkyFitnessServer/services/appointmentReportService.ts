import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  addDays,
  instantToDay,
  isDayString,
  isValidTimeZone,
  exactLabResultValue,
  labRangeStatus,
  LAB_MARKER_PRESETS,
  normalizePurchaseDecimal,
  type AppointmentReportData,
} from '@workspace/shared';
import { getClient, dbContextStorage } from '../db/poolManager.js';
import reportRepository from '../models/reportRepository.js';
import { listLatestLabPanels } from '../models/labResultRepository.js';

const day = z.string().refine(isDayString);
export const appointmentReportQuerySchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    timezone: z.string().refine(isValidTimeZone).optional(),
    expected_owner_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['from'],
    message: 'from must not be after to',
  });
export type AppointmentReportQuery = z.infer<
  typeof appointmentReportQuerySchema
>;
const problem = (message: string, status: number) =>
  Object.assign(new Error(message), { status, statusCode: status });
const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const number = (value: unknown): number | null =>
  value === null ||
  value === undefined ||
  value === '' ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
function recordedInstant(value: unknown): number | null {
  if (
    !(value instanceof Date) &&
    (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value
      ))
  )
    return null;
  const instant = new Date(value).getTime();
  return Number.isFinite(instant) ? instant : null;
}
const recordedIso = (value: unknown): string | null => {
  const instant = recordedInstant(value);
  return instant === null ? null : new Date(instant).toISOString();
};
function timingDeltaMinutes(
  actual: unknown,
  scheduled: unknown,
  administered: boolean
): number | null {
  if (!administered) return null;
  const taken = recordedInstant(actual),
    due = recordedInstant(scheduled);
  return taken === null || due === null
    ? null
    : Math.round((taken - due) / 60_000);
}
type Row = Record<string, unknown>;
function knownDeliveredMass(row: Row): string | null {
  const recorded = text(row.dose_mg);
  const volume = text(row.volume_ml);
  // Validate NUMERIC strings without rounding or underflow through a JS number.
  const mass = recorded?.trim() ? normalizePurchaseDecimal(recorded) : null;
  if (
    mass === null ||
    (mass === '0' &&
      (volume === null ||
        !volume.trim() ||
        normalizePurchaseDecimal(volume) === null ||
        row.dose_input_unit === null ||
        row.dose_input_unit === undefined))
  )
    return null;
  return recorded;
}

/** Match saved explicit / weekday preset / carry-forward facts without app defaults or exercise adjustment. */
async function currentSavedHydrationTarget(
  client: PoolClient,
  owner: string,
  today: string
): Promise<number | null> {
  const explicit = await client.query<{ water_goal_ml: unknown }>(
    'SELECT water_goal_ml FROM user_goals WHERE user_id=$1 AND goal_date=$2 ORDER BY updated_at DESC,created_at DESC LIMIT 1',
    [owner, today]
  );
  let saved: unknown;
  if (explicit.rows.length) saved = explicit.rows[0]?.water_goal_ml;
  else {
    const weekly = await client.query<{ water_goal: unknown }>(
      `SELECT p.water_goal FROM (SELECT * FROM weekly_goal_plans WHERE user_id=$1 AND is_active=TRUE AND start_date<=$2 AND (end_date IS NULL OR end_date>=$2) ORDER BY start_date DESC LIMIT 1) w
       JOIN goal_presets p ON p.user_id=$1 AND p.id=CASE EXTRACT(DOW FROM $2::date)
         WHEN 0 THEN w.sunday_preset_id WHEN 1 THEN w.monday_preset_id WHEN 2 THEN w.tuesday_preset_id WHEN 3 THEN w.wednesday_preset_id WHEN 4 THEN w.thursday_preset_id WHEN 5 THEN w.friday_preset_id ELSE w.saturday_preset_id END`,
      [owner, today]
    );
    saved = weekly.rows[0]?.water_goal;
    // Existing weekly presets may omit hydration; carry forward a saved goal, never an invented default.
    if (saved === null || saved === undefined) {
      const carried = await client.query<{ water_goal_ml: unknown }>(
        'SELECT water_goal_ml FROM user_goals WHERE user_id=$1 AND (goal_date<$2 OR goal_date IS NULL) ORDER BY goal_date DESC NULLS LAST LIMIT 1',
        [owner, today]
      );
      saved = carried.rows[0]?.water_goal_ml;
    }
  }
  const target = number(saved);
  return target !== null && target > 0 ? target : null;
}

/** Owner-only, ephemeral export; every query shares one coherent read-only snapshot. */
export async function getAppointmentReportData(
  owner: string,
  input: AppointmentReportQuery,
  now = new Date()
): Promise<AppointmentReportData> {
  const actor = dbContextStorage.getStore()?.authenticatedUserId ?? owner;
  if (
    actor !== owner ||
    (input.expected_owner_id !== undefined && input.expected_owner_id !== owner)
  )
    throw problem(
      'Appointment reports are only available for your own account.',
      403
    );
  const query = appointmentReportQuerySchema.parse(input);
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const preference = await client.query<{ timezone: string | null }>(
      'SELECT timezone FROM user_preferences WHERE user_id=$1',
      [owner]
    );
    const configured = preference.rows[0]?.timezone;
    const timezone =
      query.timezone ??
      (configured && isValidTimeZone(configured) ? configured : 'UTC');
    const to = query.to ?? instantToDay(now, timezone);
    const from = query.from ?? addDays(to, -90);
    if (from > to) throw problem('from must not be after to', 400);
    const args = [owner, from, to];
    const hydrationTargetMl = await currentSavedHydrationTarget(
      client,
      owner,
      instantToDay(now, timezone)
    );
    const profile = await client.query<{ name: string | null }>(
      'SELECT full_name AS name FROM profiles WHERE id=$1',
      [owner]
    );
    const meds = await client.query<Row>(
      'SELECT id,COALESCE(display_name,name) AS name,dose_amount::text,dose_unit,is_active FROM medications WHERE user_id=$1 ORDER BY COALESCE(display_name,name),id',
      [owner]
    );
    const schedules = await client.query<Row>(
      'SELECT medication_id,schedule_type_id,time_of_day::text,days_of_week,interval_days,day_of_month,cycle_on_days,cycle_off_days,with_meal,prn_reason,prn_max_per_day,dose_amount::text,start_date::text,end_date::text,active FROM medication_schedules WHERE user_id=$1 ORDER BY time_of_day NULLS LAST,id',
      [owner]
    );
    const titration = await client.query<Row>(
      'SELECT medication_id,dose_mg::text,dose_unit,start_date::text,planned_weeks,status FROM medication_titration_steps WHERE user_id=$1 ORDER BY step_order,id',
      [owner]
    );
    // These are independent storage sources. Never use listEntriesWithInjections here.
    const entries = await client.query<Row>(
      'SELECT id,medication_id,med_name_snapshot,dose_amount_snapshot::text,dose_unit_snapshot,status,taken_at,scheduled_for,entry_date::text FROM medication_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 ORDER BY entry_date,taken_at,id',
      args
    );
    const injections = await client.query<Row>(
      'SELECT id,medication_id,dose_mg::text,volume_ml::text,dose_input_unit,administration_route,injected_at,entry_date::text,site FROM injection_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 ORDER BY entry_date,injected_at,id',
      args
    );
    const symptoms = await client.query<Row>(
      'SELECT id,symptom_name_snapshot,severity,severity_label,logged_at,entry_date::text FROM symptom_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 ORDER BY entry_date,logged_at,id',
      args
    );
    const weights = await client.query<Row>(
      'SELECT entry_date::text,weight FROM check_in_measurements WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 AND weight IS NOT NULL ORDER BY entry_date,id',
      args
    );
    const water = await client.query<Row>(
      'SELECT entry_date::text,SUM(water_ml) AS total_ml FROM water_intake_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 GROUP BY entry_date ORDER BY entry_date',
      args
    );
    const mood = await client.query<Row>(
      'SELECT entry_date::text,mood_value,energy_value FROM mood_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3 ORDER BY entry_date,entry_timestamp,id',
      args
    );
    const nutrition: Row[] = await reportRepository.getNutritionData(
      owner,
      from,
      to,
      [],
      client,
      true
    );
    const labs = await listLatestLabPanels(owner, owner, client);
    const markers = await client.query<{ id: string; name: string }>(
      'SELECT id,name FROM lab_markers WHERE user_id=$1 ORDER BY id',
      [owner]
    );
    const nameById = new Map(
      meds.rows.map((m) => [String(m.id), String(m.name)])
    );
    const names = new Map(markers.rows.map((m) => [m.id, m.name]));
    const doseLog: AppointmentReportData['doseLog'] = [
      ...entries.rows.map((row): AppointmentReportData['doseLog'][number] => ({
        id: String(row.id),
        sourceKind: 'medication_entry',
        medicationId: text(row.medication_id),
        name: text(row.med_name_snapshot),
        nameBasis: row.med_name_snapshot ? 'snapshot' : 'unknown',
        trackingDay: String(row.entry_date),
        occurredAt: recordedIso(row.taken_at),
        scheduledFor: recordedIso(row.scheduled_for),
        timingDeltaMinutes: timingDeltaMinutes(
          row.taken_at,
          row.scheduled_for,
          row.status === 'taken' || row.status === 'prn_taken'
        ),
        status: String(row.status),
        administered: row.status === 'taken' || row.status === 'prn_taken',
        doseAmount: text(row.dose_amount_snapshot),
        doseUnit: text(row.dose_unit_snapshot),
        deliveredMassMg: null,
        administrationRoute: null,
        site: null,
      })),
      ...injections.rows.map(
        (row): AppointmentReportData['doseLog'][number] => ({
          id: String(row.id),
          sourceKind: 'injection',
          medicationId: text(row.medication_id),
          name: nameById.get(String(row.medication_id)) ?? null,
          nameBasis: nameById.has(String(row.medication_id))
            ? 'current_link'
            : 'unknown',
          trackingDay: String(row.entry_date),
          occurredAt: recordedIso(row.injected_at),
          scheduledFor: null,
          timingDeltaMinutes: null,
          status: 'taken',
          administered: true,
          doseAmount: knownDeliveredMass(row),
          doseUnit: knownDeliveredMass(row) === null ? null : 'mg',
          deliveredMassMg: knownDeliveredMass(row),
          administrationRoute: text(row.administration_route),
          site: text(row.site),
        })
      ),
    ].sort(
      (a, b) =>
        a.trackingDay.localeCompare(b.trackingDay) ||
        (a.occurredAt ?? '').localeCompare(b.occurredAt ?? '') ||
        a.sourceKind.localeCompare(b.sourceKind) ||
        a.id.localeCompare(b.id)
    );
    const result: AppointmentReportData = {
      generatedAt: now.toISOString(),
      ownerDisplayName: profile.rows[0]?.name ?? null,
      range: { from, to, timezone },
      currentMedications: meds.rows.map((m) => ({
        id: String(m.id),
        name: String(m.name),
        doseAmount: text(m.dose_amount),
        doseUnit: text(m.dose_unit),
        active: m.is_active === true,
        schedules: schedules.rows
          .filter((s) => s.medication_id === m.id)
          .map((s) => ({
            type: String(s.schedule_type_id),
            timeOfDay: text(s.time_of_day),
            daysOfWeek: Array.isArray(s.days_of_week)
              ? s.days_of_week.map(Number)
              : null,
            intervalDays: number(s.interval_days),
            dayOfMonth: number(s.day_of_month),
            cycleOnDays: number(s.cycle_on_days),
            cycleOffDays: number(s.cycle_off_days),
            withMeal: text(s.with_meal),
            prnReason: text(s.prn_reason),
            prnMaxPerDay: number(s.prn_max_per_day),
            doseAmount: text(s.dose_amount) ?? text(m.dose_amount),
            doseUnit: text(m.dose_unit),
            startDate: text(s.start_date),
            endDate: text(s.end_date),
            active: s.active === true,
          })),
        titration: titration.rows
          .filter((t) => t.medication_id === m.id)
          .map((t) => ({
            doseAmount: text(t.dose_mg),
            doseUnit: text(t.dose_unit),
            startDate: text(t.start_date),
            plannedWeeks: number(t.planned_weeks),
            status: String(t.status),
          })),
      })),
      doseLog,
      symptoms: symptoms.rows.map((s) => ({
        id: String(s.id),
        name: String(s.symptom_name_snapshot),
        trackingDay: String(s.entry_date),
        loggedAt: iso(s.logged_at),
        severity: number(s.severity),
        severityLabel: text(s.severity_label),
      })),
      wellness: {
        hydrationTargetMl,
        weights: weights.rows.flatMap((w) => {
          const value = number(w.weight);
          return value === null
            ? []
            : [{ day: String(w.entry_date), value, unit: 'kg' as const }];
        }),
        nutrition: nutrition.map((n) => ({
          day: String(n.date),
          calories: number(n.calories),
          proteinGrams: number(n.protein),
        })),
        water: water.rows.map((w) => ({
          day: String(w.entry_date),
          millilitres: number(w.total_ml),
        })),
        mood: mood.rows.map((m) => ({
          day: String(m.entry_date),
          mood: number(m.mood_value),
          energy: number(m.energy_value),
        })),
      },
      labPanels: labs.panels.map((p) => ({
        id: p.id,
        labName: p.lab_name,
        collectedOn: p.collected_on,
        origin: p.origin ?? 'imported',
        results: p.results.map((r) => {
          const preset = LAB_MARKER_PRESETS.find((m) => m.key === r.marker_key);
          const exact = exactLabResultValue(r);
          const validRange =
            (r.ref_range_low === null || Number.isFinite(r.ref_range_low)) &&
            (r.ref_range_high === null || Number.isFinite(r.ref_range_high)) &&
            (r.ref_range_low === null ||
              r.ref_range_high === null ||
              r.ref_range_low <= r.ref_range_high);
          const flag =
            exact === null || !validRange
              ? 'unknown'
              : labRangeStatus(exact, r.ref_range_low, r.ref_range_high);
          return {
            id: r.id,
            markerId: r.marker_key
              ? `builtin:${r.marker_key}`
              : r.custom_marker_id
                ? `custom:${r.custom_marker_id}`
                : `unknown:${r.id}`,
            name:
              preset?.displayName ??
              names.get(r.custom_marker_id ?? '') ??
              r.marker_key ??
              'Unknown marker',
            date: r.entry_date,
            valueNumeric: r.value_numeric,
            valueText: r.value_text,
            unit: r.unit,
            referenceLow: r.ref_range_low,
            referenceHigh: r.ref_range_high,
            rangeFlag: flag === 'in_range' ? 'normal' : flag,
            method: null,
          };
        }),
      })),
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
