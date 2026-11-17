import type { PoolClient } from 'pg';
import {
  normalizePurchaseDecimal,
  type MedicationLogWeekInput,
  type MedicationWeekActualFacts,
  type MedicationWeekLegacyScheduleFacts,
  type MedicationWeekMedicationFacts,
} from '@workspace/shared';
import {
  deliveredCourseInputs,
  loadCourseActuals,
  loadCourseOwnerContext,
  loadCoursePhaseActuals,
  loadMedicationCourse,
} from './medicationCourseRepository.js';

/** A stored date alone is not evidence of a recorded clock time. */
const recordedInstant = (value: Date | string | null): string | null => {
  if (
    value === null ||
    (typeof value === 'string' && !value.includes('T') && !value.includes(' '))
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
type StoredActual = Omit<
  MedicationWeekActualFacts,
  'occurred_at' | 'scheduled_for'
> & {
  volume_ml: string | null;
  dose_input_unit: string | null;
  occurred_at: Date | string | null;
  scheduled_for: Date | string | null;
};
/** All reads use the caller's single repeatable-read snapshot; no preference insertion or writes. */
export async function loadMedicationCalendarSnapshot(
  client: PoolClient,
  owner: string,
  now: Date,
  weekStart?: string
): Promise<MedicationLogWeekInput> {
  const context = await loadCourseOwnerContext(client, owner, now);
  const medications = await client.query<MedicationWeekMedicationFacts>(
    "SELECT id,COALESCE(NULLIF(display_name,''),name) AS name,is_active,is_supplement,dose_amount::text,dose_unit FROM medications WHERE user_id=$1 ORDER BY id",
    [owner]
  );
  const ids = await client.query<{ id: string }>(
    'SELECT id FROM medication_courses WHERE user_id=$1 AND deleted_at IS NULL ORDER BY id',
    [owner]
  );
  const courses: MedicationLogWeekInput['courses'] = [];
  const managed: MedicationLogWeekInput['managed_actuals'] = [];
  const phase: MedicationLogWeekInput['phase_actuals'] = [];
  for (const { id } of ids.rows) {
    const course = await loadMedicationCourse(client, owner, id);
    if (!course) continue;
    courses.push(course);
    managed.push(
      ...deliveredCourseInputs(await loadCourseActuals(client, owner, id))
    );
    phase.push(
      ...deliveredCourseInputs(await loadCoursePhaseActuals(client, owner, id))
    );
  }
  const schedules = await client.query<
    Omit<MedicationWeekLegacyScheduleFacts, 'created_at'> & {
      created_at: Date | string;
    }
  >(
    'SELECT id,medication_id,schedule_type_id,time_of_day::text,dose_amount::text,days_of_week,interval_days,day_of_month,cycle_on_days,cycle_off_days,with_meal,start_date::text,end_date::text,active,created_at FROM medication_schedules WHERE user_id=$1 ORDER BY medication_id,id',
    [owner]
  );
  // Full explicit owner history is necessary for cross-day fulfilment. The pure builder
  // emits only visible tracking-day actuals and exact matched outside-week references.
  const actuals = await client.query<StoredActual>(
    `SELECT e.id,'entry'::text AS source_kind,e.medication_id,e.med_name_snapshot AS medication_name,e.status,e.entry_date::text,e.taken_at AS occurred_at,
      e.dose_amount_snapshot::text AS dose_amount,e.dose_unit_snapshot AS dose_unit,NULL::text AS dose_mg_exact,e.schedule_id,e.course_origin,e.course_revision_id,e.course_rule_id,e.course_step_id,e.course_slot_key,e.scheduled_day::text,e.scheduled_for,e.notes,NULL::text AS site,NULL::text AS volume_ml,NULL::text AS dose_input_unit,NULL::text AS administration_route
    FROM medication_entries e WHERE e.user_id=$1
    UNION ALL SELECT e.id,'injection',e.medication_id,e.medication_name_snapshot,'taken',e.entry_date::text,e.injected_at,e.dose_mg::text,'mg',e.dose_mg::text,NULL::uuid,e.course_origin,e.course_revision_id,e.course_rule_id,e.course_step_id,e.course_slot_key,e.scheduled_day::text,e.scheduled_for,e.notes,e.site,e.volume_ml::text,e.dose_input_unit,e.administration_route
    FROM injection_entries e WHERE e.user_id=$1 ORDER BY entry_date,source_kind,id`,
    [owner]
  );
  return {
    as_of: now.toISOString(),
    ...context,
    ...(weekStart ? { week_start: weekStart } : {}),
    medications: medications.rows,
    courses,
    managed_actuals: managed,
    phase_actuals: phase,
    legacy_schedules: schedules.rows.map((row) => ({
      ...row,
      created_at: recordedInstant(row.created_at),
    })),
    actuals: actuals.rows.map((row) => {
      const actual = {
        ...row,
        occurred_at: recordedInstant(row.occurred_at),
        scheduled_for: recordedInstant(row.scheduled_for),
      };
      if (actual.source_kind === 'injection') {
        const mass =
          actual.dose_mg_exact === null
            ? null
            : normalizePurchaseDecimal(actual.dose_mg_exact);
        if (
          mass === null ||
          (mass === '0' &&
            (actual.volume_ml === null ||
              normalizePurchaseDecimal(actual.volume_ml) === null ||
              actual.dose_input_unit === null))
        ) {
          const volume =
            actual.volume_ml === null
              ? null
              : normalizePurchaseDecimal(actual.volume_ml);
          actual.dose_amount = volume;
          actual.dose_unit = volume === null ? null : 'ml';
          actual.dose_mg_exact = null;
        }
      }
      const {
        volume_ml: _volume,
        dose_input_unit: _input,
        ...summary
      } = actual;
      return summary;
    }),
  };
}
