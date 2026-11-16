import type { PoolClient } from 'pg';
import {
  isDeviceEligibleForRoute,
  resolvePreparedMedicationRoute,
  type MedicationCoursePlanInput,
  type MedicationCourseRevision,
  type MedicationCourseReview,
  type MedicationSyringe,
} from '@workspace/shared';
import { courseProblem } from '../models/medicationCourseRepository.js';

export type CourseDeviceChoice = Pick<
  MedicationCourseRevision,
  'device_id' | 'device_choice'
>;
export function courseDeviceChoice(
  plan: Pick<MedicationCoursePlanInput, 'device_id'>,
  previous?: CourseDeviceChoice
): CourseDeviceChoice {
  if (plan.device_id === undefined)
    return previous
      ? { device_id: previous.device_id, device_choice: previous.device_choice }
      : { device_id: null, device_choice: 'preferred' };
  return plan.device_id === null
    ? { device_id: null, device_choice: 'preferred' }
    : { device_id: plan.device_id, device_choice: 'explicit' };
}
export function resolveCourseDevice(
  choice: CourseDeviceChoice,
  devices: MedicationSyringe[],
  preferredId: string | null,
  route: ReturnType<typeof resolvePreparedMedicationRoute>
) {
  const id =
    choice.device_choice === 'explicit' ? choice.device_id : preferredId;
  const device = devices.find((d) => d.id === id) ?? null;
  const source = !device
    ? 'missing'
    : !route || !isDeviceEligibleForRoute(device.device_type, route)
      ? 'incompatible'
      : choice.device_choice === 'explicit'
        ? 'plan'
        : 'preferred';
  const binding: MedicationCourseReview['device_binding'] = {
    choice: choice.device_choice,
    device_id: id,
    device_name: device?.name ?? null,
    source,
  };
  return {
    choice,
    binding,
    device: source === 'plan' || source === 'preferred' ? device : null,
    proof: { choice, binding, device, route },
  };
}
export async function loadCourseDevice(
  client: PoolClient,
  owner: string,
  medicationId: string | null,
  plan: Pick<MedicationCoursePlanInput, 'device_id'>,
  previous?: CourseDeviceChoice
) {
  const med = medicationId
    ? await client.query<{ type_id: string; route_id: string | null }>(
        'SELECT type_id,route_id FROM medications WHERE user_id=$1 AND id=$2',
        [owner, medicationId]
      )
    : null;
  // Keep the saved preference and any owner-editable geometry stable through review/commit.
  const prefs = await client.query<{ default_syringe_id: string | null }>(
    'SELECT default_syringe_id FROM medication_device_preferences WHERE user_id=$1 FOR SHARE',
    [owner]
  );
  const choice = courseDeviceChoice(plan, previous);
  const selectedId =
    choice.device_choice === 'explicit'
      ? choice.device_id
      : (prefs.rows[0]?.default_syringe_id ?? null);
  if (selectedId)
    await client.query(
      'SELECT id FROM medication_syringes WHERE user_id=$1 AND id=$2 FOR SHARE',
      [owner, selectedId]
    );
  const devices = await client.query<MedicationSyringe>(
    'SELECT id,name,device_type,graduation_type,units_per_ml,capacity_ml::text,capacity_units,increment::text,(user_id IS NULL) AS is_shared,false AS is_default,created_at,updated_at FROM medication_syringes WHERE user_id=$1 OR user_id IS NULL ORDER BY id',
    [owner]
  );
  const resolved = resolveCourseDevice(
    choice,
    devices.rows,
    prefs.rows[0]?.default_syringe_id ?? null,
    med?.rows[0] ? resolvePreparedMedicationRoute(med.rows[0]) : null
  );
  if (plan.device_id && resolved.binding.source !== 'plan')
    throw courseProblem(
      'Select an owned or shared device compatible with the medication route.',
      422
    );
  return resolved;
}
