import { describe, expect, it } from 'vitest';
import {
  canonicalCourseDecimal,
  courseCarryCyclicAnchors,
  courseActivePhase,
  courseCurrentPhase,
  courseDaysSpentInPhase,
  courseInjectionsPerWeek,
  courseMaterialChanges,
  coursePerDoseAmount,
  coursePhaseCarry,
  coursePhaseTargets,
  courseRevisionBoundary,
} from '../../shared/src/medications/courseRevisions.ts';
import {
  courseActivityContains,
  courseActivityTransition,
  courseBucket,
  courseEndOnComplete,
  isCurrentCourseTip,
} from '../../shared/src/medications/courseLifecycle.ts';
import {
  courseDueDosesForDay,
  courseHandoffEndDay,
  courseSlotKey,
  courseSlotsForDay,
  type CourseDeliveredDose,
} from '../../shared/src/medications/courseSchedules.ts';
import {
  computeCourseAdherence,
  courseEntryMatchesSlot,
} from '../../shared/src/medications/courseAdherence.ts';
import type {
  MedicationCourse,
  MedicationCoursePlanInput,
  MedicationCourseRevision,
  MedicationCourseRule,
  MedicationCourseStep,
} from '@workspace/shared';
const rule = (
  patch: Partial<MedicationCourseRule> = {}
): MedicationCourseRule => ({
  id: 'rule',
  user_id: 'owner',
  revision_id: 'rev',
  rule_index: 0,
  schedule_type_id: 'daily',
  time_of_day: '09:00',
  ...patch,
});
const revision = (
  patch: Partial<MedicationCourseRevision> = {}
): MedicationCourseRevision => ({
  id: 'rev',
  device_id: null,
  device_choice: 'preferred',
  user_id: 'owner',
  course_id: 'course',
  predecessor_id: null,
  revision_no: 1,
  name: 'Synthetic course',
  notes: null,
  status: 'active',
  start_date: '2026-03-01',
  end_date: null,
  closed_date: null,
  cycle_anchor_date: null,
  target_dose: '1',
  dose_unit: 'mg',
  dose_basis: 'per_injection',
  created_at: '2026-03-01T00:00:00Z',
  deleted_at: null,
  rules: [rule()],
  steps: [],
  activity: [
    {
      id: 'activity',
      user_id: 'owner',
      revision_id: 'rev',
      from_at: '2026-03-01T00:00:00Z',
      until_at: null,
    },
  ],
  ...patch,
});
const course = (patch: Partial<MedicationCourse> = {}): MedicationCourse => ({
  id: 'course',
  user_id: 'owner',
  medication_id: 'med',
  medication_name_snapshot: 'Synthetic medication',
  current_revision_id: 'rev',
  version: 1,
  captured_at: '2026-03-01T00:00:00Z',
  capture_day: '2026-03-01',
  timezone: 'Europe/London',
  deleted_at: null,
  revisions: [revision()],
  ...patch,
});
const steps: MedicationCourseStep[] = [0, 1, 2].map((i) => ({
  id: `step${i}`,
  user_id: 'owner',
  revision_id: 'rev',
  step_index: i,
  dose: String(i + 1),
  dose_unit: 'mg',
  duration_days: i === 0 ? 14 : i === 1 ? 7 : null,
}));
const slots = (
  value: MedicationCourse,
  day: string,
  active = true,
  delivered?: CourseDeliveredDose[]
) =>
  courseSlotsForDay({
    course: value,
    day,
    today: '2026-03-29',
    nowInstant: '2026-03-29T12:00:00Z',
    medicationActive: active,
    delivered,
  });
const delivered = (
  slot: ReturnType<typeof slots>[number],
  id = 'actual',
  status = 'taken'
): CourseDeliveredDose => ({
  id,
  status,
  course_revision_id: slot.course_revision_id,
  course_rule_id: slot.course_rule_id,
  course_slot_key: slot.course_slot_key,
  scheduled_day: slot.scheduled_day,
  scheduled_for: slot.scheduled_for,
  entry_date: slot.scheduled_day,
});
const plan = (): MedicationCoursePlanInput => ({
  name: 'Synthetic',
  start_date: '2026-03-01',
  dose_unit: 'mg',
  dose_basis: 'per_injection',
  rules: [rule()],
  steps: steps,
});

