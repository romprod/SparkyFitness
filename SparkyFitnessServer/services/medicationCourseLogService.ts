import type { PoolClient } from 'pg';
import {
  todayInZone,
  isValidTimeZone,
  type MedicationCourseAttributionInput,
} from '@workspace/shared';
import { lockCourseAttribution } from '../models/medicationCourseRepository.js';

/** Stored metadata is factual attribution; it never changes an actual dose or its stock. */
export interface StoredCourseLog extends MedicationCourseAttributionInput {
  id?: string;
  medication_id: string | null;
  schedule_id?: string | null;
  entry_date?: string | Date | null;
}

export const courseLogFields = [
  'course_revision_id',
  'course_rule_id',
  'course_step_id',
  'scheduled_day',
  'course_slot_key',
] as const;

export async function lockLogMedication(
  client: PoolClient,
  owner: string,
  medicationId: string | null
) {
  if (!medicationId) return;
  await client.query(
    'SELECT id FROM medications WHERE id=$1 AND user_id=$2 FOR UPDATE',
    [medicationId, owner]
  );
}

async function trackingDay(
  client: PoolClient,
  owner: string,
  value: string | Date | null | undefined
) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
    return value.slice(0, 10);
  // This is only for a newly logged actual whose caller omitted its tracking day.
  // Historical rows always retain their persisted entry_date.
  const result = await client.query<{ timezone: string | null }>(
    'SELECT timezone FROM user_preferences WHERE user_id=$1',
    [owner]
  );
  const timezone = result.rows[0]?.timezone;
  return todayInZone(timezone && isValidTimeZone(timezone) ? timezone : 'UTC');
}

/** Caller holds medication, before taking any stock or actual-row locks. */
export async function lockStoredCourseLog(
  client: PoolClient,
  owner: string,
  stored: StoredCourseLog
) {
  if (!stored.course_revision_id) return;
  await lockCourseAttribution(
    client,
    owner,
    stored.medication_id,
    {
      course_revision_id: stored.course_revision_id,
      course_rule_id: stored.course_rule_id,
      course_step_id: stored.course_step_id,
    },
    await trackingDay(client, owner, stored.entry_date)
  );
}

/** New scheduled actions are versioned; edits without new attribution retain saved slot facts. */
export async function validateCourseLog(
  client: PoolClient,
  owner: string,
  medicationId: string | null,
  patch: MedicationCourseAttributionInput,
  entryDate?: string | Date | null,
  stored?: StoredCourseLog,
  sourceKind: 'entry' | 'injection' = 'entry'
) {
  if (
    medicationId === null &&
    patch.course_revision_id &&
    patch.course_revision_id !== stored?.course_revision_id
  )
    throw Object.assign(
      new Error('A deleted medication cannot receive new course attribution.'),
      { statusCode: 422 }
    );
  if (stored) await lockStoredCourseLog(client, owner, stored);
  const attribution: MedicationCourseAttributionInput = { ...stored, ...patch };
  if (
    stored &&
    sourceKind === 'injection' &&
    !attribution.course_revision_id &&
    !attribution.course_slot_key
  ) {
    if (patch.scheduled_for !== undefined) {
      const before = stored.scheduled_for
        ? new Date(stored.scheduled_for).getTime()
        : null;
      const after = patch.scheduled_for
        ? new Date(patch.scheduled_for).getTime()
        : null;
      if (before !== after)
        throw Object.assign(
          new Error(
            'A new scheduled timestamp requires an explicit known course slot.'
          ),
          { statusCode: 422 }
        );
    }
    if (
      patch.scheduled_day !== undefined &&
      patch.scheduled_day !== (stored.scheduled_day ?? null)
    )
      throw Object.assign(
        new Error(
          'A new scheduled day requires an explicit known course slot.'
        ),
        { statusCode: 422 }
      );
  }
  // Omitted old-client metadata must never discover or infer a managed course.
  if (
    !attribution.course_revision_id &&
    !attribution.course_rule_id &&
    !attribution.course_step_id &&
    !attribution.course_slot_key &&
    !attribution.course_expected_version
  )
    return;
  await lockCourseAttribution(
    client,
    owner,
    medicationId,
    attribution,
    await trackingDay(client, owner, entryDate ?? stored?.entry_date),
    undefined,
    stored?.id ? { id: stored.id, source_kind: sourceKind } : undefined
  );
}
