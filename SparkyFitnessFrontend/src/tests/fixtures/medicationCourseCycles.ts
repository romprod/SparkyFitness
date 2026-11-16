import type {
  MedicationCourseCycleState,
  MedicationCourseCycleReview,
  MedicationCourseCycleMutationResult,
} from '@workspace/shared';
import { courseIds } from './medicationCourses';
export const cycleStateFixture = (
  patch: Partial<MedicationCourseCycleState> = {}
): MedicationCourseCycleState => ({
  course_id: courseIds.course,
  revision_id: courseIds.revision,
  version: 1,
  timezone: 'America/New_York',
  today: '2026-11-16',
  original_start_date: '2026-11-01',
  on_weeks: 1,
  off_weeks: 1,
  anchor_date: '2026-11-01',
  phase: 'restart_due',
  planned_stop_date: '2026-11-07',
  next_restart_date: '2026-11-15',
  end_cycle: { allowed: true, reasons: [] },
  start_next_cycle: { allowed: true, reasons: [] },
  advisory: true,
  ...patch,
});
export const cycleReviewFixture = (
  patch: Partial<MedicationCourseCycleReview> = {}
): MedicationCourseCycleReview => ({
  action: 'start',
  cycle: cycleStateFixture(),
  effective_day: '2026-11-16',
  candidate_end_date: null,
  new_start_date: '2026-11-16',
  new_end_date: '2026-11-22',
  first_due: {
    scheduled_day: '2026-11-16',
    scheduled_for: '2026-11-16T17:00:00Z',
    time_of_day: '12:00',
  },
  phase_continuity: 'retained',
  can_commit: true,
  conflicts: [],
  review_fingerprint: 'cycle-review-1',
  ...patch,
});
export const cycleMutationFixture = (
  patch: Partial<MedicationCourseCycleMutationResult> = {}
): MedicationCourseCycleMutationResult => ({
  course_id: courseIds.course,
  revision_id: courseIds.revision2,
  version: 2,
  operation_id: '00000000-0000-4000-8000-000000000099',
  action: 'start',
  effective_day: '2026-11-16',
  activated_at: '2026-11-16T16:15:23.456Z',
  boundary_audit: {
    at: '2026-11-16T16:15:23.456Z',
    timezone: 'America/New_York',
    before: {
      revision_id: courseIds.revision,
      status: 'active',
      start_date: '2026-11-01',
      end_date: null,
      weekly_anchor_date: '2026-11-01',
    },
    after: {
      revision_id: courseIds.revision2,
      status: 'active',
      start_date: '2026-11-16',
      end_date: '2026-11-22',
      weekly_anchor_date: '2026-11-16',
    },
  },
  ...patch,
});
