import {
  buildInventoryForecast,
  buildInventoryForecastPlan,
  medicationInventoryForecastResponseSchema,
  medicationInventoryPlannedForecastResponseSchema,
  type MedicationInventoryPlannedForecastResponse,
  resolvePreparedMedicationRoute,
  type InventoryForecastDevice,
  type InventoryForecastLegacyPlan,
  type InventoryForecastLimitationCode,
  type MedicationInventoryForecast,
  type MedicationInventoryForecastResponse,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { deliveredCourseInputs } from '../models/medicationCourseRepository.js';
import {
  loadInventoryForecastSnapshot,
  type InventoryForecastSnapshot,
} from '../models/medicationInventoryForecastRepository.js';
import { resolveCourseDevice } from './medicationCourseDeviceService.js';
export function forecastInventorySnapshot(
  snapshot: InventoryForecastSnapshot,
  now: Date,
  mode?: 'committed'
): MedicationInventoryForecastResponse;
export function forecastInventorySnapshot(
  snapshot: InventoryForecastSnapshot,
  now: Date,
  mode: 'planned_cycles'
): MedicationInventoryPlannedForecastResponse;
export function forecastInventorySnapshot(
  snapshot: InventoryForecastSnapshot,
  now: Date,
  mode: 'committed' | 'planned_cycles'
):
  | MedicationInventoryForecastResponse
  | MedicationInventoryPlannedForecastResponse;
export function forecastInventorySnapshot(
  snapshot: InventoryForecastSnapshot,
  now: Date,
  mode: 'committed' | 'planned_cycles' = 'committed'
):
  | MedicationInventoryForecastResponse
  | MedicationInventoryPlannedForecastResponse {
  const medications: (ReturnType<typeof buildInventoryForecast> &
    Pick<
      MedicationInventoryForecast,
      'medication_id' | 'name' | 'route' | 'device_basis'
    >)[] = [];
  for (const med of snapshot.medications) {
    const route = resolvePreparedMedicationRoute(med);
    if (!route) continue;
    const devices: Record<string, InventoryForecastDevice | null> = {};
    const device_basis: MedicationInventoryForecast['device_basis'] = [];
    const limitations: InventoryForecastLimitationCode[] = [];
    for (const course of med.courses)
      for (const revision of course.revisions) {
        if (revision.deleted_at) continue;
        const r = resolveCourseDevice(
          revision,
          snapshot.devices,
          snapshot.preferred_device_id,
          route
        );
        devices[revision.id] = r.device
          ? {
              id: r.device.id,
              device: r.device,
              basis: r.binding.source === 'plan' ? 'plan' : 'preferred',
            }
          : null;
        device_basis.push({
          plan_id: revision.id,
          plan_kind: 'course_revision',
          device_id: r.binding.device_id,
          device_name: r.binding.device_name,
          source: r.binding.source,
        });
      }
    const legacy_plans: InventoryForecastLegacyPlan[] = [];
    const preferred = resolveCourseDevice(
      { device_choice: 'preferred', device_id: null },
      snapshot.devices,
      snapshot.preferred_device_id,
      route
    );
    for (const schedule of med.legacy_schedules) {
      if (
        !med.is_active ||
        !schedule.active ||
        (schedule.end_date && schedule.end_date < snapshot.today)
      )
        continue;
      if (med.is_active && schedule.schedule_type_id === 'prn') {
        limitations.push('unmodelled_legacy_demand');
        continue;
      }
      // Medication-global legacy titration has no explicit fixed-plan binding.
      if (med.legacy_titration.some((step) => step.status === 'active')) {
        limitations.push('unmodelled_legacy_demand');
        continue;
      }
      const { dose_amount: ruleDose, ...rule } = schedule;
      legacy_plans.push({
        id: schedule.id,
        rule,
        dose_amount: ruleDose ?? med.dose_amount,
        dose_unit: med.dose_unit,
        timezone: snapshot.timezone,
        device: preferred.device
          ? {
              id: preferred.device.id,
              device: preferred.device,
              basis: 'preferred',
            }
          : null,
      });
      device_basis.push({
        plan_id: schedule.id,
        plan_kind: 'legacy_schedule',
        device_id: preferred.binding.device_id,
        device_name: preferred.binding.device_name,
        source: preferred.binding.source,
      });
    }
    const planInput = {
      ...(mode === 'planned_cycles'
        ? { forecast_mode: 'planned_cycles' as const }
        : {}),
      today: snapshot.today,
      now: now.toISOString(),
      timezone: snapshot.timezone,
      medication_active: med.is_active,
      route,
      courses: med.courses,
      actuals: deliveredCourseInputs(med.actuals),
      phase_actuals: deliveredCourseInputs(med.phase_actuals),
      devices,
      legacy_plans,
      legacy_actuals: med.legacy_entries.map((row) => ({
        ...row,
        id: `${row.source_kind}:${row.id}`,
        course_origin: row.course_origin === true,
      })),
      limitations,
    };
    const contributing = new Set(
      buildInventoryForecastPlan(planInput).slots.map((slot) => slot.plan_id)
    );
    if (
      device_basis.some(
        (binding) =>
          binding.source === 'incompatible' && contributing.has(binding.plan_id)
      )
    )
      limitations.push('incompatible_device');
    const result = buildInventoryForecast({
      plan: planInput,
      containers: med.containers,
      lead_days: snapshot.defaults.lead_days,
      buffer_days: snapshot.defaults.buffer_days,
      stock_limitations: med.stock_limitations,
    });
    medications.push({
      ...result,
      medication_id: med.id,
      name: med.name,
      route,
      device_basis,
    });
  }
  const response = {
    as_of: now.toISOString(),
    today: snapshot.today,
    timezone: snapshot.timezone,
    horizon_days: 365,
    max_slots: 800,
    defaults: snapshot.defaults,
    medications,
  };
  return mode === 'planned_cycles'
    ? medicationInventoryPlannedForecastResponseSchema.parse({
        ...response,
        forecast_mode: 'planned_cycles',
      })
    : medicationInventoryForecastResponseSchema.parse(response);
}
export function getMedicationInventoryForecast(
  owner: string,
  now?: Date,
  mode?: 'committed'
): Promise<MedicationInventoryForecastResponse>;
export function getMedicationInventoryForecast(
  owner: string,
  now: Date | undefined,
  mode: 'planned_cycles'
): Promise<MedicationInventoryPlannedForecastResponse>;
export function getMedicationInventoryForecast(
  owner: string,
  now: Date | undefined,
  mode: 'committed' | 'planned_cycles'
): Promise<
  | MedicationInventoryForecastResponse
  | MedicationInventoryPlannedForecastResponse
>;
export async function getMedicationInventoryForecast(
  owner: string,
  now = new Date(),
  mode: 'committed' | 'planned_cycles' = 'committed'
): Promise<
  | MedicationInventoryForecastResponse
  | MedicationInventoryPlannedForecastResponse
> {
  const client = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = forecastInventorySnapshot(
      await loadInventoryForecastSnapshot(client, owner, now),
      now,
      mode
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
