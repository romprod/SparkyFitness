import { describe, expect, it } from 'vitest';
import {
  buildInventoryForecastPlan,
  buildMedicationLogWeek,
  computeCourseAdherence,
  courseSlotKey,
  courseSlotsForDay,
  courseUnlinkedSlotMatches,
  medicationLogWeekResponseSchema,
  type CourseDeliveredDose,
  type MedicationCourse,
  type MedicationCourseRule,
  type MedicationLogWeekInput,
  type MedicationWeekActualFacts,
} from '@workspace/shared';
import {
  medicationCourseFixture,
  courseFixtureIds as ids,
} from './fixtures/medicationCourseFixture.ts';

const tz = 'Europe/London';
const ruleB = '00000000-0000-4000-a000-0000000000b2';
const otherRule = '00000000-0000-4000-a000-0000000000c3';
const otherRevision = '00000000-0000-4000-a000-0000000000d4';
const sunday = '2026-11-22';

function build(rules: Partial<MedicationCourseRule>[]): MedicationCourse {
  const c = medicationCourseFixture();
  const r = c.revisions[0]!;
  r.rules = rules.map((patch, i) => ({
    ...r.rules[0]!,
    id: i === 0 ? ids.rule : ruleB,
    rule_index: i,
    ...patch,
  }));
  return c;
}
const weeklyAt1300 = () =>
  build([
    { schedule_type_id: 'weekly', days_of_week: [0], time_of_day: '13:00:00' },
  ]);
const twice = () =>
  build([{ time_of_day: '08:00:00' }, { time_of_day: '20:00:00' }]);

let n = 0;
const entry = (
  at: string,
  patch: Partial<CourseDeliveredDose> = {}
): CourseDeliveredDose => ({
  id: `entry-${++n}`,
  status: 'taken',
  course_revision_id: ids.revision,
  course_rule_id: null,
  course_slot_key: null,
  scheduled_day: null,
  scheduled_for: null,
  entry_date: at.slice(0, 10),
  occurred_at: at + ':00Z',
  source_kind: 'entry',
  ...patch,
});
const link = (
  rule: string,
  day: string,
  time: string
): Partial<CourseDeliveredDose> => ({
  course_rule_id: rule,
  course_slot_key: courseSlotKey(ids.revision, rule, day, time),
  scheduled_day: day,
  scheduled_for: `${day}T${time.slice(0, 5)}:00.000Z`,
});
function score(
  course: MedicationCourse,
  entries: CourseDeliveredDose[],
  fromDay: string,
  toDay: string,
  now: string
) {
  return computeCourseAdherence({
    course,
    entries,
    fromDay,
    toDay,
    today: now.slice(0, 10),
    now: now + ':00Z',
    medicationActive: true,
  });
}
const slotOn = (r: ReturnType<typeof score>, day: string, i = 0) =>
  r.days.find((d) => d.date === day)!.slots[i]!;

