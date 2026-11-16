import type { PoolClient } from 'pg';
import {
  todayInZone,
  isValidTimeZone,
  type MedicationCourseAttributionInput,
} from '@workspace/shared';
import {
  lockCourseAttribution,
  lockCoursePhaseFamily,
  findCoursePhaseFamily,
} from '../models/medicationCourseRepository.js';

/** Stored metadata is factual attribution; it never changes an actual dose or its stock. */
export interface StoredCourseLog extends MedicationCourseAttributionInput {
  id?: string;
  phase_family_id?: string | null;
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

/** Caller holds its medication; resolve both explicit scopes before course/revision/stock locks. */
export async function lockStoredCourseLog(
  client: PoolClient,
  owner: string,
  stored: StoredCourseLog,
  sourceKind: 'entry' | 'injection' = 'entry',
  nextRevisionId?: string | null
): Promise<StoredCourseLog | null> {
  const families = new Set<string>();
  if (stored.phase_family_id) families.add(stored.phase_family_id);
  const revisionIds = new Set(
    [stored.course_revision_id, nextRevisionId].filter(
      (id): id is string => !!id
    )
  );
  for (const revisionId of revisionIds) {
    const known = await client.query<{ family_id: string }>(
      'SELECT COALESCE(phase_family_id,id) AS family_id FROM medication_course_revisions WHERE id=$1 AND user_id=$2',
      [revisionId, owner]
    );
    if (known.rows[0]) families.add(known.rows[0].family_id);
  }
  if (!families.size && !stored.course_revision_id && !nextRevisionId)
    return stored;
  const targets = new Map<
    string,
    { family_id: string; course_id: string; medication_id: string | null }
  >();
  for (const familyId of families) {
    const target = await findCoursePhaseFamily(client, owner, familyId);
    if (!target) continue; // A true hard deletion leaves no active phase consumer.
    if (target.medication_id !== stored.medication_id)
      throw Object.assign(
        new Error('Phase provenance does not match this medication.'),
        { statusCode: 404 }
      );
    targets.set(target.course_id, { ...target, family_id: familyId });
  }
  for (const target of [...targets.values()].sort((a, b) =>
    a.course_id.localeCompare(b.course_id)
  ))
    await lockCoursePhaseFamily(client, owner, target.family_id);
  let current = stored;
  if (stored.id) {
    const table =
      sourceKind === 'injection' ? 'injection_entries' : 'medication_entries';
    const actual = await client.query<StoredCourseLog>(
      `SELECT * FROM ${table} WHERE id=$1 AND user_id=$2`,
      [stored.id, owner]
    );
    if (!actual.rows[0]) return null;
    current = actual.rows[0];
    if (
      current.medication_id !== stored.medication_id ||
      (current.phase_family_id ?? null) !== (stored.phase_family_id ?? null) ||
      (current.course_revision_id ?? null) !==
        (stored.course_revision_id ?? null)
    )
      throw Object.assign(
        new Error(
          'Actual attribution changed. Refresh this record before retrying.'
        ),
        { statusCode: 409 }
      );
  }
  if (current.course_revision_id)
    await lockCourseAttribution(
      client,
      owner,
      current.medication_id,
      {
        course_revision_id: current.course_revision_id,
        course_rule_id: current.course_rule_id,
        course_step_id: current.course_step_id,
      },
      await trackingDay(client, owner, current.entry_date)
    );
  return current;
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
  if (stored) {
    const locked = await lockStoredCourseLog(
      client,
      owner,
      stored,
      sourceKind,
      patch.course_revision_id
    );
    if (!locked) return;
    stored = locked;
  }
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
