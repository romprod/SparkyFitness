import { describe, expect, it } from 'vitest';
import {
  medicationStackSchema,
  medicationStackScheduleClearInputSchema,
  medicationStackScheduleInputSchema,
  medicationStackScheduleSaveInputSchema,
  stackMemberVerdict,
  stackPlanFor,
  stackPlanKeys,
  stackPlanTiming,
  stackRuleFor,
  stackScheduleKey,
  stackScheduleView,
  stackTimingChanged,
  stackTimingEquals,
  stackTimingViolatesSchedule,
  type MedicationCoursePlanInput,
  type MedicationCourseRuleInput,
  type StackMemberFacts,
  type StackTiming,
} from '@workspace/shared';

const parse = (value: unknown) =>
  medicationStackScheduleInputSchema.safeParse(value);
const messages = (value: unknown) => {
  const parsed = parse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};
const timing = (over: Record<string, unknown> = {}): StackTiming =>
  medicationStackScheduleInputSchema.parse({
    schedule_type_id: 'daily',
    time_of_day: '08:00',
    ...over,
  });
const rule = (
  over: Partial<MedicationCourseRuleInput> = {}
): MedicationCourseRuleInput => ({
  schedule_type_id: 'daily',
  time_of_day: '08:00:00',
  dose_amount: '0.25',
  ...over,
});
const plan = (
  rules: MedicationCourseRuleInput[],
  over: Partial<MedicationCoursePlanInput> = {}
): Pick<
  MedicationCoursePlanInput,
  'rules' | 'start_date' | 'cycle_anchor_date'
> => ({
  start_date: '2026-11-01',
  cycle_anchor_date: null,
  rules,
  ...over,
});

describe('stack schedule input', () => {
  it('accepts each pattern and nulls what the pattern does not use', () => {
    expect(
      parse({
        schedule_type_id: 'specific_days',
        days_of_week: [4, 1, 4],
        interval_days: 5,
        time_of_day: '20:00:00',
      })
    ).toMatchObject({
      success: true,
      data: {
        schedule_type_id: 'specific_days',
        days_of_week: [1, 4],
        interval_days: null,
        time_of_day: '20:00',
        start_date: null,
      },
    });
    expect(
      parse({
        schedule_type_id: 'every_n_days',
        interval_days: 3,
        start_date: '2026-12-01',
        days_of_week: [1],
      })
    ).toMatchObject({
      success: true,
      data: { interval_days: 3, days_of_week: null, time_of_day: null },
    });
    expect(
      parse({
        schedule_type_id: 'cyclic',
        cycle_on_days: 5,
        cycle_off_days: 2,
        start_date: '2026-12-01',
      }).success
    ).toBe(true);
    expect(parse({ schedule_type_id: 'daily' }).success).toBe(true);
  });

  it('uses the Pitstop wording for each rule', () => {
    expect(messages({ schedule_type_id: 'monthly' })).toEqual([
      'Choose how often the stack is taken.',
    ]);
    expect(messages({})).toEqual(['Choose how often the stack is taken.']);
    expect(
      messages({ schedule_type_id: 'specific_days', days_of_week: [] })
    ).toEqual(['Choose at least one weekday.']);
    expect(
      messages({
        schedule_type_id: 'every_n_days',
        interval_days: 1,
        start_date: '2026-12-01',
      })
    ).toEqual(['Enter how many days between doses (2 or more).']);
    expect(
      messages({
        schedule_type_id: 'cyclic',
        cycle_on_days: 3,
        cycle_off_days: 0,
        start_date: '2026-12-01',
      })
    ).toEqual(['Enter days on and days off (1 or more each).']);
    expect(
      messages({ schedule_type_id: 'every_n_days', interval_days: 2 })
    ).toEqual(['Set a start date for interval / cycle schedules.']);
    expect(
      messages({
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 2,
      })
    ).toEqual(['Set a start date for interval / cycle schedules.']);
    expect(messages({ schedule_type_id: 'daily', time_of_day: '8am' })).toEqual(
      ['Use a 24-hour time such as 08:00.']
    );
    expect(
      messages({ schedule_type_id: 'daily', start_date: '2026-02-30' })
    ).toEqual(['Enter a valid calendar date']);
  });

  it('does not require a start date for daily or specific days', () => {
    expect(parse({ schedule_type_id: 'daily' }).success).toBe(true);
    expect(
      parse({ schedule_type_id: 'specific_days', days_of_week: [0] }).success
    ).toBe(true);
  });

  it('is strict about unknown fields and the save and clear bodies', () => {
    expect(
      parse({ schedule_type_id: 'daily', end_date: '2027-01-01' }).success
    ).toBe(false);
    const save = {
      schedule: { schedule_type_id: 'daily' },
      operation_id: '00000000-0000-4000-a000-000000000001',
      expected_version: 0,
      review_fingerprint: 'abc',
      effective_from: '2026-12-01',
    };
    expect(medicationStackScheduleSaveInputSchema.parse(save)).toMatchObject({
      skipped_member_ids: [],
      acknowledged_member_ids: [],
    });
    expect(
      medicationStackScheduleSaveInputSchema.safeParse({ ...save, extra: 1 })
        .success
    ).toBe(false);
    expect(
      medicationStackScheduleClearInputSchema.safeParse({
        operation_id: save.operation_id,
        expected_version: 0,
      }).success
    ).toBe(false);
  });

  it('leaves the stack list shape additive', () => {
    const stack = {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'Morning',
      notes: null,
      members: [
        {
          medication_id: '00000000-0000-4000-a000-000000000002',
          name: 'A',
          is_supplement: false,
          is_active: true,
        },
      ],
      created_at: '2026-11-26T00:00:00.000Z',
    };
    expect(medicationStackSchema.parse(stack)).toEqual(stack);
  });
});

