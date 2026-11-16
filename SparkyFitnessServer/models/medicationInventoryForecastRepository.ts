import type { PoolClient } from 'pg';
import {
  DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
  DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
  addDays,
  drawConcentration,
  remainingDrawVolume,
  instantToDay,
  isDayString,
  isValidTimeZone,
  normalizePurchaseDecimal,
  type InventoryForecastLimitationCode,
  type InventoryPreparedContainer,
  type MedicationCourse,
  type MedicationReorderDefaults,
  type MedicationSyringe,
} from '@workspace/shared';
import {
  loadMedicationCourse,
  loadCourseActuals,
  loadCoursePhaseActuals,
  type CourseActual,
  type CoursePhaseActual,
} from './medicationCourseRepository.js';

export interface InventoryForecastLegacyScheduleRow {
  id: string;
  medication_id: string;
  schedule_type_id: string;
  time_of_day: string | null;
  dose_amount: string | null;
  days_of_week: number[] | null;
  interval_days: number | null;
  day_of_month: number | null;
  cycle_on_days: number | null;
  cycle_off_days: number | null;
  with_meal: string | null;
  prn_reason: string | null;
  prn_max_per_day: number | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  created_at: string;
}
export interface InventoryForecastLegacyEntryRow {
  id: string;
  medication_id: string | null;
  source_kind: 'entry' | 'injection';
  schedule_id: string | null;
  entry_date: string;
  occurred_at: string;
  scheduled_for: string | null;
  scheduled_day: string | null;
  status: string;
  course_origin: boolean | null;
  course_revision_id: string | null;
  course_rule_id: string | null;
  course_step_id: string | null;
  course_slot_key: string | null;
  dose_amount: string | null;
  dose_unit: string | null;
  dose_mg_exact: string | null;
  volume_ml: string | null;
  dose_input_unit: string | null;
  pen_id: string | null;
}
export interface InventoryForecastLegacyTitrationRow {
  id: string;
  medication_id: string;
  dose_mg: string;
  dose_unit: string;
  start_date: string | null;
  planned_weeks: number | null;
  step_order: number;
  status: string;
  is_taper: boolean;
}
export interface InventoryForecastMedicationSnapshot {
  id: string;
  name: string;
  is_active: boolean;
  type_id: string | null;
  route_id: string | null;
  dose_amount: string | null;
  dose_unit: string | null;
  is_glp1: boolean;
  courses: MedicationCourse[];
  actuals: CourseActual[];
  /** Phase-only provenance can survive detachment; never use it for slot or stock attribution. */
  phase_actuals: CoursePhaseActual[];
  legacy_schedules: InventoryForecastLegacyScheduleRow[];
  legacy_entries: InventoryForecastLegacyEntryRow[];
  legacy_titration: InventoryForecastLegacyTitrationRow[];
  containers: InventoryPreparedContainer[];
  stock_limitations: InventoryForecastLimitationCode[];
}
/** Current storage facts for display/classification; no inferred preparation state. */
export interface InventoryDashboardStockRow {
  id: string;
  medication_id: string;
  name: string;
  type_id: string | null;
  route_id: string | null;
  kind: string;
  label: string | null;
  label_mass_mg: string | null;
  dose_mg: string | null;
  doses_total: number | null;
  status: string;
  finished_at: string | null;
  opened_at: string | null;
  expiry_date: string | null;
  bud_date: string | null;
  doses_used: number;
  concentration_mg_ml: string | null;
  volume_ml: string | null;
  current_preparation_id: string | null;
  /** Retained correction audits remain evidence even when a current projection is absent. */
  prior_preparation: boolean;
  /** All linked actuals, including unknown/zero mass and historic administrations. */
  linked_actual_count: string;
  updated_at: string | null;
  created_at: string;
}
export interface InventoryForecastSnapshot {
  today: string;
  timezone: string;
  defaults: MedicationReorderDefaults;
  medications: InventoryForecastMedicationSnapshot[];
  devices: MedicationSyringe[];
  preferred_device_id: string | null;
  dashboard_stock: InventoryDashboardStockRow[];
}
type MedicationRow = Pick<
  InventoryForecastMedicationSnapshot,
  | 'id'
  | 'name'
  | 'is_active'
  | 'type_id'
  | 'route_id'
  | 'dose_amount'
  | 'dose_unit'
  | 'is_glp1'
