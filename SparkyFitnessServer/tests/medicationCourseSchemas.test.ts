import { describe, expect, it } from 'vitest';
import {
  medicationCourseAttributionInputSchema,
  medicationCourseCreateInputSchema,
  medicationCourseDaySchema,
  medicationCourseDoseSchema,
  medicationCourseRuleInputSchema,
  medicationCourseDueSchema,
} from '../../shared/src/schemas/api/MedicationCourses.api.zod.ts';

const revisionId = '10000000-0000-4000-8000-000000000001';
const ruleId = '10000000-0000-4000-8000-000000000002';
const plan = {
  medication_id: '10000000-0000-4000-8000-000000000003',
  operation_id: '10000000-0000-4000-8000-000000000004',
  expected_version: 0,
  name: 'Authored plan',
  start_date: '2026-11-16',
  dose_unit: 'mg',
  rules: [{ schedule_type_id: 'daily', time_of_day: '09:00' }],
  native_reminder_limitation_acknowledged: false,
};

describe('explicit medication course contracts', () => {
  it('keeps historical slot completion separate from the actual administration day', () => {
    const result = medicationCourseDueSchema.parse({
      courses: [],
      slots: [
        {
          course_id: '10000000-0000-4000-8000-000000000006',
          schedule_type_id: 'daily',
          course_revision_id: revisionId,
          course_rule_id: ruleId,
          course_step_id: null,
          course_slot_key: 'explicit-historical-slot',
          course_expected_version: 1,
          medication_id: plan.medication_id,
          scheduled_day: '2026-11-16',
          time_of_day: '09:00',
          scheduled_for: '2026-11-16T09:00:00Z',
          per_dose_amount: '1',
          authored_dose: '1',
          dose_unit: 'mg',
          dose_basis: 'per_injection',
          phase_progress_known: true,
        },
      ],
      today: '2026-11-18',
      timezone: 'Europe/London',
      fulfilled_slots: [
        {
          course_revision_id: revisionId,
          course_rule_id: ruleId,
          course_slot_key: 'explicit-historical-slot',
          scheduled_day: '2026-11-16',
          status: 'taken',
          source_kind: 'injection',
          entry_id: '10000000-0000-4000-8000-000000000005',
          occurred_at: '2026-11-18T10:12:34Z',
          entry_date: '2026-11-18',
          notes: 'Must not spill unrelated actual metadata',
        },
      ],
    });
    expect(result.fulfilled_slots[0]?.scheduled_day).toBe('2026-11-16');
    expect(result.fulfilled_slots[0]?.entry_date).toBe('2026-11-18');
    expect(result.fulfilled_slots[0]?.occurred_at).toBe('2026-11-18T10:12:34Z');
    expect(result.fulfilled_slots[0]).not.toHaveProperty('notes');
    expect(
      medicationCourseDueSchema.safeParse({
        ...result,
        fulfilled_slots: undefined,
      }).success
    ).toBe(false);
  });

  it('validates calendar dates without accepting rollovers or timestamps', () => {
    expect(medicationCourseDaySchema.parse('2028-02-29')).toBe('2028-02-29');
    for (const day of ['2026-02-29', '2026-04-31', '2026-11-16T00:00:00Z']) {
      expect(medicationCourseDaySchema.safeParse(day).success).toBe(false);
    }
  });

  it('round-trips exact authored decimals without binary floating point', () => {
    expect(medicationCourseDoseSchema.parse('0.10000000000000000001')).toBe(
      '0.10000000000000000001'
    );
    expect(medicationCourseDoseSchema.parse('1.2500')).toBe('1.25');
    for (const dose of ['0', '-1', 'NaN', 'Infinity', '1e200000']) {
      expect(medicationCourseDoseSchema.safeParse(dose).success).toBe(false);
    }
  });

  it('retains all authored slots and requires an explicit new course start', () => {
    const parsed = medicationCourseCreateInputSchema.parse({
      ...plan,
      rules: [
        ...plan.rules,
        { schedule_type_id: 'daily', time_of_day: '21:00' },
      ],
    });
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.steps).toEqual([]);
    expect(parsed.dose_basis).toBe('per_injection');
    expect(
      medicationCourseCreateInputSchema.safeParse({ ...plan, start_date: null })
        .success
    ).toBe(false);
  });

  it('requires both reviewed handoff fingerprint and native limitation acknowledgement', () => {
    const handoff = {
      cutover_day: '2026-11-16',
      selected_rules: [{ schedule_id: ruleId, fingerprint: 'original-rule' }],
    };
    expect(
      medicationCourseCreateInputSchema.safeParse({ ...plan, handoff }).success
    ).toBe(false);
    expect(
      medicationCourseCreateInputSchema.safeParse({
        ...plan,
        handoff,
        review_fingerprint: 'reviewed-plan',
      }).success
    ).toBe(false);
    expect(
      medicationCourseCreateInputSchema.safeParse({
        ...plan,
        handoff,
        review_fingerprint: 'reviewed-plan',
        native_reminder_limitation_acknowledged: true,
      }).success
    ).toBe(true);
  });

  it('accepts omitted legacy attribution and explicit manual old-revision attribution', () => {
    expect(medicationCourseAttributionInputSchema.parse({})).toEqual({});
    expect(
      medicationCourseAttributionInputSchema.parse({
        course_revision_id: revisionId,
      })
    ).toEqual({ course_revision_id: revisionId });
    expect(
      medicationCourseAttributionInputSchema.safeParse({
        course_rule_id: ruleId,
      }).success
    ).toBe(false);
    expect(
      medicationCourseAttributionInputSchema.safeParse({
        course_revision_id: revisionId,
        course_slot_key: 'slot',
      }).success
    ).toBe(false);
  });

  it('retains known scheduled timing after course associations are detached', () => {
    const detached = {
      course_revision_id: null,
      course_rule_id: null,
      course_step_id: null,
      course_slot_key: null,
      scheduled_day: '2026-11-16',
      scheduled_for: '2026-11-16T09:00:00Z',
    };
    expect(medicationCourseAttributionInputSchema.parse(detached)).toEqual(
      detached
    );
  });

  it('never accepts client-supplied origin or medication name snapshots as attribution', () => {
    expect(
      medicationCourseAttributionInputSchema.parse({
        course_origin: true,
        medication_name_snapshot: 'Forged name',
      })
    ).toEqual({});
  });

  it('preserves explicit timed versus day-only scheduled attribution', () => {
    const dayOnly = {
      course_revision_id: revisionId,
      course_rule_id: ruleId,
      course_slot_key: 'explicit-slot',
      scheduled_day: '2026-11-16',
      scheduled_for: null,
      course_expected_version: 2,
    };
    expect(medicationCourseAttributionInputSchema.parse(dayOnly)).toEqual(
      dayOnly
    );
    const timed = {
      ...dayOnly,
      scheduled_for: '2026-11-16T09:00:00+00:00',
    };
    expect(medicationCourseAttributionInputSchema.parse(timed)).toEqual(timed);
  });

  it('rejects malformed never-due authored recurrence without restricting PRN or untimed rules', () => {
    for (const schedule_type_id of [
      'weekly',
      'specific_days',
      'every_n_days',
      'monthly',
      'cyclic',
    ]) {
      expect(
        medicationCourseRuleInputSchema.safeParse({ schedule_type_id }).success
      ).toBe(false);
    }
    expect(
      medicationCourseRuleInputSchema.safeParse({ schedule_type_id: 'prn' })
        .success
    ).toBe(true);
    expect(
      medicationCourseRuleInputSchema.safeParse({
        schedule_type_id: 'weekly',
        days_of_week: [1, 5],
        time_of_day: null,
      }).success
    ).toBe(true);
  });
});