describe('stack timing projection', () => {
  it('replaces timing, keeps the dose, and ignores doses when comparing', () => {
    const schedule = timing({
      schedule_type_id: 'specific_days',
      days_of_week: [1, 4],
      time_of_day: '20:00',
    });
    const projected = stackRuleFor(
      schedule,
      rule({ dose_amount: '0.5', with_meal: 'with', start_date: '2026-11-01' })
    );
    expect(projected).toMatchObject({
      schedule_type_id: 'specific_days',
      days_of_week: [1, 4],
      time_of_day: '20:00',
      dose_amount: '0.5',
      with_meal: 'with',
      start_date: '2026-11-01',
      interval_days: null,
      anchor_date: null,
    });
    expect(stackTimingEquals(schedule, plan([projected]))).toBe(true);
    expect(
      stackTimingEquals(
        schedule,
        plan([{ ...projected, dose_amount: '9', time_of_day: '20:00:00' }])
      )
    ).toBe(true);
    expect(
      stackTimingEquals(
        schedule,
        plan([{ ...projected, time_of_day: '21:00' }])
      )
    ).toBe(false);
  });

  it('writes the anchor of interval and cycle schedules and clears a plan-level cycle anchor', () => {
    const every = timing({
      schedule_type_id: 'every_n_days',
      interval_days: 3,
      start_date: '2026-12-01',
    });
    expect(stackRuleFor(every, rule())).toMatchObject({
      interval_days: 3,
      anchor_date: '2026-12-01',
    });
    const cyclic = timing({
      schedule_type_id: 'cyclic',
      cycle_on_days: 5,
      cycle_off_days: 2,
      start_date: '2026-12-01',
    });
    const projected = stackPlanFor(
      cyclic,
      plan([rule()], { cycle_anchor_date: '2026-10-01' })
    );
    expect(projected.cycle_anchor_date).toBeNull();
    expect(projected.rules[0]).toMatchObject({
      cycle_on_days: 5,
      cycle_off_days: 2,
      anchor_date: '2026-12-01',
    });
    expect(stackTimingEquals(cyclic, projected)).toBe(true);
    // A plan-level cycle anchor overrides the rule's, so it is not the stack's timing.
    expect(
      stackTimingEquals(
        cyclic,
        plan([projected.rules[0]!], { cycle_anchor_date: '2026-10-01' })
      )
    ).toBe(false);
  });

  it('collapses several timed rules into the first and keeps as-needed rules', () => {
    const schedule = timing({ time_of_day: '09:00' });
    const projected = stackPlanFor(
      schedule,
      plan([
        rule({ dose_amount: '1', time_of_day: '07:00' }),
        rule({ schedule_type_id: 'prn', time_of_day: null }),
        rule({ dose_amount: '2', time_of_day: '19:00' }),
      ])
    );
    expect(
      projected.rules.map((r) => [r.schedule_type_id, r.dose_amount])
    ).toEqual([
      ['daily', '1'],
      ['prn', '0.25'],
    ]);
    expect(stackTimingEquals(schedule, projected)).toBe(true);
    const onlyPrn = plan([rule({ schedule_type_id: 'prn' })]);
    expect(stackPlanFor(schedule, onlyPrn)).toBe(onlyPrn);
  });

  it('tells a changed timing from a changed dose, and guards only changes away from the stack', () => {
    const schedule = timing({ time_of_day: '08:00' });
    const before = plan([rule({ time_of_day: '08:00:00' })]);
    expect(stackTimingChanged(before, plan([rule({ dose_amount: '9' })]))).toBe(
      false
    );
    expect(
      stackTimingChanged(before, plan([rule({ time_of_day: '09:00' })]))
    ).toBe(true);
    // Dose-only edits pass; a timing change away from the stack is refused.
    expect(
      stackTimingViolatesSchedule(
        schedule,
        before,
        plan([rule({ dose_amount: '9' })])
      )
    ).toBe(false);
    expect(
      stackTimingViolatesSchedule(
        schedule,
        before,
        plan([rule({ time_of_day: '09:00' })])
      )
    ).toBe(true);
    // Moving an out-of-date plan onto the stack's timing is allowed.
    expect(
      stackTimingViolatesSchedule(
        schedule,
        plan([rule({ time_of_day: '12:00' })]),
        plan([rule({ time_of_day: '08:00' })])
      )
    ).toBe(false);
    // Plan start dates and PRN rules are not timing.
    expect(
      stackTimingViolatesSchedule(
        schedule,
        before,
        plan([rule(), rule({ schedule_type_id: 'prn' })], {
          start_date: '2027-01-01',
        })
      )
    ).toBe(false);
  });

  it('describes timing for display', () => {
    expect(
      stackPlanTiming(
        plan([
          rule({
            schedule_type_id: 'specific_days',
            days_of_week: [4, 1],
            time_of_day: '20:00:00',
          }),
        ])
      )
    ).toEqual([
      {
        schedule_type_id: 'specific_days',
        time_of_day: '20:00',
        days_of_week: [1, 4],
        interval_days: null,
        cycle_on_days: null,
        cycle_off_days: null,
        start_date: null,
      },
    ]);
    expect(
      stackScheduleView(timing({ time_of_day: '08:00:00' }))
    ).toMatchObject({
      time_of_day: '08:00',
    });
    expect(stackPlanKeys(plan([rule()]))).toEqual([
      stackScheduleKey(timing({ time_of_day: '08:00:00' })),
    ]);
  });
});