>;
interface StockRow {
  id: string;
  medication_id: string;
  kind: string;
  status: 'sealed' | 'in_use';
  concentration_mg_ml: string | null;
  volume_ml: string | null;
  doses_used: number;
  opened_at: string | null;
  expiry_date: string | null;
  created_at: Date | string;
  bud_date: string | null;
  bud_mode: string | null;
  bud_interval_days: number | null;
  bud_base_date: string | null;
  bud_source: string | null;
  preparation_id: string | null;
  mass_value: string | null;
  mass_unit: 'mg' | 'mcg' | null;
  final_volume_ml: string | null;
  prepared_date: string | null;
  preparation_created_at: Date | string | null;
  used_mg: string;
  linked_count: string;
  missing_count: string;
}
const iso = (value: Date | string) => new Date(value).toISOString();
const validInstant = (value: Date | string | null) =>
  value !== null && Number.isFinite(new Date(value).getTime());
const positive = (value: string | null): value is string =>
  value !== null &&
  normalizePurchaseDecimal(value) !== null &&
  normalizePurchaseDecimal(value) !== '0';
function explicitBud(row: StockRow): string | null {
  if (
    row.bud_mode !== 'interval' &&
    row.bud_date !== null &&
    isDayString(row.bud_date)
  )
    return row.bud_date;
  if (
    row.bud_mode !== 'interval' ||
    !row.preparation_id ||
    !row.prepared_date ||
    !isDayString(row.prepared_date) ||
    !validInstant(row.preparation_created_at) ||
    !row.bud_base_date ||
    !isDayString(row.bud_base_date) ||
    row.bud_interval_days === null ||
    !Number.isSafeInteger(row.bud_interval_days) ||
    row.bud_interval_days < 0 ||
    !row.bud_source?.trim()
  )
    return null;
  const result = addDays(row.bud_base_date, row.bud_interval_days);
  return isDayString(result) &&
    (row.bud_date === null || row.bud_date === result)
    ? result
    : null;
}
function preparedStock(
  rows: StockRow[]
): Pick<
  InventoryForecastMedicationSnapshot,
  'containers' | 'stock_limitations'
> {
  const limitations = new Set<InventoryForecastLimitationCode>();
  const containers: InventoryPreparedContainer[] = [];
  for (const row of rows) {
    // Sealed stock without a recorded preparation has no demonstrated physical
    // concentration; never size it by nominal mass or simulate an opening date.
    if (row.status === 'sealed' && !row.preparation_id) {
      limitations.add('sealed_stock_excluded');
      continue;
    }
    if (row.kind !== 'vial') {
      limitations.add('unknown_stock');
      continue;
    }
    const bud = explicitBud(row);
    if (bud === null) limitations.add('unknown_bud');
    const expiry =
      row.expiry_date !== null && isDayString(row.expiry_date)
        ? row.expiry_date
        : null;
    if (row.expiry_date !== null && expiry === null)
      limitations.add('unknown_stock');
    let concentration: string | null = null;
    let remaining: string | null = null;
    try {
      if (
        row.mass_value !== null &&
        row.mass_unit !== null &&
        positive(row.mass_value) &&
        positive(row.final_volume_ml)
      ) {
        concentration = drawConcentration({
          mass_value: row.mass_value,
          mass_unit: row.mass_unit,
          final_volume_ml: row.final_volume_ml,
        });
      } else if (!row.preparation_id && positive(row.concentration_mg_ml)) {
        concentration = drawConcentration({
          concentration_mg_ml: row.concentration_mg_ml,
        });
      }
      const volume = row.final_volume_ml ?? row.volume_ml;
      if (
        concentration !== null &&
        positive(concentration) &&
        positive(volume) &&
        row.missing_count === '0' &&
        String(row.doses_used) === row.linked_count &&
        normalizePurchaseDecimal(row.used_mg) !== null
      ) {
        remaining = remainingDrawVolume(concentration, volume, row.used_mg);
      }
    } catch {
      concentration = null;
      remaining = null;
    }
    if (
      remaining === null ||
      concentration === null ||
      !validInstant(row.created_at)
    )
      limitations.add('unknown_stock');
    containers.push({
      id: row.id,
      status: row.status,
      remaining_ml: remaining,
      concentration_mcg_ml: concentration,
      usable_until:
        bud === null
          ? null
          : expiry === null
            ? bud
            : bud < expiry
              ? bud
              : expiry,
      opened_at: row.opened_at,
      expiry_date: expiry,
      created_at: validInstant(row.created_at) ? iso(row.created_at) : '',
    });
  }
  if (!containers.length && !limitations.has('sealed_stock_excluded'))
    limitations.add('unknown_stock');
  return { containers, stock_limitations: [...limitations] };
}