describe('source revision and authored phase math', () => {
  it('normalises exact decimal values without Number conversion', () => {
    expect(canonicalCourseDecimal('01.00000000000000000001')).toBe(
      '1.00000000000000000001'
    );
    expect(() => canonicalCourseDecimal('NaN')).toThrow();
    expect(() => canonicalCourseDecimal('0')).toThrow();
  });
  it.each([
    { rules: [rule()], expected: 7 },
    {
      rules: [rule({ schedule_type_id: 'weekly', days_of_week: [1, 3, 1] })],
      expected: 2,
    },
    {
      rules: [rule({ schedule_type_id: 'every_n_days', interval_days: 2 })],
      expected: 3.5,
    },
    {
      rules: [rule({ schedule_type_id: 'monthly', day_of_month: 31 })],
      activity: [
        { ...revision().activity[0]!, from_at: '2026-02-01T00:00:00Z' },
      ],
      expected: null,
    },
    {
      rules: [
        rule({
          schedule_type_id: 'cyclic',
          cycle_on_days: 2,
          cycle_off_days: 2,
        }),
      ],
      expected: null,
    },
    { rules: [rule({ schedule_type_id: 'prn' })], expected: null },
  ])(
    'resolves only unambiguous weekly frequency $expected',
    ({ rules, expected }) =>
      expect(courseInjectionsPerWeek(rules)).toBe(expected)
  );
  it('does not sum staggered or narrower rule windows into a fictional frequency', () => {
    expect(
      courseInjectionsPerWeek([
        rule({ start_date: '2026-03-01', end_date: '2026-03-07' }),
        rule({ start_date: '2026-03-08', end_date: '2026-03-14' }),
      ])
    ).toBeNull();
    expect(
      courseInjectionsPerWeek(
        [rule({ start_date: '2026-03-01', end_date: '2026-03-07' })],
        { start_date: '2026-03-01', end_date: '2026-03-07' }
      )
    ).toBe(7);
  });
  it('uses OLD frequency and delivered attribution to carry the current and later phases', () => {
    expect(coursePhaseTargets(steps, 2)).toEqual([4, 2, null]);
    const actuals = [
      '2026-03-01',
      '2026-03-04',
      '2026-03-08',
      '2026-03-11',
      '2026-03-15',
    ];
    expect(
      coursePhaseCarry({
        steps: [...steps].reverse(),
        oldInjectionsPerWeek: 2,
        deliveredDayKeys: actuals,
        today: '2026-03-18',
      })
    ).toMatchObject({
      current_step_index: 1,
      progress_known: true,
      steps: [
        { step_index: 0, dose: '2', duration_days: 4 },
        { step_index: 1, dose: '3', duration_days: null },
      ],
    });
    expect(
      courseDaysSpentInPhase({
        steps,
        oldInjectionsPerWeek: 2,
        deliveredDayKeys: actuals.slice(0, 4),
        today: '2026-03-18',
      })
    ).toBe(0);
  });
  it('copies unknown progress rather than guesses and preserves indefinite/minimum-one phases', () => {
    expect(
      coursePhaseCarry({
        steps,
        oldInjectionsPerWeek: null,
        deliveredDayKeys: ['2026-03-01'],
        today: '2026-03-18',
      })
    ).toMatchObject({
      progress_known: false,
      steps: steps.map((step, i) => ({
        dose: step.dose,
        dose_unit: step.dose_unit,
        duration_days: step.duration_days,
        step_index: i,
      })),
    });
    expect(
      coursePhaseCarry({
        steps,
        oldInjectionsPerWeek: 2,
        deliveredDayKeys: ['2026-01-01'],
        today: '2026-03-18',
      }).steps[0]?.duration_days
    ).toBe(1);
    expect(courseActivePhase([0, 0, null], 0)).toBe(2);
    expect(
      coursePhaseCarry({
        steps: [],
        oldInjectionsPerWeek: 2,
        deliveredDayKeys: [],
        today: '2026-03-18',
      }).steps
    ).toEqual([]);
  });
  it('divides per-week once at source six-decimal precision and does not guess variable-frequency phase doses', () => {
    expect(coursePerDoseAmount('8', 'per_week', 3)).toBe('2.666667');
    expect(coursePerDoseAmount('8', 'per_week', null)).toBeNull();
    expect(
      courseCurrentPhase({
        revision: revision({
          steps,
          dose_basis: 'per_week',
          rules: [rule({ schedule_type_id: 'weekly', days_of_week: [1, 4] })],
        }),
        deliveredCount: 4,
      })
    ).toMatchObject({
      step_id: 'step1',
      authored_dose: '2',
      dose_amount: '1',
      progress_known: true,
    });
    expect(
      courseCurrentPhase({
        revision: revision({
          steps,
          rules: [rule({ schedule_type_id: 'monthly', day_of_month: 1 })],
        }),
        deliveredCount: 99,
      })
    ).toMatchObject({
      step_id: null,
      dose_amount: null,
      progress_known: false,
    });
  });
  it('detects source material fields but allows dose/note/end/reminder corrections', () => {
    const before = plan(),
      after = plan();
    after.target_dose = '99';
    after.name = 'Correction';
    after.end_date = '2026-12-01';
    after.steps = after.steps.map((s) => ({ ...s, dose: '50' }));
    expect(courseMaterialChanges(before, after)).toEqual([]);
    after.rules = [rule({ schedule_type_id: 'weekly', days_of_week: [1] })];
    after.dose_basis = 'per_week';
    after.start_date = '2026-03-02';
    after.steps[0]!.duration_days = 28;
    expect(courseMaterialChanges(before, after)).toEqual([
      'schedule',
      'dose_basis',
      'start_date',
      'steps',
    ]);
  });
  it('retains source boundary inheritance, strict start and late attributed tracking-day floor', () => {
    const old = revision({
      start_date: '2026-03-01',
      end_date: '2026-04-01',
      rules: [rule({ schedule_type_id: 'cyclic' })],
    });
    expect(
      courseRevisionBoundary({
        predecessor: old,
        newStart: '2026-03-10',
        replacementEnd: null,
        lastDeliveredDay: '2026-03-15',
      })
    ).toEqual({
      predecessor_end_date: '2026-03-15',
      successor_end_date: '2026-04-01',
      cycle_anchor_date: null,
    });
    expect(() =>
      courseRevisionBoundary({
        predecessor: old,
        newStart: '2026-03-01',
        lastDeliveredDay: null,
      })
    ).toThrow();
    expect(() =>
      courseRevisionBoundary({
        predecessor: old,
        newStart: '2026-04-01',
        replacementEnd: null,
        lastDeliveredDay: null,
      })
    ).toThrow();
    expect(
      courseRevisionBoundary({
        predecessor: old,
        newStart: '2026-03-02',
        replacementEnd: '2026-05-01',
        lastDeliveredDay: null,
      }).predecessor_end_date
    ).toBe('2026-03-01');
  });
});

