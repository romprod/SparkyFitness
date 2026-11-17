import type { PoolClient } from 'pg';
import type { TimelineCourseFacts } from '@workspace/shared';
import { loadCourseOwnerContext } from './medicationCourseRepository.js';
export interface MedicationCourseTimelineSnapshot {
  as_of: string;
  today: string;
  timezone: string;
  courses: TimelineCourseFacts[];
  medications: ReadonlyMap<string, { name: string; is_active: boolean }>;
}
/** Preserve non-null invalid markers for fail-closed geometry; never turn them into absent history. */
const instant = (value: Date | string): string =>
  Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : String(value);
type StoredCourse = Omit<
  TimelineCourseFacts,
  'revisions' | 'captured_at' | 'deleted_at'
> & { captured_at: Date | string; deleted_at: Date | string | null };
type StoredRevision = Omit<
  TimelineCourseFacts['revisions'][number],
  'activity' | 'deleted_at'
> & { course_id: string; deleted_at: Date | string | null };
/** Only existing plan/activity/master facts, using the caller's read-only repeatable-read client. */
export async function loadMedicationCourseTimelineSnapshot(
  client: PoolClient,
  owner: string,
  now: Date
): Promise<MedicationCourseTimelineSnapshot> {
  const context = await loadCourseOwnerContext(client, owner, now);
  const courses = await client.query<StoredCourse>(
    'SELECT id,user_id,medication_id,medication_name_snapshot,current_revision_id,version,captured_at,timezone,deleted_at FROM medication_courses WHERE user_id=$1 AND deleted_at IS NULL ORDER BY captured_at,id',
    [owner]
  );
  const revisions = await client.query<StoredRevision>(
    `SELECT r.id,r.course_id,r.predecessor_id,r.revision_no,r.name,r.status,r.start_date::text,r.end_date::text,r.closed_date::text,r.deleted_at,r.course_cycle_on_weeks,r.course_cycle_off_weeks,r.course_cycle_anchor_date::text
 FROM medication_course_revisions r JOIN medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id
 WHERE r.user_id=$1 AND c.deleted_at IS NULL ORDER BY r.course_id,r.revision_no,r.id`,
    [owner]
  );
  const activity = await client.query<{
    revision_id: string;
    from_at: Date | string;
    until_at: Date | string | null;
  }>(
    `SELECT a.revision_id,a.from_at,a.until_at FROM medication_course_activity a
 JOIN medication_course_revisions r ON r.id=a.revision_id AND r.user_id=a.user_id
 JOIN medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id
 WHERE a.user_id=$1 AND c.deleted_at IS NULL ORDER BY a.revision_id,a.from_at,a.id`,
    [owner]
  );
  const medications = await client.query<{
    id: string;
    name: string;
    is_active: boolean;
  }>(
    `SELECT m.id,COALESCE(NULLIF(m.display_name,''),m.name) AS name,m.is_active FROM medications m
 WHERE m.user_id=$1 AND EXISTS(SELECT 1 FROM medication_courses c WHERE c.user_id=$1 AND c.deleted_at IS NULL AND c.medication_id=m.id) ORDER BY m.id`,
    [owner]
  );
  return {
    as_of: now.toISOString(),
    ...context,
    medications: new Map(
      medications.rows.map((row) => [
        row.id,
        { name: row.name, is_active: row.is_active },
      ])
    ),
    courses: courses.rows.map((course) => ({
      ...course,
      captured_at: instant(course.captured_at),
      deleted_at:
        course.deleted_at === null ? null : instant(course.deleted_at),
      revisions: revisions.rows
        .filter((row) => row.course_id === course.id)
        .map(({ course_id: _courseId, ...revision }) => ({
          ...revision,
          deleted_at:
            revision.deleted_at === null ? null : instant(revision.deleted_at),
          activity: activity.rows
            .filter((row) => row.revision_id === revision.id)
            .map((row) => ({
              from_at: instant(row.from_at),
              until_at: row.until_at === null ? null : instant(row.until_at),
            })),
        })),
    })),
  };
}
