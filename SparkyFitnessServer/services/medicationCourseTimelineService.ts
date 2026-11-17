import type { PoolClient } from 'pg';
import {
  buildMedicationCourseTimeline,
  medicationCourseTimelineResponseSchema,
  type MedicationCourseTimelineResponse,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { loadMedicationCourseTimelineSnapshot } from '../models/medicationCourseTimelineRepository.js';
export async function getMedicationCourseTimeline(
  owner: string,
  now = new Date()
): Promise<MedicationCourseTimelineResponse> {
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await loadMedicationCourseTimelineSnapshot(
      client,
      owner,
      now
    );
    const timeline = medicationCourseTimelineResponseSchema.parse(
      buildMedicationCourseTimeline(snapshot)
    );
    await client.query('COMMIT');
    return timeline;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
