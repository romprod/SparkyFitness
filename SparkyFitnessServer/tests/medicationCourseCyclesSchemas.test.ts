import { describe, expect, it } from 'vitest';
import {
  medicationCourseCycleWeekSchema,
  medicationCoursePhaseOriginContextSchema,
  medicationCoursePlanInputSchema,
  medicationCourseCreateInputSchema,
  medicationCourseReviewInputSchema,
  medicationCourseCyclePlanPreviewSchema,
} from '../../shared/src/schemas/api/MedicationCourses.api.zod.ts';
import {
  medicationCourseCycleActionInputSchema,
  medicationCourseCycleReviewInputSchema,
  medicationCourseCycleStateSchema,
} from '../../shared/src/schemas/api/MedicationCourseCycles.api.zod.ts';

const id = '40000000-0000-4000-8000-000000000001';
const plan = {
  name: 'Authored cycle',
  start_date: '2026-11-17',
  dose_unit: 'mg',
  rules: [{ schedule_type_id: 'daily' }],
};

describe('manual course cycle contracts', () => {
  it('validates declared positive whole week bounds without parseInt truncation', () => {
    for (const value of [1, 8, 104])
      expect(medicationCourseCycleWeekSchema.parse(value)).toBe(value);
    for (const value of [0, -1, 1.5, 105, '8', '8weeks', Number.NaN])
      expect(medicationCourseCycleWeekSchema.safeParse(value).success).toBe(
        false
      );
  });

  it('preserves weekly omission independently of the existing daily rhythm anchor', () => {
    const parsed = medicationCoursePlanInputSchema.parse({
      ...plan,
      cycle_anchor_date: '2026-11-01',
    });
    expect(parsed.cycle_anchor_date).toBe('2026-11-01');
    expect(parsed).not.toHaveProperty('course_cycle_on_weeks');
    expect(parsed).not.toHaveProperty('course_cycle_off_weeks');
    expect(
      medicationCourseReviewInputSchema.parse({
        ...plan,
        expected_version: 1,
        course_cycle_off_weeks: 3,
      }).course_cycle_off_weeks
    ).toBe(3);
  });

  it('rejects orphaned create breaks but transports an explicit clear to the effective merge', () => {
    const create = {
      ...plan,
      operation_id: id,
      expected_version: 0,
      medication_id: id,
      native_reminder_limitation_acknowledged: false,
    };
    expect(
      medicationCourseCreateInputSchema.safeParse({
        ...create,
        course_cycle_off_weeks: 3,
      }).success
    ).toBe(false);
    expect(
      medicationCourseCreateInputSchema.parse({
        ...create,
        course_cycle_on_weeks: null,
        course_cycle_off_weeks: 3,
      }).course_cycle_on_weeks
    ).toBeNull();
    expect(
      medicationCoursePlanInputSchema.parse({
        ...plan,
        course_cycle_on_weeks: null,
        course_cycle_off_weeks: null,
      }).course_cycle_off_weeks
    ).toBeNull();
  });

  it('never accepts a writable weekly anchor, phase family or origin context in authored input', () => {
    for (const extra of [
      { course_cycle_anchor_date: '2026-11-01' },
      { phase_family_id: id },
      { phase_origin_context: { start_date: '2026-11-01', end_date: null } },
    ]) {
      expect(
        medicationCoursePlanInputSchema.safeParse({ ...plan, ...extra }).success
      ).toBe(false);
    }
  });

  it('stores only the strict original authored window, never frozen dose counts or a guessed frequency', () => {
    expect(
      medicationCoursePhaseOriginContextSchema.parse({
        start_date: '2026-11-01',
        end_date: null,
      })
    ).toEqual({ start_date: '2026-11-01', end_date: null });
    expect(
      medicationCoursePhaseOriginContextSchema.safeParse({
        start_date: '2026-02-30',
        end_date: null,
      }).success
    ).toBe(false);
    expect(
      medicationCoursePhaseOriginContextSchema.safeParse({
        start_date: '2026-11-01',
        end_date: null,
        delivered_count: 8,
      }).success
    ).toBe(false);
    expect(
      medicationCoursePhaseOriginContextSchema.safeParse({
        start_date: '2026-11-01',
        end_date: null,
        frequency: 7,
      }).success
    ).toBe(false);
  });

  it('separates read-only advisory preview from a committed boundary request', () => {
    const preview = medicationCourseCyclePlanPreviewSchema.parse({
      on_weeks: 8,
      off_weeks: null,
      anchor_date: '2026-11-01',
      planned_stop_date: '2026-12-26',
      next_restart_date: null,
      timezone: 'Europe/London',
      advisory: true,
    });
    expect(preview.next_restart_date).toBeNull();
    expect(preview.advisory).toBe(true);
    expect(
      medicationCourseCycleActionInputSchema.safeParse({
        operation_id: id,
        expected_version: 1,
        review_fingerprint: 'reviewed',
        effective_day: '2026-11-17',
      }).success
    ).toBe(false);
    expect(
      medicationCourseCycleActionInputSchema.parse({
        operation_id: id,
        expected_version: 1,
        review_fingerprint: 'reviewed',
      }).operation_id
    ).toBe(id);
  });

  it('retains manual overdue restart availability rather than an automatic next-cycle activation', () => {
    const state = medicationCourseCycleStateSchema.parse({
      course_id: id,
      revision_id: id,
      version: 1,
      timezone: 'Europe/London',
      today: '2027-02-01',
      original_start_date: '2026-11-01',
      on_weeks: 8,
      off_weeks: 4,
      anchor_date: '2026-11-01',
      phase: 'restart_due',
      planned_stop_date: '2026-12-26',
      next_restart_date: '2027-01-24',
      end_cycle: { allowed: true, reasons: [] },
      start_next_cycle: { allowed: true, reasons: [] },
      advisory: true,
    });
    expect(state.phase).toBe('restart_due');
    expect(state.start_next_cycle.allowed).toBe(true);
    expect(
      medicationCourseCycleReviewInputSchema.parse({
        action: 'start',
        expected_version: 1,
      }).action
    ).toBe('start');
  });
});
