import type {
  MedicationCourse,
  MedicationCoursePlanInput,
} from '@workspace/shared';
export const courseFixtureIds = {
  owner: '00000000-0000-4000-a000-000000000001',
  medication: '00000000-0000-4000-a000-000000000002',
  course: '00000000-0000-4000-a000-000000000003',
  revision: '00000000-0000-4000-a000-000000000004',
  rule: '00000000-0000-4000-a000-000000000005',
  step: '00000000-0000-4000-a000-000000000006',
  activity: '00000000-0000-4000-a000-000000000007',
};
export function medicationCoursePlanFixture(): MedicationCoursePlanInput {
  return {
    name: 'Synthetic authored course',
    notes: null,
    start_date: '2026-11-01',
    end_date: null,
    cycle_anchor_date: null,
    target_dose: '1',
    dose_unit: 'mg',
    dose_basis: 'per_injection',
    rules: [{ schedule_type_id: 'daily', time_of_day: '08:00:00' }],
    steps: [],
  };
}
/** Public synthetic identities only. Never copy a personal course into this fixture. */
export function medicationCourseFixture(): MedicationCourse {
  const id = courseFixtureIds,
    p = medicationCoursePlanFixture();
  return {
    id: id.course,
    user_id: id.owner,
    medication_id: id.medication,
    medication_name_snapshot: 'Synthetic medication',
    current_revision_id: id.revision,
    version: 1,
    captured_at: '2026-11-01T00:00:00.000Z',
    capture_day: '2026-11-01',
    timezone: 'Europe/London',
    deleted_at: null,
    revisions: [
      {
        id: id.revision,
        user_id: id.owner,
        course_id: id.course,
        predecessor_id: null,
        revision_no: 1,
        name: p.name,
        notes: null,
        status: 'active',
        start_date: p.start_date,
        end_date: null,
        closed_date: null,
        cycle_anchor_date: null,
        target_dose: '1',
        dose_unit: 'mg',
        dose_basis: 'per_injection',
        created_at: '2026-11-01T00:00:00.000Z',
        deleted_at: null,
        rules: [
          {
            ...p.rules[0]!,
            id: id.rule,
            user_id: id.owner,
            revision_id: id.revision,
            rule_index: 0,
          },
        ],
        steps: [],
        activity: [
          {
            id: id.activity,
            user_id: id.owner,
            revision_id: id.revision,
            from_at: '2026-11-01T00:00:00.000Z',
            until_at: null,
          },
        ],
      },
    ],
  };
}