describe('source lifecycle and instant history', () => {
  it.each([
    {
      status: 'active' as const,
      start_date: '2026-03-29',
      end_date: '2026-03-29',
      bucket: 'active',
    },
    {
      status: 'active' as const,
      start_date: '2026-03-30',
      end_date: null,
      bucket: 'scheduled',
    },
    {
      status: 'active' as const,
      start_date: null,
      end_date: '2026-03-28',
      bucket: 'ended',
    },
    {
      status: 'paused' as const,
      start_date: '2026-04-01',
      end_date: '2026-03-01',
      bucket: 'paused',
    },
    {
      status: 'completed' as const,
      start_date: '2026-04-01',
      end_date: null,
      bucket: 'completed',
    },
  ])('uses five-bucket priority $bucket', ({ bucket, ...row }) =>
    expect(courseBucket(row, '2026-03-29')).toBe(bucket)
  );
  it('never extends an already ended course on complete or reopen', () => {
    expect(
      courseEndOnComplete({
        wasStatus: 'active',
        nowStatus: 'completed',
        currentEndDate: '2026-03-01',
        today: '2026-03-29',
      })
    ).toBeNull();
    expect(
      courseEndOnComplete({
        wasStatus: 'active',
        nowStatus: 'completed',
        currentEndDate: null,
        today: '2026-03-29',
      })
    ).toBe('2026-03-29');
    expect(
      courseBucket(
        revision({ status: 'active', end_date: '2026-03-01' }),
        '2026-03-29'
      )
    ).toBe('ended');
  });
  it('retains half-open same-day pause/resume intervals and permits zero-closing a future activation', () => {
    const activity = revision().activity;
    activity[0]!.until_at = '2026-03-29T10:00:00Z';
    expect(courseActivityContains(activity, '2026-03-29T09:59:59Z')).toBe(true);
    expect(courseActivityContains(activity, '2026-03-29T10:00:00Z')).toBe(
      false
    );
    expect(
      courseActivityTransition({
        activity,
        nextStatus: 'active',
        at: '2026-03-29T12:00:00Z',
      })
    ).toMatchObject({ open_from_at: '2026-03-29T12:00:00Z' });
    const future = [
      { ...activity[0]!, from_at: '2026-04-01T00:00:00Z', until_at: null },
    ];
    expect(
      courseActivityTransition({
        activity: future,
        nextStatus: 'paused',
        at: '2026-03-29T12:00:00Z',
      }).close_at
    ).toEqual({ activity: '2026-04-01T00:00:00Z' });
  });
  it('does not resurrect an earlier revision after deleting the current tip', () => {
    const c = course({
      current_revision_id: null,
      revisions: [
        revision(),
        revision({
          id: 'new',
          predecessor_id: 'rev',
          revision_no: 2,
          deleted_at: '2026-03-20T00:00:00Z',
        }),
      ],
    });
    expect(isCurrentCourseTip(c, 'rev')).toBe(false);
    expect(isCurrentCourseTip(c, 'new')).toBe(false);
  });
});