/** Explicit ID reads include a newly closed/retired row so a write guard can reject stale queue facts. */
export async function loadInventoryDashboardStock(
  client: PoolClient,
  owner: string,
  stockId?: string
): Promise<InventoryDashboardStockRow[]> {
  type Stored = Omit<
    InventoryDashboardStockRow,
    'finished_at' | 'updated_at' | 'created_at'
  > & {
    finished_at: Date | string | null;
    updated_at: Date | string | null;
    created_at: Date | string;
  };
  const result = await client.query<Stored>(
    `SELECT v.id,v.medication_id,COALESCE(NULLIF(m.display_name,''),m.name) AS name,m.type_id,m.route_id,
      v.kind,v.label,v.label_mass_mg::text,v.dose_mg::text,v.doses_total,v.status,v.finished_at::text,
      v.opened_at::text,v.expiry_date::text,v.bud_date::text,v.doses_used,v.concentration_mg_ml::text,v.volume_ml::text,
      p.id AS current_preparation_id,
      EXISTS(SELECT 1 FROM medication_preparation_corrections a WHERE a.user_id=v.user_id AND a.pen_id=v.id) AS prior_preparation,
      (SELECT COUNT(*)::text FROM injection_entries i WHERE i.user_id=v.user_id AND i.pen_id=v.id) AS linked_actual_count,
      v.updated_at,v.created_at
     FROM medication_pens v JOIN medications m ON m.id=v.medication_id AND m.user_id=v.user_id
     LEFT JOIN medication_preparations p ON p.pen_id=v.id AND p.user_id=v.user_id AND p.medication_id=v.medication_id
     WHERE v.user_id=$1 AND ($2::uuid IS NULL OR v.id=$2)
       AND ($2::uuid IS NOT NULL OR (v.status IN ('sealed','in_use') AND v.finished_at IS NULL))
     ORDER BY v.id`,
    [owner, stockId ?? null]
  );
  return result.rows.map((row) => ({
    ...row,
    finished_at:
      row.finished_at === null
        ? null
        : validInstant(row.finished_at)
          ? iso(row.finished_at)
          : String(row.finished_at),
    updated_at:
      row.updated_at !== null && validInstant(row.updated_at)
        ? iso(row.updated_at)
        : null,
    created_at: validInstant(row.created_at) ? iso(row.created_at) : '',
  }));
}

