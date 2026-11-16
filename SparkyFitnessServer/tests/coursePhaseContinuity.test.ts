import { describe, expect, it } from 'vitest';
import {
  buildInventoryForecastPlan,
  courseEntryMatchesSlot,
  coursePhaseActuals,
  coursePhaseContext,
  coursePhaseForRevision,
  coursePhaseFrequency,
  courseSlotsForDay,
  type CourseDeliveredDose,
} from '@workspace/shared';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.ts';
const day = '2026-11-16',
  now = day + 'T12:00:00Z';
function fixture() {
  const course = medicationCourseFixture(),
    origin = course.revisions[0]!;
  Object.assign(origin, {
    phase_family_id: null,
    phase_origin_context: { start_date: origin.start_date, end_date: null },
  });
  origin.steps = [
    {
      id: '00000000-0000-4000-a000-000000000011',
      user_id: course.user_id,
      revision_id: origin.id,
      step_index: 0,
      dose: '1',
      dose_unit: 'mg',
      duration_days: 7,
    },
    {
      id: '00000000-0000-4000-a000-000000000012',
      user_id: course.user_id,
      revision_id: origin.id,
      step_index: 1,
      dose: '2',
      dose_unit: 'mg',
      duration_days: null,
    },
  ];
  const next = {
    ...structuredClone(origin),
    id: '00000000-0000-4000-a000-000000000014',
    predecessor_id: origin.id,
    revision_no: 2,
    start_date: day,
    end_date: '2026-11-18',
    phase_family_id: origin.id,
    phase_origin_context: null,
  };
  next.rules = next.rules.map((rule) => ({
    ...rule,
    id: '00000000-0000-4000-a000-000000000015',
    revision_id: next.id,
  }));
  next.steps = next.steps.map((step, i) => ({
    ...step,
    id: '00000000-0000-4000-a000-00000000002' + i,
    revision_id: next.id,
  }));
  next.activity = next.activity.map((row) => ({
    ...row,
    id: '00000000-0000-4000-a000-000000000016',
    revision_id: next.id,
    from_at: day + 'T00:00:00Z',
  }));
  origin.status = 'completed';
  origin.end_date = '2026-11-15';
  origin.activity[0]!.until_at = day + 'T00:00:00Z';
  course.revisions.push(next);
  course.current_revision_id = next.id;
  const actuals: CourseDeliveredDose[] = Array.from({ length: 7 }, (_, i) => ({
    id: 'dose' + i,
    source_kind: 'injection',
    phase_family_id: origin.id,
    course_revision_id: origin.id,
    entry_date: '2026-11-0' + (i + 1),
    status: 'taken',
  }));
  return { course, origin, next, actuals };
}
const slots = (f: ReturnType<typeof fixture>, phaseDelivered = f.actuals) =>
  courseSlotsForDay({
    course: f.course,
    day,
    today: day,
    nowInstant: now,
    medicationActive: true,
    delivered: [],
    phaseDelivered,
  });