describe('managed expected slots reuse the calendar engine', () => {
  it('resolves owner timezone across DST and respects inclusive rule endpoints', () => {
    const c = course({
      revisions: [revision({ rules: [rule({ end_date: '2026-03-29' })] })],
    });
    expect(slots(c, '2026-03-28')[0]?.scheduled_for).toBe(
      '2026-03-28T09:00:00.000Z'
    );
    expect(slots(c, '2026-03-29')[0]?.scheduled_for).toBe(
      '2026-03-29T08:00:00.000Z'
    );
    expect(slots(c, '2026-03-30')).toEqual([]);
  });
  it('clips capture instant, keeping prior history unavailable rather than fabricating misses', () => {
    const c = course({
      captured_at: '2026-03-29T08:30:00Z',
      capture_day: '2026-03-29',
      revisions: [
        revision({
          rules: [
            rule(),
            rule({ id: 'afternoon', rule_index: 1, time_of_day: '15:00' }),
          ],
        }),
      ],
    });
    expect(slots(c, '2026-03-28')).toEqual([]);
    expect(slots(c, '2026-03-29').map((slot) => slot.course_rule_id)).toEqual([
      'afternoon',
    ]);
    const report = computeCourseAdherence({
      course: c,
      entries: [],
      fromDay: '2026-03-28',
      toDay: '2026-03-29',
      today: '2026-03-29',
      now: '2026-03-29T16:00:00Z',
      medicationActive: true,
    });
    expect(report.days.map((day) => day.coverage)).toEqual([
      'unavailable',
      'partial',
    ]);
    expect(report.missed).toBe(0);
  });
  it('preserves earlier same-day paused history and uses master activity only today/future', () => {
    const c = course({
      revisions: [
        revision({
          status: 'paused',
          activity: [
            { ...revision().activity[0]!, until_at: '2026-03-29T10:00:00Z' },
          ],
          rules: [
            rule(),
            rule({ id: 'later', rule_index: 1, time_of_day: '15:00' }),
          ],
        }),
      ],
    });
    expect(slots(c, '2026-03-29').map((slot) => slot.course_rule_id)).toEqual([
      'rule',
    ]);
    expect(slots(c, '2026-03-28', false)).toHaveLength(2);
    expect(
      slots(c, '2026-03-29', false).map((slot) => slot.course_rule_id)
    ).toEqual(['rule']);
  });
  it('keeps future handoff continuity but cuts all predecessor slots at successor start despite late old actuals', () => {
    const old = revision({
      status: 'completed',
      end_date: '2026-04-05',
      closed_date: '2026-04-05',
      activity: [
        { ...revision().activity[0]!, until_at: '2026-04-01T23:00:00Z' },
      ],
    });
    const next = revision({
      id: 'next',
      predecessor_id: 'rev',
      revision_no: 2,
      start_date: '2026-04-02',
      activity: [
        {
          ...revision().activity[0]!,
          id: 'nextactivity',
          revision_id: 'next',
          from_at: '2026-04-01T23:00:00Z',
        },
      ],
      rules: [rule({ id: 'nextrule', revision_id: 'next' })],
    });
    const c = course({ current_revision_id: 'next', revisions: [old, next] });
    expect(slots(c, '2026-03-29')[0]?.course_revision_id).toBe('rev');
    expect(
      slots(c, '2026-04-02').map((slot) => slot.course_revision_id)
    ).toEqual(['next']);
    next.deleted_at = '2026-04-03T00:00:00Z';
    c.current_revision_id = null;
    expect(slots(c, '2026-04-04')).toEqual([]);
  });
  it('retains original cyclic anchor and monthly last-day fallback without another recurrence engine', () => {
    const c = course({
      revisions: [
        revision({
          start_date: '2026-03-04',
          cycle_anchor_date: '2026-03-01',
          rules: [
            rule({
              schedule_type_id: 'cyclic',
              cycle_on_days: 2,
              cycle_off_days: 2,
            }),
          ],
        }),
      ],
    });
    expect(slots(c, '2026-03-04')).toEqual([]);
    expect(slots(c, '2026-03-05')).toHaveLength(1);
    expect(
      slots(
        course({
          revisions: [
            revision({
              start_date: '2026-02-01',
              rules: [rule({ schedule_type_id: 'monthly', day_of_month: 31 })],
              activity: [
                { ...revision().activity[0]!, from_at: '2026-02-01T00:00:00Z' },
              ],
            }),
          ],
          captured_at: '2026-02-01T00:00:00Z',
          capture_day: '2026-02-01',
        }),
        '2026-02-28'
      )
    ).toHaveLength(1);
  });
  it('keeps untimed slots genuinely untimed and stable identities independent of phase', () => {
    const c = course({
      captured_at: '2026-03-29T12:00:00Z',
      capture_day: '2026-03-29',
      revisions: [revision({ rules: [rule({ time_of_day: null })] })],
    });
    expect(slots(c, '2026-03-29')[0]?.scheduled_for).toBeNull();
    expect(courseSlotKey('rev', 'rule', '2026-03-29', '09:00')).toBe(
      courseSlotKey('rev', 'rule', '2026-03-29', '09:00:00')
    );
    const due = courseDueDosesForDay({
      courses: [course()],
      medications: [{ id: 'med', is_active: true }],
      day: '2026-03-29',
      today: '2026-03-29',
      nowInstant: '2026-03-29T12:00:00Z',
      delivered: [],
    });
    expect(due[0]?.schedule.schedule_type_id).toBe('daily');
    expect(due[0]?.schedule.per_dose_amount).toBe('1');
  });
  it('ends selected legacy rules at min(existing end,cutover minus one) without deactivating history', () => {
    expect(courseHandoffEndDay('2026-03-05', '2026-03-10')).toBe('2026-03-05');
    expect(courseHandoffEndDay(null, '2026-03-10')).toBe('2026-03-09');
  });
});