/** All reads share the caller's repeatable-read snapshot. No transaction or pool ownership here. */
export async function loadInventoryForecastSnapshot(
  client: PoolClient,
  owner: string,
  now: Date
): Promise<InventoryForecastSnapshot> {
  const preferences = await client.query<{
    timezone: string | null;
    medication_reorder_lead_days: number;
    medication_reorder_buffer_days: number;
  }>(
    'SELECT timezone,medication_reorder_lead_days,medication_reorder_buffer_days FROM user_preferences WHERE user_id=$1',
    [owner]
  );
  const saved = preferences.rows[0];
  const timezone =
    saved?.timezone && isValidTimeZone(saved.timezone) ? saved.timezone : 'UTC';
  const defaults = {
    lead_days:
      saved?.medication_reorder_lead_days ??
      DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
    buffer_days:
      saved?.medication_reorder_buffer_days ??
      DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
  };
  const medications = await client.query<MedicationRow>(
    "SELECT id,COALESCE(NULLIF(display_name,''),name) AS name,is_active,type_id,route_id,dose_amount::text,dose_unit,is_glp1 FROM medications WHERE user_id=$1 ORDER BY id",
    [owner]
  );
  const courseIds = await client.query<{
    id: string;
    medication_id: string | null;
  }>(
    'SELECT id,medication_id FROM medication_courses WHERE user_id=$1 ORDER BY id',
    [owner]
  );
  const schedules = await client.query<
    Omit<InventoryForecastLegacyScheduleRow, 'created_at'> & {
      created_at: Date | string;
    }
  >(
    'SELECT id,medication_id,schedule_type_id,time_of_day::text,dose_amount::text,days_of_week,interval_days,day_of_month,cycle_on_days,cycle_off_days,with_meal,prn_reason,prn_max_per_day,start_date::text,end_date::text,active,created_at FROM medication_schedules WHERE user_id=$1 ORDER BY medication_id,id',
    [owner]
  );
  const actuals = await client.query<
    Omit<InventoryForecastLegacyEntryRow, 'occurred_at' | 'scheduled_for'> & {
      occurred_at: Date | string;
      scheduled_for: Date | string | null;
    }
  >(
    `SELECT id,medication_id,'entry'::text AS source_kind,schedule_id,entry_date::text,taken_at AS occurred_at,scheduled_for,scheduled_day::text,status,course_origin,course_revision_id,course_rule_id,course_step_id,course_slot_key,dose_amount_snapshot::text AS dose_amount,dose_unit_snapshot AS dose_unit,NULL::text AS dose_mg_exact,NULL::text AS volume_ml,NULL::text AS dose_input_unit,NULL::uuid AS pen_id FROM medication_entries WHERE user_id=$1
     UNION ALL SELECT id,medication_id,'injection',NULL::uuid,entry_date::text,injected_at,scheduled_for,scheduled_day::text,'taken',course_origin,course_revision_id,course_rule_id,course_step_id,course_slot_key,dose_mg::text,'mg',dose_mg::text,volume_ml::text,dose_input_unit,pen_id FROM injection_entries WHERE user_id=$1 ORDER BY entry_date,source_kind,id`,
    [owner]
  );
  const titration = await client.query<InventoryForecastLegacyTitrationRow>(
    'SELECT id,medication_id,dose_mg::text,dose_unit,start_date::text,planned_weeks,step_order,status,is_taper FROM medication_titration_steps WHERE user_id=$1 ORDER BY medication_id,step_order,id',
    [owner]
  );
  const stock = await client.query<StockRow>(
    `SELECT v.id,v.medication_id,v.kind,v.status,v.concentration_mg_ml::text,v.volume_ml::text,v.doses_used,v.opened_at::text,v.expiry_date::text,v.created_at,v.bud_date::text,v.bud_mode,v.bud_interval_days,v.bud_base_date::text,v.bud_source,
      p.id AS preparation_id,p.mass_value::text,p.mass_unit,p.final_volume_ml::text,p.prepared_date::text,p.created_at AS preparation_created_at,
      (SELECT COALESCE(SUM(i.dose_mg),0)::text FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS used_mg,
      (SELECT COUNT(*)::text FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id) AS linked_count,
      (SELECT COUNT(*)::text FROM injection_entries i WHERE i.pen_id=v.id AND i.user_id=v.user_id AND (i.dose_mg IS NULL OR i.dose_mg<0 OR (i.dose_mg=0 AND (i.volume_ml IS NULL OR i.dose_input_unit IS NULL)))) AS missing_count
     FROM medication_pens v LEFT JOIN medication_preparations p ON p.pen_id=v.id AND p.user_id=v.user_id AND p.medication_id=v.medication_id
     WHERE v.user_id=$1 AND v.status IN ('sealed','in_use') AND v.finished_at IS NULL ORDER BY v.medication_id,v.id`,
    [owner]
  );
  const devices = await client.query<MedicationSyringe>(
    'SELECT s.id,s.name,s.device_type,s.graduation_type,s.units_per_ml,s.capacity_ml::text,s.capacity_units,s.increment::text,(s.user_id IS NULL) AS is_shared,(s.id=(SELECT default_syringe_id FROM medication_device_preferences WHERE user_id=$1)) IS TRUE AS is_default,s.created_at,s.updated_at FROM medication_syringes s WHERE s.user_id=$1 OR s.user_id IS NULL ORDER BY s.id',
    [owner]
  );
  const preferred = await client.query<{ default_syringe_id: string | null }>(
    'SELECT default_syringe_id FROM medication_device_preferences WHERE user_id=$1',
    [owner]
  );
  const dashboardStock = await loadInventoryDashboardStock(client, owner);
  const loaded = new Map<
    string,
    {
      courses: MedicationCourse[];
      actuals: CourseActual[];
      phase_actuals: CoursePhaseActual[];
    }
  >();
  for (const row of courseIds.rows) {
    if (row.medication_id === null) continue;
    const course = await loadMedicationCourse(client, owner, row.id);
    if (!course) continue;
    const value = loaded.get(row.medication_id) ?? {
      courses: [],
      actuals: [],
      phase_actuals: [],
    };
    value.courses.push(course);
    value.actuals.push(...(await loadCourseActuals(client, owner, row.id)));
    value.phase_actuals.push(
      ...(await loadCoursePhaseActuals(client, owner, row.id))
    );
    loaded.set(row.medication_id, value);
  }
  const preferredId = preferred.rows[0]?.default_syringe_id ?? null;
  return {
    dashboard_stock: dashboardStock,
    today: instantToDay(now, timezone),
    timezone,
    defaults,
    devices: devices.rows,
    preferred_device_id: devices.rows.some(
      (device) => device.id === preferredId
    )
      ? preferredId
      : null,
    medications: medications.rows.map((medication) => ({
      ...medication,
      courses: loaded.get(medication.id)?.courses ?? [],
      actuals: loaded.get(medication.id)?.actuals ?? [],
      phase_actuals: loaded.get(medication.id)?.phase_actuals ?? [],
      legacy_schedules: schedules.rows
        .filter((row) => row.medication_id === medication.id)
        .map((row) => ({ ...row, created_at: iso(row.created_at) })),
      legacy_entries: actuals.rows
        .filter((row) => row.medication_id === medication.id)
        .map((row) => ({
          ...row,
          occurred_at: iso(row.occurred_at),
          scheduled_for:
            row.scheduled_for === null ? null : iso(row.scheduled_for),
        })),
      legacy_titration: titration.rows.filter(
        (row) => row.medication_id === medication.id
      ),
      ...preparedStock(
        stock.rows.filter((row) => row.medication_id === medication.id)
      ),
    })),
  };
}