describe('dynamic phase continuity across explicit cycle Start', () => {
  it('continues authored phases without moving prior actuals or giving them new due credit', () => {
    const f = fixture(),
      before = structuredClone(f.actuals),
      due = slots(f);
    expect(due).toHaveLength(1);
    expect(due[0]?.per_dose_amount).toBe('2');
    expect(due[0]?.course_revision_id).toBe(f.next.id);
    expect(courseEntryMatchesSlot(f.actuals[0]!, due[0]!)).toBe(false);
    expect(f.actuals).toEqual(before);
  });
  it('recomputes phase after a prior actual deletion or status correction', () => {
    const f = fixture();
    expect(slots(f)[0]?.per_dose_amount).toBe('2');
    expect(slots(f, f.actuals.slice(1))[0]?.per_dose_amount).toBe('1');
    expect(
      slots(
        f,
        f.actuals.map((row, i) => (i ? row : { ...row, status: 'skipped' }))
      )[0]?.per_dose_amount
    ).toBe('1');
    expect(
      slots(
        f,
        f.actuals.map((row, i) => (i ? row : { ...row, status: 'prn_taken' }))
      )[0]?.per_dose_amount
    ).toBe('2');
  });
  it('retains phase-only provenance after origin tombstoning and actual detachment', () => {
    const f = fixture();
    f.origin.deleted_at = now;
    const detached = f.actuals.map((row) => ({
      ...row,
      course_revision_id: null,
      course_rule_id: null,
      course_slot_key: null,
    }));
    expect(slots(f, detached)[0]?.per_dose_amount).toBe('2');
  });
  it('counts repeated Starts once across their family, with table-aware actual identities', () => {
    const f = fixture(),
      third = {
        ...structuredClone(f.next),
        id: '00000000-0000-4000-a000-000000000030',
        predecessor_id: f.next.id,
        revision_no: 3,
      };
    f.course.revisions.push(third);
    const delivered = [
      ...f.actuals.slice(0, 3),
      ...f.actuals
        .slice(3)
        .map((row) => ({ ...row, course_revision_id: f.next.id })),
      f.actuals[0]!,
    ];
    expect(
      coursePhaseActuals({ course: f.course, revision: third, delivered })
    ).toHaveLength(7);
    const twins = [
      { ...f.actuals[0]!, id: 'same', source_kind: 'entry' as const },
      { ...f.actuals[0]!, id: 'same', source_kind: 'injection' as const },
    ];
    expect(
      coursePhaseActuals({
        course: f.course,
        revision: third,
        delivered: twins,
      })
    ).toHaveLength(2);
  });
  it('excludes unrelated families, legacy unlinked rows and unknown statuses', () => {
    const f = fixture();
    const rows = [
      ...f.actuals,
      { ...f.actuals[0]!, id: 'other', phase_family_id: 'other' },
      {
        ...f.actuals[0]!,
        id: 'legacy',
        phase_family_id: null,
        course_revision_id: null,
      },
      { ...f.actuals[0]!, id: 'missed', status: 'missed' },
    ];
    expect(
      coursePhaseActuals({
        course: f.course,
        revision: f.next,
        delivered: rows,
      })
    ).toHaveLength(7);
  });
  it('requires captured origin context for continuations instead of resetting', () => {
    const f = fixture();
    Object.assign(f.origin, { phase_origin_context: null });
    expect(
      coursePhaseContext({ course: f.course, revision: f.next }).window
    ).toBeNull();
    expect(slots(f)[0]?.per_dose_amount).toBeNull();
    expect(slots(f)[0]?.phase_progress_known).toBe(false);
  });
  it('keeps original frequency window after shortened end bounds and Start', () => {
    const f = fixture();
    f.origin.rules[0]!.end_date = '2026-11-30';
    Object.assign(f.origin, {
      phase_origin_context: {
        start_date: '2026-11-01',
        end_date: '2026-11-30',
      },
    });
    expect(coursePhaseFrequency({ course: f.course, revision: f.next })).toBe(
      7
    );
    expect(slots(f)[0]?.per_dose_amount).toBe('2');
  });
  it('keeps legacy self-family behavior and starts fresh after an explicit carried revision', () => {
    const f = fixture();
    Object.assign(f.next, {
      phase_family_id: null,
      phase_origin_context: null,
    });
    expect(
      coursePhaseActuals({
        course: f.course,
        revision: f.next,
        delivered: f.actuals,
      })
    ).toHaveLength(0);
    expect(
      coursePhaseForRevision({
        course: f.course,
        revision: f.next,
        deliveredCount: 0,
      }).authored_dose
    ).toBe('1');
  });
  it('does not guess phase progress for variable frequency', () => {
    const f = fixture();
    f.origin.rules[0]!.schedule_type_id = 'cyclic';
    f.origin.rules[0]!.cycle_on_days = 2;
    f.origin.rules[0]!.cycle_off_days = 3;
    expect(
      coursePhaseFrequency({ course: f.course, revision: f.next })
    ).toBeNull();
    expect(
      coursePhaseForRevision({
        course: f.course,
        revision: f.next,
        deliveredCount: 7,
      }).authored_dose
    ).toBeNull();
  });
  it('advances only forecast projection while retaining actual-only current target and committed end', () => {
    const f = fixture();
    const actuals = f.actuals.slice(0, 6);
    const plan = buildInventoryForecastPlan({
      today: day,
      now,
      timezone: f.course.timezone,
      medication_active: true,
      route: 'injection',
      courses: [f.course],
      actuals: [],
      phase_actuals: actuals,
      devices: {},
    });
    expect(plan.slots.map((row) => row.value)).toEqual(['1', '2', '2']);
    expect(plan.current_targets?.[0]?.value).toBe('1');
    expect(plan.slots.at(-1)?.day).toBe('2026-11-18');
    expect(plan.basis).toBe('course_end');
    expect(actuals).toHaveLength(6);
  });
  it('excludes a matched early actual from family history before advancing its forecast slot once', () => {
    const f = fixture();
    f.next.steps[1]!.duration_days = 1;
    f.next.steps.push({
      ...f.next.steps[1]!,
      id: '00000000-0000-4000-a000-000000000040',
      step_index: 2,
      dose: '3',
      duration_days: null,
    });
    const early: CourseDeliveredDose = {
      id: 'injection:early',
      source_kind: 'injection',
      phase_family_id: f.origin.id,
      course_revision_id: f.next.id,
      course_rule_id: f.next.rules[0]!.id,
      course_slot_key: JSON.stringify([
        f.next.id,
        f.next.rules[0]!.id,
        '2026-11-17',
        '08:00:00',
      ]),
      scheduled_day: '2026-11-17',
      scheduled_for: '2026-11-17T08:00:00Z',
      entry_date: day,
      occurred_at: day + 'T07:00:00Z',
      status: 'taken',
    };
    const plan = buildInventoryForecastPlan({
      today: day,
      now,
      timezone: f.course.timezone,
      medication_active: true,
      route: 'injection',
      courses: [f.course],
      actuals: [early],
      phase_actuals: [...f.actuals.slice(0, 6), early, early],
      devices: {},
    });
    expect(plan.slots.map((row) => [row.day, row.value])).toEqual([
      [day, '1'],
      ['2026-11-18', '3'],
    ]);
  });
  it('retains same-UUID actuals from both tables through full forecast matching', () => {
    const f = fixture();
    f.next.end_date = day;
    f.next.rules.push({
      ...f.next.rules[0]!,
      id: '00000000-0000-4000-a000-000000000050',
      rule_index: 1,
    });
    const rows: CourseDeliveredDose[] = f.next.rules.map((rule, i) => ({
      id: 'same-uuid',
      source_kind: i ? 'injection' : 'entry',
      phase_family_id: f.origin.id,
      course_revision_id: f.next.id,
      course_rule_id: rule.id,
      course_slot_key: JSON.stringify([f.next.id, rule.id, day, '08:00:00']),
      scheduled_day: day,
      scheduled_for: day + 'T08:00:00Z',
      entry_date: day,
      status: 'taken',
    }));
    const plan = buildInventoryForecastPlan({
      today: day,
      now,
      timezone: f.course.timezone,
      medication_active: true,
      route: 'injection',
      courses: [f.course],
      actuals: rows,
      phase_actuals: [...f.actuals, ...rows],
      devices: {},
    });
    expect(plan.slots).toHaveLength(0);
    expect(
      coursePhaseActuals({
        course: f.course,
        revision: f.next,
        delivered: [...f.actuals, ...rows],
      })
    ).toHaveLength(9);
  });
  it('preserves independently known fixed per-injection amounts but not frequency-dependent targets without context', () => {
    const f = fixture();
    Object.assign(f.origin, { phase_origin_context: null });
    f.next.steps = [];
    const fixed = coursePhaseForRevision({
      course: f.course,
      revision: f.next,
      deliveredCount: 7,
    });
    expect(fixed.authored_dose).toBe('1');
    expect(fixed.dose_amount).toBe('1');
    expect(fixed.injections_per_week).toBeNull();
    expect(fixed.progress_known).toBe(false);
    f.next.dose_basis = 'per_week';
    const weekly = coursePhaseForRevision({
      course: f.course,
      revision: f.next,
      deliveredCount: 7,
    });
    expect(weekly.dose_amount).toBeNull();
    expect(slots(f)[0]?.per_dose_amount).toBeNull();
    f.next.steps = structuredClone(f.origin.steps);
    f.next.dose_basis = 'per_injection';
    expect(
      coursePhaseForRevision({
        course: f.course,
        revision: f.next,
        deliveredCount: 7,
      }).authored_dose
    ).toBeNull();
  });
  it('preserves authored continuation phase units without converting or relabelling amounts', () => {
    const f = fixture();
    f.next.steps[1]!.dose = '500';
    f.next.steps[1]!.dose_unit = 'mcg';
    expect(slots(f)[0]?.per_dose_amount).toBe('500');
    expect(slots(f)[0]?.dose_unit).toBe('mcg');
    f.next.rules[0]!.dose_amount = '1';
    expect(slots(f)[0]?.per_dose_amount).toBe('1');
    expect(slots(f)[0]?.dose_unit).toBe('mg');
  });
});