describe('Fix A: an unlinked dose fills the nearest open slot on its own day', () => {
  const c = weeklyAt1300();
  const run = (entries: CourseDeliveredDose[]) =>
    score(c, entries, sunday, sunday, '2026-11-23T10:00');

  it('real case: slot 13:00, revision-only dose at 20:00 counts', () => {
    const e = entry('2026-11-22T20:00');
    const r = run([e]);
    expect(slotOn(r, sunday)).toMatchObject({
      status: 'taken',
      entry_id: e.id,
    });
    expect(r.taken).toBe(1);
    expect(r.pct).toBe(100);
  });
  it('does not cross days', () => {
    expect(slotOn(run([entry('2026-11-23T09:00')]), sunday).status).toBe(
      'missed'
    );
    expect(slotOn(run([entry('2026-11-21T20:00')]), sunday).status).toBe(
      'missed'
    );
  });
  it('requires the same revision', () => {
    const r = run([
      entry('2026-11-22T20:00', { course_revision_id: otherRevision }),
    ]);
    expect(slotOn(r, sunday).status).toBe('missed');
    const none = run([entry('2026-11-22T20:00', { course_revision_id: null })]);
    expect(slotOn(none, sunday).status).toBe('missed');
  });
  it('requires a matching rule when the dose names one', () => {
    expect(
      slotOn(
        run([entry('2026-11-22T20:00', { course_rule_id: otherRule })]),
        sunday
      ).status
    ).toBe('missed');
    expect(
      slotOn(
        run([entry('2026-11-22T20:00', { course_rule_id: ids.rule })]),
        sunday
      ).status
    ).toBe('taken');
  });
  it('ignores prn_taken and snoozed doses', () => {
    expect(
      slotOn(run([entry('2026-11-22T20:00', { status: 'prn_taken' })]), sunday)
        .status
    ).toBe('missed');
    expect(
      slotOn(run([entry('2026-11-22T20:00', { status: 'snoozed' })]), sunday)
        .status
    ).toBe('missed');
  });
  it('a skipped unlinked dose marks the slot skipped', () => {
    const e = entry('2026-11-22T20:00', { status: 'skipped' });
    expect(slotOn(run([e]), sunday)).toMatchObject({
      status: 'skipped',
      entry_id: e.id,
    });
  });
  it('a dose carrying a slot link elsewhere is not eligible', () => {
    const e = entry(
      '2026-11-22T20:00',
      link(ids.rule, '2026-11-29', '13:00:00')
    );
    expect(slotOn(run([e]), sunday).status).toBe('missed');
  });

  describe('two slots in a day', () => {
    const two = twice();
    const day = '2026-11-18';
    const go = (entries: CourseDeliveredDose[]) =>
      score(two, entries, day, day, '2026-11-18T21:00');
    it('exact link on 20:00, unlinked at 19:00 fills 08:00', () => {
      const exact = entry('2026-11-18T20:00', link(ruleB, day, '20:00:00'));
      const loose = entry('2026-11-18T19:00');
      const r = go([exact, loose]);
      expect(slotOn(r, day, 0)).toMatchObject({
        status: 'taken',
        entry_id: loose.id,
      });
      expect(slotOn(r, day, 1)).toMatchObject({
        status: 'taken',
        entry_id: exact.id,
      });
    });
    it('tie at 14:00 goes to the earlier slot', () => {
      const loose = entry('2026-11-18T14:00');
      const r = go([loose]);
      expect(slotOn(r, day, 0)).toMatchObject({
        status: 'taken',
        entry_id: loose.id,
      });
      expect(slotOn(r, day, 1).status).toBe('pending');
    });
    it('one dose fills only one slot; two doses fill both', () => {
      const a = entry('2026-11-18T09:00'),
        b = entry('2026-11-18T19:00');
      expect(go([a]).taken).toBe(1);
      const r = go([a, b]);
      expect(slotOn(r, day, 0).entry_id).toBe(a.id);
      expect(slotOn(r, day, 1).entry_id).toBe(b.id);
    });
  });

  it('helper returns slot key -> entry and skips slots it was not given', () => {
    const slots = courseSlotsForDay({
      course: c,
      day: sunday,
      today: '2026-11-23',
      nowInstant: '2026-11-23T10:00:00Z',
      medicationActive: true,
    });
    const e = entry('2026-11-22T20:00');
    const m = courseUnlinkedSlotMatches({ slots, entries: [e], timezone: tz });
    expect(m.get(slots[0]!.course_slot_key)).toBe(e);
    expect(
      courseUnlinkedSlotMatches({ slots: [], entries: [e], timezone: tz }).size
    ).toBe(0);
  });
});