describe('managed attribution and source adherence denominator', () => {
  it('excludes legacy/mismatched revision/rule/key/day matches and ignores phase in slot identity', () => {
    const slot = slots(course(), '2026-03-02')[0]!,
      entry = delivered(slot);
    expect(
      courseEntryMatchesSlot(
        { ...entry, course_step_id: 'different' } as CourseDeliveredDose,
        slot
      )
    ).toBe(true);
    for (const patch of [
      { course_revision_id: null },
      { course_revision_id: 'other' },
      { course_rule_id: 'other' },
      { course_slot_key: 'other' },
      { scheduled_day: '2026-03-03' },
    ])
      expect(courseEntryMatchesSlot({ ...entry, ...patch }, slot)).toBe(false);
  });
  it('uses taken/(taken+missed), excluding skipped and pending including the final slot', () => {
    const c = course(),
      a = slots(c, '2026-03-01')[0]!,
      skip = slots(c, '2026-03-03')[0]!;
    const result = computeCourseAdherence({
      course: c,
      entries: [delivered(a), delivered(skip, 'skip', 'skipped')],
      fromDay: '2026-03-01',
      toDay: '2026-03-04',
      today: '2026-03-04',
      now: '2026-03-04T12:00:00Z',
      medicationActive: true,
    });
    expect(result).toMatchObject({
      taken: 1,
      missed: 1,
      skipped: 1,
      pending: 1,
      pct: 50,
    });
    const historical = computeCourseAdherence({
      course: c,
      entries: [],
      fromDay: '2026-03-01',
      toDay: '2026-03-01',
      today: '2026-03-04',
      now: '2026-03-04T12:00:00Z',
      medicationActive: true,
    });
    expect(historical.missed).toBe(1);
  });
  it('never credits one actual twice across multiple slots or a new revision', () => {
    const c = course({
        revisions: [
          revision({
            rules: [
              rule(),
              rule({ id: 'other', rule_index: 1, time_of_day: '15:00' }),
            ],
          }),
        ],
      }),
      day = '2026-03-02',
      due = slots(c, day);
    const entries = due.map((slot) => delivered(slot, 'same-actual-id'));
    const report = computeCourseAdherence({
      course: c,
      entries,
      fromDay: day,
      toDay: day,
      today: day,
      now: '2026-03-02T20:00:00Z',
      medicationActive: true,
    });
    expect(report.taken).toBe(1);
    expect(
      courseEntryMatchesSlot(
        { ...entries[0]!, course_revision_id: 'old-revision' },
        due[1]!
      )
    ).toBe(false);
  });
});

it('keeps earlier timed Today history when medication becomes inactive, suppressing only now/future', () => {
  const c = course({
    revisions: [
      revision({
        rules: [
          rule({ time_of_day: '09:00' }),
          rule({ id: 'at-now', rule_index: 1, time_of_day: '13:00' }),
          rule({ id: 'later', rule_index: 2, time_of_day: '15:00' }),
        ],
        activity: [
          { ...revision().activity[0]!, until_at: '2026-03-29T12:00:00Z' },
        ],
      }),
    ],
  });
  expect(
    courseSlotsForDay({
      course: c,
      day: '2026-03-29',
      today: '2026-03-29',
      nowInstant: '2026-03-29T12:00:00Z',
      medicationActive: false,
    }).map((s) => s.course_rule_id)
  ).toEqual(['rule']);
  expect(
    courseSlotsForDay({
      course: c,
      day: '2026-03-28',
      today: '2026-03-29',
      nowInstant: '2026-03-29T12:00:00Z',
      medicationActive: false,
    })
  ).toHaveLength(3);
  expect(
    courseSlotsForDay({
      course: course({ revisions: [revision({ activity: [] })] }),
      day: '2026-03-29',
      today: '2026-03-29',
      nowInstant: '2026-03-29T12:00:00Z',
      medicationActive: false,
    })
  ).toEqual([]);
});
it('keeps explicit seconds, original cycle anchor and authored same-time rule order', () => {
  const c = course({
    revisions: [
      revision({
        rules: [
          rule({ id: 'z', rule_index: 0, time_of_day: '09:00:30' }),
          rule({ id: 'a', rule_index: 1, time_of_day: '09:00:30' }),
        ],
      }),
    ],
  });
  const due = slots(c, '2026-03-29');
  expect(due[0]?.scheduled_for).toBe('2026-03-29T08:00:30.000Z');
  expect(due.map((s) => s.course_rule_id)).toEqual(['z', 'a']);
  expect(due[0]?.course_slot_key).not.toBe(due[1]?.course_slot_key);
  const cyc = course({
    revisions: [
      revision({
        start_date: '2026-03-04',
        cycle_anchor_date: '2026-03-01',
        rules: [
          rule({
            schedule_type_id: 'cyclic',
            cycle_on_days: 2,
            cycle_off_days: 2,
            anchor_date: '2026-03-04',
          }),
        ],
      }),
    ],
  });
  expect(slots(cyc, '2026-03-04')).toEqual([]);
});
it('shows authored expected phase before its own delivered dose, without forecasting the next phase', () => {
  const rev = revision({
      steps: steps.map((step) => ({
        ...step,
        duration_days: step.step_index === 0 ? 1 : null,
      })),
    }),
    c = course({ revisions: [rev] });
  const first = slots(c, '2026-03-01', true, [])[0]!,
    entry = delivered(first);
  expect(slots(c, '2026-03-01', true, [entry])[0]?.course_step_id).toBe(
    'step0'
  );
  expect(slots(c, '2026-03-02', true, [entry])[0]?.course_step_id).toBe(
    'step1'
  );
  expect(slots(c, '2026-03-20', true, [])[0]?.course_step_id).toBe('step0');
  expect(slots(c, '2026-03-20')[0]).toMatchObject({
    phase_progress_known: false,
    per_dose_amount: null,
  });
});
it('canonicalises carried authored dose values and never reuses predecessor step IDs', () => {
  const carried = coursePhaseCarry({
    steps: [{ ...steps[0]!, dose: '01.000000000000000001' }],
    oldInjectionsPerWeek: null,
    deliveredDayKeys: [],
    today: '2026-03-20',
  });
  expect(carried.steps[0]?.dose).toBe('1.000000000000000001');
  expect(carried.steps[0]).not.toHaveProperty('id');
  expect(carried.steps[0]).not.toHaveProperty('revision_id');
});
it('accepts a backdated successor after baseline but never gives predecessor actuals credit for successor slots', () => {
  const old = revision({
      status: 'completed',
      end_date: '2026-03-08',
      closed_date: '2026-03-08',
    }),
    next = revision({
      id: 'next',
      predecessor_id: 'rev',
      revision_no: 2,
      start_date: '2026-03-03',
      rules: [rule({ id: 'next-rule', revision_id: 'next' })],
      activity: [
        {
          ...revision().activity[0]!,
          id: 'next-active',
          revision_id: 'next',
          from_at: '2026-03-03T00:00:00Z',
        },
      ],
    });
  const c = course({ current_revision_id: 'next', revisions: [old, next] }),
    oldSlot = slots(course(), '2026-03-04')[0]!;
  expect(slots(c, '2026-03-04').map((slot) => slot.course_revision_id)).toEqual(
    ['next']
  );
  const result = computeCourseAdherence({
    course: c,
    entries: [delivered(oldSlot)],
    fromDay: '2026-03-04',
    toDay: '2026-03-04',
    today: '2026-03-10',
    now: '2026-03-10T12:00:00Z',
    medicationActive: true,
  });
  expect(result.taken).toBe(0);
  expect(result.missed).toBe(1);
});
it('keeps the final finite-course slot pending without inventing a post-end deadline', () => {
  const c = course({
    revisions: [
      revision({
        status: 'completed',
        end_date: '2026-03-01',
        closed_date: '2026-03-01',
        activity: [
          { ...revision().activity[0]!, until_at: '2026-03-01T12:00:00Z' },
        ],
      }),
    ],
  });
  const result = computeCourseAdherence({
    course: c,
    entries: [],
    fromDay: '2026-03-01',
    toDay: '2026-03-10',
    today: '2026-03-10',
    now: '2026-03-10T12:00:00Z',
    medicationActive: true,
  });
  expect(result).toMatchObject({ taken: 0, missed: 0, pending: 1, pct: null });
});

