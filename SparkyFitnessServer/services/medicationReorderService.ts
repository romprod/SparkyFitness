import {
  medicationReorderDefaultsSchema,
  DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
  DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
  medicationReorderDefaultsInputSchema,
  type MedicationReorderDefaults,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import {
  courseActor,
  courseProblem,
} from '../models/medicationCourseRepository.js';
export function assertReorderOwner(owner: string) {
  if (courseActor(owner) !== owner)
    throw courseProblem(
      'Reorder defaults belong to the authenticated owner.',
      403
    );
}
export async function getMedicationReorderDefaults(
  owner: string
): Promise<MedicationReorderDefaults> {
  assertReorderOwner(owner);
  const client = await getClient(owner);
  try {
    const result = await client.query(
      'SELECT medication_reorder_lead_days AS lead_days,medication_reorder_buffer_days AS buffer_days FROM user_preferences WHERE user_id=$1',
      [owner]
    );
    return medicationReorderDefaultsSchema.parse(
      result.rows[0] ?? {
        lead_days: DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
        buffer_days: DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
      }
    );
  } finally {
    client.release();
  }
}
export async function saveMedicationReorderDefaults(
  owner: string,
  input: MedicationReorderDefaults
): Promise<MedicationReorderDefaults> {
  assertReorderOwner(owner);
  const value = medicationReorderDefaultsInputSchema.parse(input);
  const client = await getClient(owner);
  try {
    const result = await client.query(
      'INSERT INTO user_preferences(user_id,medication_reorder_lead_days,medication_reorder_buffer_days) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET medication_reorder_lead_days=EXCLUDED.medication_reorder_lead_days,medication_reorder_buffer_days=EXCLUDED.medication_reorder_buffer_days RETURNING medication_reorder_lead_days AS lead_days,medication_reorder_buffer_days AS buffer_days',
      [owner, value.lead_days, value.buffer_days]
    );
    return medicationReorderDefaultsSchema.parse(result.rows[0]);
  } finally {
    client.release();
  }
}
