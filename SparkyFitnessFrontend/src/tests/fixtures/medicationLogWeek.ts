import {
  addDays,
  type MedicationLogWeekResponse,
  type MedicationLogWeekActual,
  type MedicationLogWeekPlannedSlot,
} from '@workspace/shared';
export const calendarIds = {
  med: '00000000-0000-4000-8000-000000000001',
  actual: '00000000-0000-4000-8000-000000000002',
  revision: '00000000-0000-4000-8000-000000000003',
};
export const calendarActual = (
  changes: Partial<MedicationLogWeekActual> = {}
): MedicationLogWeekActual => ({
  key: `entry:${calendarIds.actual}`,
  id: calendarIds.actual,
  source_kind: 'entry',
  lane_id: `medication:${calendarIds.med}`,
  medication_id: calendarIds.med,
  medication_name: 'Synthetic medication',
  status: 'taken',
  entry_date: '2026-11-17',
  occurred_at: '2026-11-17T09:00:45.678Z',
  dose_amount: '0.5',
  dose_unit: 'mg',
  dose_mg_exact: null,
  schedule_id: null,
  course_origin: null,
  course_revision_id: null,
  course_rule_id: null,
  course_step_id: null,
  course_slot_key: null,
  scheduled_day: null,
  scheduled_for: null,
  notes: 'Recorded note',
  site: null,
  administration_route: null,
  ...changes,
});
export const calendarSlot = (
  changes: Partial<MedicationLogWeekPlannedSlot> = {}
): MedicationLogWeekPlannedSlot => ({
  id: 'slot-a',
  lane_id: `medication:${calendarIds.med}`,
  medication_id: calendarIds.med,
  plan_kind: 'managed',
  timezone: 'America/New_York',
  scheduled_day: '2026-11-17',
  scheduled_for: '2026-11-17T08:00:00-05:00',
  time_of_day: '08:00',
  status: 'pending',
  dose_amount: '0.9',
  dose_unit: 'mg',
  dose_qualification: 'configured',
  course_id: calendarIds.revision,
  course_revision_id: calendarIds.revision,
  course_rule_id: calendarIds.revision,
  course_step_id: null,
  course_slot_key: 'slot-a',
  course_expected_version: 1,
  schedule_id: null,
  ...changes,
});
export const calendarWeek = (
  changes: Partial<MedicationLogWeekResponse> = {}
): MedicationLogWeekResponse => ({
  as_of: '2026-11-17T12:00:00Z',
  today: '2026-11-17',
  timezone: 'Europe/London',
  week_start: '2026-11-16',
  days: Array.from({ length: 7 }, (_, i) => addDays('2026-11-16', i)),
  lanes: [
    {
      id: `medication:${calendarIds.med}`,
      medication_id: calendarIds.med,
      name: 'Synthetic medication',
      is_supplement: false,
    },
  ],
  planned_slots: [],
  actuals: [],
  fulfilled_slots: [],
  coverage: [],
  ...changes,
});