it('treats authored dose times and actual cyclic recurrence as material, not reminder-only preferences', () => {
  const before = plan(),
    after = plan();
  after.rules[0]!.time_of_day = '15:00';
  expect(courseMaterialChanges(before, after)).toEqual(['schedule']);
  after.rules[0]!.time_of_day = '09:00:00';
  expect(courseMaterialChanges(before, after)).toEqual([]);
  before.rules = [
    rule({ schedule_type_id: 'cyclic', cycle_on_days: 2, cycle_off_days: 2 }),
  ];
  after.rules = [
    rule({ schedule_type_id: 'cyclic', cycle_on_days: 3, cycle_off_days: 2 }),
  ];
  expect(courseMaterialChanges(before, after)).toEqual(['schedule']);
});

it('treats cycle anchor changes as material only when they change effective recurrence', () => {
  const before = plan(),
    after = plan();
  after.cycle_anchor_date = '2026-03-02';
  expect(courseMaterialChanges(before, after)).toEqual([]);
  before.rules = [
    rule({ schedule_type_id: 'cyclic', cycle_on_days: 2, cycle_off_days: 2 }),
  ];
  after.rules = [
    rule({ schedule_type_id: 'cyclic', cycle_on_days: 2, cycle_off_days: 2 }),
  ];
  expect(courseMaterialChanges(before, after)).toEqual(['schedule']);
  before.cycle_anchor_date = '2026-03-01';
  after.cycle_anchor_date = '2026-03-01';
  after.rules[0]!.anchor_date = '2026-03-05';
  expect(courseMaterialChanges(before, after)).toEqual([]);
});

it('ignores internal recurrence anchors for daily rules consistently with material comparison', () => {
  const before = plan(),
    after = plan();
  before.rules = [rule({ anchor_date: '2026-03-05' })];
  after.rules = [rule({ anchor_date: '2026-03-06' })];
  expect(courseMaterialChanges(before, after)).toEqual([]);
  expect(
    slots(
      course({
        revisions: [revision({ rules: [rule({ anchor_date: '2026-03-05' })] })],
      }),
      '2026-03-02'
    )
  ).toHaveLength(1);
});
it('keeps rule override amounts in revision units rather than relabelling them with phase units', () => {
  const rev = revision({
      dose_unit: 'mg',
      steps: [
        { ...steps[0]!, dose: '1000', dose_unit: 'mcg', duration_days: null },
      ],
      rules: [rule({ dose_amount: '1' })],
    }),
    c = course({ revisions: [rev] });
  expect(slots(c, '2026-03-02', true, [])[0]).toMatchObject({
    authored_dose: '1',
    per_dose_amount: '1',
    dose_unit: 'mg',
  });
  rev.rules[0]!.dose_amount = null;
  expect(slots(c, '2026-03-02', true, [])[0]).toMatchObject({
    authored_dose: '1000',
    per_dose_amount: '1000',
    dose_unit: 'mcg',
  });
});

