import {
  buildMedicationLogWeek,
  medicationLogWeekResponseSchema,
  type MedicationLogWeekResponse,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { loadMedicationCalendarSnapshot } from '../models/medicationCalendarRepository.js';

export async function getMedicationCalendarWeek(
  owner: string,
  weekStart?: string,
  now = new Date()
): Promise<MedicationLogWeekResponse> {
  const client = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await loadMedicationCalendarSnapshot(
      client,
      owner,
      now,
      weekStart
    );
    const result = medicationLogWeekResponseSchema.parse(
      buildMedicationLogWeek(snapshot)
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
