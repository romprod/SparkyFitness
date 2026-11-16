import type {
  MedicationCourse,
  MedicationCourseRevision,
  MedicationCourseReview,
  MedicationCoursePlanInput,
} from '@workspace/shared';
import type { MedicationDetail } from '@/types/medications';
export const courseIds = {
  owner: '00000000-0000-4000-8000-000000000001',
  med: '00000000-0000-4000-8000-000000000002',
  course: '00000000-0000-4000-8000-000000000003',
  revision: '00000000-0000-4000-8000-000000000004',
  rule: '00000000-0000-4000-8000-000000000005',
  step: '00000000-0000-4000-8000-000000000006',
  legacy: '00000000-0000-4000-8000-000000000007',
  revision2: '00000000-0000-4000-8000-000000000008',
};
export const courseMedication = {
  id: courseIds.med,
  user_id: courseIds.owner,
  name: 'Example medication',
  display_name: 'Example medication',
  dose_unit: 'mg',
  dose_amount: 99,
  is_active: true,
  is_glp1: false,
  type_id: 'tablet',
  route_id: null,
  strength_value: null,
  strength_unit: null,
  reason_text: null,
  effectiveness_rating: null,
  color: null,
  icon: null,
  photo_path: null,
  is_quick: false,
  is_supplement: false,
  nutrients: {},
  notes: null,
  source: 'manual',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  custom_fields: {},
  schedules: [],
} satisfies MedicationDetail;
export function courseRevision(
  patch: Partial<MedicationCourseRevision> = {}
): MedicationCourseRevision {
  return {
    id: courseIds.revision,
    user_id: courseIds.owner,
    course_id: courseIds.course,
    predecessor_id: null,
    revision_no: 1,
    name: 'Authored plan',
    notes: null,
    status: 'active',
    start_date: '2026-11-01',
    end_date: null,
    closed_date: null,
    cycle_anchor_date: null,
    target_dose: '1',
    dose_unit: 'mg',
    dose_basis: 'per_injection',
    created_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
    rules: [
      {
        id: courseIds.rule,
        user_id: courseIds.owner,
        revision_id: courseIds.revision,
        rule_index: 0,
        schedule_type_id: 'daily',
        time_of_day: '09:00',
      },
    ],
    steps: [],
    activity: [],
    ...patch,
  };
}
export function courseFixture(
  patch: Partial<MedicationCourse> = {}
): MedicationCourse {
  return {
    id: courseIds.course,
    user_id: courseIds.owner,
    medication_id: courseIds.med,
    medication_name_snapshot: 'Example medication',
    current_revision_id: courseIds.revision,
    version: 1,
    captured_at: '2026-11-01T00:00:00Z',
    capture_day: '2026-11-01',
    timezone: 'Europe/London',
    deleted_at: null,
    revisions: [courseRevision()],
    ...patch,
  };
}
export function courseReview(
  plan: MedicationCoursePlanInput,
  patch: Partial<MedicationCourseReview> = {}
): MedicationCourseReview {
  return {
    expected_version: 0,
    review_fingerprint: 'review-1',
    material_changes: [],
    requires_revision: false,
    timezone: 'Europe/London',
    plan,
    warnings: [],
    resumed_dose: plan.steps[0]?.dose ?? plan.target_dose ?? null,
    resumed_dose_unit: plan.steps[0]?.dose_unit ?? plan.dose_unit,
    carried_steps: plan.steps,
    phase_progress_known: false,
    ...patch,
  };
}