it('keeps nondeleted predecessor history after deleting the current tip without promoting it', () => {
  const old = revision({
    status: 'completed',
    end_date: '2026-03-05',
    closed_date: '2026-03-05',
    activity: [
      { ...revision().activity[0]!, until_at: '2026-03-05T12:00:00Z' },
    ],
  });
  const tombstone = revision({
    id: 'deleted-tip',
    predecessor_id: 'rev',
    revision_no: 2,
    start_date: '2026-03-03',
    deleted_at: '2026-03-05T12:00:00Z',
    rules: [],
    steps: [],
    activity: [],
  });
  const c = course({
    current_revision_id: null,
    deleted_at: null,
    revisions: [old, tombstone],
  });
  expect(slots(c, '2026-03-01').map((slot) => slot.course_revision_id)).toEqual(
    ['rev']
  );
  expect(slots(c, '2026-03-02').map((slot) => slot.course_revision_id)).toEqual(
    ['rev']
  );
  expect(slots(c, '2026-03-03')).toEqual([]);
  expect(slots(c, '2026-03-29')).toEqual([]);
  expect(isCurrentCourseTip(c, 'rev')).toBe(false);
  expect(isCurrentCourseTip(c, 'deleted-tip')).toBe(false);
  const report = computeCourseAdherence({
    course: c,
    entries: [],
    fromDay: '2026-03-01',
    toDay: '2026-03-05',
    today: '2026-03-29',
    now: '2026-03-29T12:00:00Z',
    medicationActive: true,
  });
  expect(report.days[0]?.slots[0]?.course_revision_id).toBe('rev');
  expect(report.missed).toBe(1);
  expect(report.pending).toBe(1);
});
it('closes future predecessor activity when deleting a future-dated tip while preserving earlier Today slots', () => {
  const old = revision({
    status: 'completed',
    end_date: '2026-03-31',
    closed_date: '2026-03-31',
    rules: [rule(), rule({ id: 'later', rule_index: 1, time_of_day: '15:00' })],
    activity: [
      { ...revision().activity[0]!, until_at: '2026-03-29T12:00:00Z' },
    ],
  });
  const tombstone = revision({
    id: 'future-deleted-tip',
    predecessor_id: 'rev',
    revision_no: 2,
    start_date: '2026-04-01',
    deleted_at: '2026-03-29T12:00:00Z',
    rules: [],
    steps: [],
    activity: [],
  });
  const c = course({
    current_revision_id: null,
    deleted_at: null,
    revisions: [old, tombstone],
  });
  expect(slots(c, '2026-03-28')).toHaveLength(2);
  expect(slots(c, '2026-03-29').map((slot) => slot.course_rule_id)).toEqual([
    'rule',
  ]);
  expect(slots(c, '2026-03-30')).toEqual([]);
  expect(slots(c, '2026-04-01')).toEqual([]);
  expect(isCurrentCourseTip(c, 'rev')).toBe(false);
});

it.each([['2026-03-04'], ['2026-03-04', '2026-03-06']])(
  'preserves authored homogeneous/heterogeneous handoff cyclic anchors through ordinary revision: %j',
  (...anchors: string[]) => {
    const old = revision({
      start_date: '2026-03-17',
      cycle_anchor_date: null,
      rules: anchors.map((anchor, index) =>
        rule({
          id: `old-cycle-${index}`,
          rule_index: index,
          schedule_type_id: 'cyclic',
          cycle_on_days: 2,
          cycle_off_days: 2,
          anchor_date: anchor,
          time_of_day: `${String(9 + index).padStart(2, '0')}:00`,
        })
      ),
    });
    const boundary = courseRevisionBoundary({
      predecessor: old,
      newStart: '2026-03-20',
      lastDeliveredDay: null,
    });
    expect(boundary.cycle_anchor_date).toBeNull();
    const next = revision({
      ...old,
      id: 'next',
      predecessor_id: 'rev',
      revision_no: 2,
      start_date: '2026-03-20',
      cycle_anchor_date: boundary.cycle_anchor_date,
      rules: old.rules.map((r) => ({
        ...r,
        id: r.id.replace('old', 'new'),
        revision_id: 'next',
      })),
    });
    for (const day of [
      '2026-03-20',
      '2026-03-21',
      '2026-03-22',
      '2026-03-23',
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
    ]) {
      expect(
        slots(course({ revisions: [next] }), day).map((s) => s.time_of_day)
      ).toEqual(
        slots(course({ revisions: [old] }), day).map((s) => s.time_of_day)
      );
    }
    const reviewed = { ...next, cycle_anchor_date: '2026-03-21' };
    expect(
      slots(course({ revisions: [reviewed] }), '2026-03-20').map(
        (s) => s.time_of_day
      )
    ).not.toEqual(
      slots(course({ revisions: [next] }), '2026-03-20').map(
        (s) => s.time_of_day
      )
    );
  }
);