describe('Fix B: a slot is missed once its day is over', () => {
  const c = weeklyAt1300();
  it('past-day weekly slot with next a week away is missed', () => {
    const r = score(c, [], sunday, sunday, '2026-11-23T00:30');
    expect(slotOn(r, sunday).status).toBe('missed');
  });
  it('same slot before its day ends is pending', () => {
    const r = score(c, [], sunday, sunday, '2026-11-22T23:30');
    expect(slotOn(r, sunday).status).toBe('pending');
  });
  it("today's slot after its time but before day end stays pending", () => {
    const r = score(c, [], sunday, sunday, '2026-11-22T15:00');
    expect(slotOn(r, sunday).status).toBe('pending');
  });
  it('a linked dose for the past slot turns it taken', () => {
    const e = entry('2026-11-24T09:00', link(ids.rule, sunday, '13:00:00'));
    const r = score(c, [e], sunday, sunday, '2026-11-25T09:00');
    expect(slotOn(r, sunday)).toMatchObject({
      status: 'taken',
      entry_id: e.id,
    });
  });
  it('next slot already started still gives missed (existing rule)', () => {
    const daily = medicationCourseFixture();
    const r = score(daily, [], '2026-11-16', '2026-11-16', '2026-11-17T09:00');
    expect(slotOn(r, '2026-11-16').status).toBe('missed');
    const mid = score(
      daily,
      [],
      '2026-11-16',
      '2026-11-16',
      '2026-11-16T12:00'
    );
    expect(slotOn(mid, '2026-11-16').status).toBe('pending');
  });
});

describe('inventory forecast treats an unlinked same-day dose like an exact one', () => {
  const finite = () => {
    const c = medicationCourseFixture();
    c.revisions[0]!.end_date = '2026-11-18';
    return c;
  };
  const plan = (actuals: CourseDeliveredDose[]) =>
    buildInventoryForecastPlan({
      today: '2026-11-16',
      now: '2026-11-16T12:00:00Z',
      timezone: tz,
      medication_active: true,
      route: 'injection',
      courses: [finite()],
      actuals,
      devices: {},
    } as never);
  it('slot reads taken and not future demand, same as exact', () => {
    const day = '2026-11-16';
    const exact = plan([
      entry('2026-11-16T08:00', link(ids.rule, day, '08:00:00')),
    ]);
    const loose = plan([entry('2026-11-16T11:00')]);
    const none = plan([]);
    expect(none.slots[0]?.status).toBe('pending');
    expect(loose.slots.map((s) => [s.day, s.status])).toEqual(
      exact.slots.map((s) => [s.day, s.status])
    );
    // A filled slot no longer counts as demand, exactly or unlinked.
    expect(none.slots.map((s) => s.day)).toContain('2026-11-16');
    expect(loose.slots.map((s) => s.day)).not.toContain('2026-11-16');
    expect(loose.slots.length).toBe(exact.slots.length);
  });
  it('does not reach a different day', () => {
    const out = plan([entry('2026-11-15T11:00')]);
    expect(out.slots.find((s) => s.day === '2026-11-16')?.status).toBe(
      'pending'
    );
  });
});

describe('week view', () => {
  const today = '2026-11-17';
  const week = (rows: MedicationWeekActualFacts[]) => {
    const i: MedicationLogWeekInput = {
      as_of: today + 'T12:00:00Z',
      today,
      timezone: tz,
      courses: [medicationCourseFixture()],
      medications: [
        {
          id: ids.medication,
          name: 'Synthetic',
          is_active: true,
          is_supplement: false,
          dose_amount: '9',
          dose_unit: 'mg',
        },
      ],
      managed_actuals: rows,
      phase_actuals: rows,
      legacy_schedules: [],
      actuals: rows,
    };
    return medicationLogWeekResponseSchema.parse(buildMedicationLogWeek(i));
  };
  const fact = (): MedicationWeekActualFacts => ({
    id: '50000000-0000-4000-a000-000000000001',
    source_kind: 'entry',
    medication_id: ids.medication,
    medication_name: 'Synthetic',
    status: 'taken',
    entry_date: today,
    occurred_at: today + 'T09:15:00Z',
    dose_amount: '1',
    dose_unit: 'mg',
    dose_mg_exact: null,
    schedule_id: null,
    course_origin: false,
    course_revision_id: ids.revision,
    course_rule_id: null,
    course_step_id: null,
    course_slot_key: null,
    scheduled_day: null,
    scheduled_for: null,
    notes: null,
    site: null,
    administration_route: null,
  });
  it('planned slot reads taken and links the unlinked actual', () => {
    const r = week([fact()]);
    const planned = r.planned_slots.find((s) => s.scheduled_day === today)!;
    expect(planned.status).toBe('taken');
    expect(r.fulfilled_slots).toHaveLength(1);
    expect(r.fulfilled_slots[0]!.planned_id).toBe(planned.id);
  });
});