describe('stack member verdict', () => {
  const schedule = timing({ time_of_day: '09:00' });
  const facts = (over: Partial<StackMemberFacts> = {}): StackMemberFacts => ({
    schedule,
    plan: {
      bucket: 'active',
      has_history: false,
      value: plan([rule({ time_of_day: '08:00' })]),
    },
    legacy_running: false,
    other_stack_name: null,
    ...over,
  });
  const planned = (
    over: Partial<NonNullable<StackMemberFacts['plan']>>
  ): StackMemberFacts['plan'] => ({ ...facts().plan!, ...over });

  it('changes a plan in place when it has no delivered doses', () => {
    expect(stackMemberVerdict(facts())).toEqual({
      action: 'edit',
      reason: null,
      needs_ack: false,
    });
    expect(
      stackMemberVerdict(facts({ plan: planned({ bucket: 'scheduled' }) }))
        .action
    ).toBe('edit');
    expect(
      stackMemberVerdict(
        facts({ plan: planned({ bucket: 'paused', has_history: false }) })
      ).action
    ).toBe('edit');
  });

  it('writes a successor when delivered doses exist, and blocks a paused one', () => {
    expect(
      stackMemberVerdict(facts({ plan: planned({ has_history: true }) })).action
    ).toBe('revise');
    expect(
      stackMemberVerdict(
        facts({ plan: planned({ has_history: true, bucket: 'paused' }) })
      )
    ).toMatchObject({ action: 'blocked', reason: 'paused' });
  });

  it('leaves a member that already has the timing alone', () => {
    expect(
      stackMemberVerdict(
        facts({
          plan: planned({
            has_history: true,
            value: plan([rule({ time_of_day: '09:00:00', dose_amount: '3' })]),
          }),
        })
      ).action
    ).toBe('unchanged');
  });

  it('skips finished plans, waits for a missing plan and blocks a legacy rule or another stack', () => {
    for (const bucket of ['completed', 'ended'] as const)
      expect(
        stackMemberVerdict(facts({ plan: planned({ bucket }) })).action
      ).toBe('skipped');
    expect(stackMemberVerdict(facts({ plan: null })).action).toBe('pending');
    expect(
      stackMemberVerdict(facts({ plan: null, legacy_running: true }))
    ).toMatchObject({ action: 'blocked', reason: 'has_own_schedule' });
    expect(
      stackMemberVerdict(facts({ other_stack_name: 'Evening' }))
    ).toMatchObject({ action: 'blocked', reason: 'follows_other_stack' });
    expect(
      stackMemberVerdict(
        facts({
          plan: planned({ value: plan([rule({ schedule_type_id: 'prn' })]) }),
        })
      )
    ).toMatchObject({ action: 'blocked', reason: 'only_as_needed' });
  });

  it('asks for confirmation when several timed rules become one', () => {
    expect(
      stackMemberVerdict(
        facts({
          plan: planned({
            value: plan([
              rule({ time_of_day: '07:00' }),
              rule({ time_of_day: '19:00' }),
            ]),
          }),
        })
      )
    ).toMatchObject({ action: 'edit', needs_ack: true });
  });
});