it('canonicalises mixed explicit and implicit cyclic origins without positional matching after removing a rule', () => {
  const old = revision({
    start_date: '2026-03-17',
    rules: [
      rule({
        id: 'explicit',
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 2,
        anchor_date: '2026-03-04',
      }),
      rule({
        id: 'implicit',
        rule_index: 1,
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 2,
        anchor_date: null,
        start_date: null,
        time_of_day: '15:00',
      }),
    ],
  });
  const request = {
    ...plan(),
    start_date: '2026-03-20',
    cycle_anchor_date: null,
    rules: old.rules,
  };
  const nextPlan = courseCarryCyclicAnchors(old, request);
  expect(nextPlan.cycle_anchor_date).toBeNull();
  expect(nextPlan.rules.map((r) => r.anchor_date)).toEqual([
    '2026-03-04',
    '2026-03-17',
  ]);
  const next = revision({
    ...old,
    id: 'next',
    revision_no: 2,
    predecessor_id: 'rev',
    start_date: nextPlan.start_date,
    cycle_anchor_date: nextPlan.cycle_anchor_date ?? null,
    rules: nextPlan.rules.map((r, i) => ({
      ...r,
      id: `next${i}`,
      revision_id: 'next',
      user_id: 'owner',
      rule_index: i,
    })),
  });
  for (const day of [
    '2026-03-20',
    '2026-03-21',
    '2026-03-22',
    '2026-03-23',
    '2026-03-24',
    '2026-03-25',
    '2026-03-26',
    '2026-03-27',
  ])
    expect(
      slots(course({ revisions: [next] }), day).map((s) => s.time_of_day)
    ).toEqual(
      slots(course({ revisions: [old] }), day).map((s) => s.time_of_day)
    );
  const removed = courseCarryCyclicAnchors(old, {
    ...request,
    rules: [old.rules[1]!],
  });
  expect(removed.rules[0]?.anchor_date).toBe('2026-03-17');
  expect(request.rules[1]?.anchor_date).toBeNull();
});
it('honours explicit reviewed global changes and NULL clearing while preserving authored rule origin changes', () => {
  const old = revision({
    start_date: '2026-03-17',
    cycle_anchor_date: '2026-03-04',
    rules: [
      rule({
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 2,
        anchor_date: '2026-03-06',
      }),
    ],
  });
  const base = { ...plan(), start_date: '2026-03-20', rules: old.rules };
  const changed = courseCarryCyclicAnchors(old, {
    ...base,
    cycle_anchor_date: '2026-03-21',
  });
  expect(changed.cycle_anchor_date).toBe('2026-03-21');
  const cleared = courseCarryCyclicAnchors(old, {
    ...base,
    cycle_anchor_date: null,
  });
  expect(cleared.cycle_anchor_date).toBeNull();
  expect(cleared.rules[0]?.anchor_date).toBe('2026-03-06');
  const noGlobal = revision({ ...old, cycle_anchor_date: null });
  const perRule = courseCarryCyclicAnchors(noGlobal, {
    ...base,
    cycle_anchor_date: null,
    rules: [{ ...old.rules[0]!, anchor_date: '2026-03-10' }],
  });
  expect(perRule.rules[0]?.anchor_date).toBe('2026-03-10');
  expect(
    courseMaterialChanges({ ...base, cycle_anchor_date: '2026-03-04' }, cleared)
  ).toContain('schedule');
});
it('uses authored rule start before the visible source fallback and anchors first-ever cycles at their new start', () => {
  const cyclic = rule({
    schedule_type_id: 'cyclic',
    cycle_on_days: 2,
    cycle_off_days: 2,
    anchor_date: null,
    start_date: '2026-03-07',
  });
  const old = revision({ start_date: '2026-03-17', rules: [cyclic] });
  expect(
    courseCarryCyclicAnchors(old, {
      ...plan(),
      start_date: '2026-03-20',
      rules: [cyclic],
    }).rules[0]?.anchor_date
  ).toBe('2026-03-07');
  expect(
    courseCarryCyclicAnchors(revision(), {
      ...plan(),
      start_date: '2026-03-20',
      rules: [{ ...cyclic, start_date: null }],
    }).rules[0]?.anchor_date
  ).toBe('2026-03-20');
});
it('recognises known frequency when handoff rules cover the whole revision window but rejects partial windows', () => {
  const window = { start_date: '2026-03-17', end_date: '2026-03-31' };
  expect(
    courseInjectionsPerWeek(
      [rule({ start_date: '2026-03-04', end_date: null })],
      window
    )
  ).toBe(7);
  expect(
    courseInjectionsPerWeek(
      [rule({ start_date: '2026-03-04', end_date: '2026-04-30' })],
      window
    )
  ).toBe(7);
  expect(
    courseInjectionsPerWeek(
      [rule({ start_date: '2026-03-18', end_date: null })],
      window
    )
  ).toBeNull();
  expect(
    courseInjectionsPerWeek(
      [rule({ start_date: '2026-03-04', end_date: '2026-03-30' })],
      window
    )
  ).toBeNull();
  const known = revision({
    start_date: '2026-03-17',
    dose_basis: 'per_week',
    target_dose: '7',
    rules: [rule({ start_date: '2026-03-04' })],
  });
  expect(
    courseCurrentPhase({ revision: known, deliveredCount: 0 }).dose_amount
  ).toBe('1');
});
