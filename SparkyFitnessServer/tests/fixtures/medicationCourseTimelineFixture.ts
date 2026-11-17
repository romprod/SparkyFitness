import type { MedicationCourseTimelineSnapshot } from '../../models/medicationCourseTimelineRepository.js';
import { medicationCourseFixture } from './medicationCourseFixture.js';
/** Minimal synthetic authored/activity facts; no dose, actual, stock or private-note values. */
export function courseTimelineSnapshotFixture(): MedicationCourseTimelineSnapshot {
  const full = medicationCourseFixture();
  return {
    as_of: '2026-11-17T12:00:00.000Z',
    today: '2026-11-17',
    timezone: 'UTC',
    medications: new Map([
      [
        full.medication_id!,
        { name: 'Synthetic linked medication', is_active: true },
      ],
    ]),
    courses: [
      {
        id: full.id,
        user_id: full.user_id,
        medication_id: full.medication_id,
        medication_name_snapshot: full.medication_name_snapshot,
        current_revision_id: full.current_revision_id,
        version: full.version,
        captured_at: full.captured_at,
        timezone: full.timezone,
        deleted_at: full.deleted_at,
        revisions: full.revisions.map((r) => ({
          id: r.id,
          predecessor_id: r.predecessor_id,
          revision_no: r.revision_no,
          name: r.name,
          status: r.status,
          start_date: r.start_date,
          end_date: r.end_date,
          closed_date: r.closed_date,
          deleted_at: r.deleted_at,
          course_cycle_on_weeks: r.course_cycle_on_weeks,
          course_cycle_off_weeks: r.course_cycle_off_weeks,
          course_cycle_anchor_date: r.course_cycle_anchor_date,
          activity: r.activity.map((a) => ({
            from_at: a.from_at,
            until_at: a.until_at,
          })),
        })),
      },
    ],
  };
}
