import { describe, expect, it } from 'vitest';
import {
  buildMedicationLogWeek,
  courseSlotKey,
  medicationLogWeekResponseSchema,
  medicationWeekCellItems,
  medicationWeekOffSchedule,
  medicationWeekStart,
  type MedicationLogWeekInput,
  type MedicationWeekActualFacts,
} from '@workspace/shared';
import {
  medicationCourseFixture,
  courseFixtureIds as ids,
} from './fixtures/medicationCourseFixture.ts';
const uid = (n: number) =>
  '50000000-0000-4000-a000-' + String(n).padStart(12, '0');
const today = '2026-11-17',
  now = today + 'T12:00:00Z';
function input(): MedicationLogWeekInput {
  return {
    as_of: now,
    today,
    timezone: 'Europe/London',
    courses: [medicationCourseFixture()],
    medications: [
      {
        id: ids.medication,
        name: 'Synthetic current name',
        is_active: true,
        is_supplement: false,
        dose_amount: '9',
        dose_unit: 'mg',
      },
    ],
    managed_actuals: [],
    phase_actuals: [],
    legacy_schedules: [],
    actuals: [],
  };
}
function fact(
  patch: Partial<MedicationWeekActualFacts> = {}
): MedicationWeekActualFacts {
  return {
    id: uid(1),
    source_kind: 'entry',
    medication_id: ids.medication,
    medication_name: 'Synthetic recorded name',
    status: 'taken',
    entry_date: today,
    occurred_at: today + 'T09:15:00Z',
    dose_amount: '2.75',
    dose_unit: 'mg',
    dose_mg_exact: null,
    schedule_id: null,
    course_origin: false,
    course_revision_id: null,
    course_rule_id: null,
    course_step_id: null,
    course_slot_key: null,
    scheduled_day: null,
    scheduled_for: null,
    notes: null,
    site: null,
    administration_route: null,
    ...patch,
  };
}
function matched(day = today, patch: Partial<MedicationWeekActualFacts> = {}) {
  return fact({
    course_origin: true,
    course_revision_id: ids.revision,
    course_rule_id: ids.rule,
    course_slot_key: courseSlotKey(ids.revision, ids.rule, day, '08:00:00'),
    scheduled_day: day,
    scheduled_for: day + 'T08:00:00Z',
    ...patch,
  });
}
function attach(i: MedicationLogWeekInput, rows: MedicationWeekActualFacts[]) {
  i.actuals = rows;
  i.managed_actuals = rows;
  i.phase_actuals = rows;
}
const result = (i = input()) =>
  medicationLogWeekResponseSchema.parse(buildMedicationLogWeek(i));
const lane = 'medication:' + ids.medication;
function steps(i: MedicationLogWeekInput, a = '1', b = '2', unit = 'mg') {
  const r = i.courses[0]!.revisions[0]!;
  r.steps = [
    {
      id: uid(10),
      user_id: r.user_id,
      revision_id: r.id,
      step_index: 0,
      dose: a,
      dose_unit: unit,
      duration_days: 7,
    },
    {
      id: uid(11),
      user_id: r.user_id,
      revision_id: r.id,
      step_index: 1,
      dose: b,
      dose_unit: unit,
      duration_days: null,
    },
  ];
  return r;
}
describe('canonical seven-day planned/recorded composition', () => {
  it('uses seven Monday civil labels and rejects a non-Monday query rather than shifting records', () => {
    const r = result();
    expect(r.week_start).toBe('2026-11-16');
    expect(r.days).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(() => result({ ...input(), week_start: today })).toThrow(RangeError);
  });
  it.each(['2026-03-29', '2026-10-25', '2028-02-29', '2027-01-01'])(
    'uses calendar navigation across DST/leap/year boundary %s',
    (day) => {
      const i = input();
      i.today = day;
      i.as_of = day + 'T12:00:00Z';
      i.week_start = medicationWeekStart(day);
      expect(result(i).days).toHaveLength(7);
    }
  );
  it('merges same-day fulfilment once using the actual dose and clock, never the current planned target', () => {
    const i = input();
    attach(i, [matched()]);
    const r = result(i),
      items = medicationWeekCellItems(r, today, lane);
    expect(r.fulfilled_slots).toHaveLength(1);
    expect(r.actuals).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('actual');
    if (items[0]?.kind === 'actual') {
      expect(items[0].actual.dose_amount).toBe('2.75');
      expect(items[0].planned?.dose_amount).toBe('1');
      expect(items[0].actual.occurred_at).toBe(today + 'T09:15:00Z');
      expect(items[0].planned?.time_of_day).toBe('08:00:00');
    }
  });
  it('keeps a missing actual quantity and clock unknown even when its matching plan is configured', () => {
    const i = input();
    attach(i, [
      matched(today, { dose_amount: null, dose_unit: null, occurred_at: null }),
    ]);
    const item = medicationWeekCellItems(result(i), today, lane)[0]!;
    expect(item.kind).toBe('actual');
    expect(item.actual?.dose_amount).toBeNull();
    expect(item.actual?.occurred_at).toBeNull();
  });
  it('handles entry/injection same-UUID collisions across distinct exact twice-daily slots', () => {
    const i = input(),
      r = i.courses[0]!.revisions[0]!;
    r.rules.push({
      ...r.rules[0]!,
      id: uid(2),
      rule_index: 1,
      time_of_day: '20:00:00',
    });
    const a = matched(),
      b = matched(today, {
        source_kind: 'injection',
        course_rule_id: uid(2),
        course_slot_key: courseSlotKey(ids.revision, uid(2), today, '20:00:00'),
        scheduled_for: today + 'T20:00:00Z',
        occurred_at: today + 'T20:30:00Z',
        dose_amount: '0.5',
      });
    attach(i, [a, b]);
    const out = result(i);
    expect(out.actuals.map((a) => a.key)).toEqual([
      'entry:' + a.id,
      'injection:' + a.id,
    ]);
    expect(out.fulfilled_slots).toHaveLength(2);
    expect(
      medicationWeekCellItems(out, today, lane).filter(
        (v) => v.kind === 'actual'
      )
    ).toHaveLength(2);
  });
  it('deduplicates repeated projections of one actual identity without double display or credit', () => {
    const i = input(),
      a = matched();
    attach(i, [a, a]);
    const out = result(i);
    expect(out.actuals).toHaveLength(1);
    expect(out.fulfilled_slots).toHaveLength(1);
  });
  it('does not infer a match from medication/day and retains orphan snapshots and known zero', () => {
    const i = input(),
      a = fact({ dose_amount: '0', dose_unit: 'tablet', occurred_at: null }),
      orphan = fact({
        id: uid(3),
        medication_id: null,
        medication_name: null,
        occurred_at: null,
      });
    attach(i, [a, orphan]);
    const out = result(i);
    expect(out.fulfilled_slots).toEqual([]);
    expect(out.actuals[0]?.dose_amount).toBe('0');
    expect(
      out.lanes.find((l) => l.id === 'orphan:entry:' + orphan.id)?.name
    ).toBe('');
    expect(out.actuals.some((a) => a.status === 'taken')).toBe(true);
  });
  it('keeps cross-day actual glyphs on the stored date with a readonly planned reference', () => {
    const i = input();
    attach(i, [
      matched(today, {
        entry_date: '2026-11-18',
        occurred_at: '2026-11-18T09:00:00Z',
      }),
    ]);
    const out = result(i);
    expect(
      medicationWeekCellItems(out, today, lane).map((e) => e.kind)
    ).toEqual(['fulfilled_reference']);
    expect(out.actuals[0]?.entry_date).toBe('2026-11-18');
    expect(
      medicationWeekCellItems(out, '2026-11-18', lane).filter(
        (e) => e.kind === 'actual'
      )
    ).toHaveLength(1);
  });
  it('explains an outside-week exact fulfilment without adding an outside actual glyph', () => {
    const i = input();
    attach(i, [
      matched(today, {
        entry_date: '2026-11-23',
        occurred_at: '2026-11-23T09:00:00Z',
      }),
    ]);
    const out = result(i);
    expect(out.actuals).toEqual([]);
    expect(out.fulfilled_slots[0]?.actual.entry_date).toBe('2026-11-23');
    expect(medicationWeekCellItems(out, today, lane)[0]?.kind).toBe(
      'fulfilled_reference'
    );
  });
  it('keeps historical deleted-medication plan and orphan actual lanes distinct without moving either identity', () => {
    const i = input();
    i.courses[0]!.medication_id = null;
    i.medications = [];
    const a = matched('2026-11-16', {
      medication_id: null,
      entry_date: '2026-11-16',
      occurred_at: null,
    });
    attach(i, [a]);
    const out = result(i),
      courseLane = 'course:' + ids.course;
    expect(
      out.planned_slots.find((p) => p.scheduled_day === '2026-11-16')?.lane_id
    ).toBe(courseLane);
    expect(out.actuals[0]?.lane_id).toBe('orphan:entry:' + a.id);
    expect(
      medicationWeekCellItems(out, '2026-11-16', courseLane)[0]?.kind
    ).toBe('fulfilled_reference');
    expect(
      medicationWeekCellItems(out, '2026-11-16', 'orphan:entry:' + a.id)[0]
        ?.kind
    ).toBe('actual');
  });
  it('retains native actual volume and excludes unrelated physical editor internals from the summary', () => {
    const i = input();
    const full = {
      ...matched(today, {
        source_kind: 'injection',
        dose_amount: '0.1250001',
        dose_unit: 'ml',
        dose_mg_exact: null,
        site: 'Synthetic site',
      }),
      volume_ml: '0.1250001',
      pen_id: uid(90),
      syringe_id: uid(91),
      dose_input_unit: 'units',
    };
    attach(i, [full]);
    const a = result(i).actuals[0]!;
    expect(a.dose_amount).toBe('0.1250001');
    expect(a.dose_unit).toBe('ml');
    expect(a.dose_mg_exact).toBeNull();
    expect(a).not.toHaveProperty('pen_id');
    expect(a).not.toHaveProperty('volume_ml');
  });
  it('uses canonical skip precedence and keeps snoozed records visible without administration credit', () => {
    const i = input();
    attach(i, [
      matched(today, { status: 'snoozed' }),
      matched(today, { id: uid(4), status: 'skipped' }),
    ]);
    const out = result(i);
    expect(out.actuals).toHaveLength(2);
    expect(out.fulfilled_slots).toHaveLength(1);
    expect(out.fulfilled_slots[0]?.actual.status).toBe('skipped');
    expect(
      out.planned_slots.find((p) => p.scheduled_day === today)?.status
    ).toBe('skipped');
  });
  it('reports capture partial/unavailable days without inferring pre-capture misses', () => {
    const i = input();
    i.courses[0]!.captured_at = today + 'T10:00:00Z';
    const out = result(i);
    expect(out.coverage.slice(0, 3).map((c) => c.coverage)).toEqual([
      'unavailable',
      'partial',
      'available',
    ]);
    expect(
      out.planned_slots.some((p) => p.scheduled_day === '2026-11-16')
    ).toBe(false);
    expect(out.planned_slots.some((p) => p.scheduled_day === today)).toBe(
      false
    );
  });
  it('returns a remote pre-capture week immediately as unavailable but still retains recorded actuals', () => {
    const i = input();
    i.week_start = '0100-01-04';
    i.actuals = [fact({ entry_date: '0100-01-04', occurred_at: null })];
    const out = result(i);
    expect(out.planned_slots).toEqual([]);
    expect(out.coverage).toHaveLength(7);
    expect(out.coverage.every((c) => c.coverage === 'unavailable')).toBe(true);
    expect(out.actuals[0]?.entry_date).toBe('0100-01-04');
  });
  it('generates a future-only week from its seven known intent dates without advancing phases', () => {
    const i = input();
    i.week_start = '2030-01-07';
    const out = result(i);
    expect(out.planned_slots).toHaveLength(7);
    expect(
      out.planned_slots.every(
        (p) => p.status === 'planned' && p.dose_amount === '1'
      )
    ).toBe(true);
  });
  it('honours paused/current-inactive activity boundaries without hiding separately recorded actuals', () => {
    const i = input(),
      r = i.courses[0]!.revisions[0]!;
    r.status = 'paused';
    r.activity[0]!.until_at = today + 'T09:00:00Z';
    attach(i, [fact({ entry_date: '2026-11-20' })]);
    let out = result(i);
    expect(out.planned_slots.every((p) => p.scheduled_day <= today)).toBe(true);
    expect(out.actuals[0]?.entry_date).toBe('2026-11-20');
    r.status = 'active';
    r.activity[0]!.until_at = null;
    i.medications[0]!.is_active = false;
    out = result(i);
    expect(out.planned_slots.some((p) => p.scheduled_day === today)).toBe(true);
    expect(out.planned_slots.some((p) => p.scheduled_day > today)).toBe(false);
  });
  it('keeps successor cutoff/tombstones and refuses cross-revision actual credit', () => {
    const i = input(),
      c = i.courses[0]!,
      old = c.revisions[0]!,
      next = structuredClone(old);
    old.status = 'completed';
    old.end_date = '2026-11-30';
    old.activity[0]!.until_at = '2026-11-18T00:00:00Z';
    Object.assign(next, {
      id: uid(30),
      predecessor_id: old.id,
      revision_no: 2,
      start_date: '2026-11-18',
    });
    next.rules[0]!.id = uid(31);
    next.activity[0]!.from_at = '2026-11-18T00:00:00Z';
    c.revisions.push(next);
    c.current_revision_id = next.id;
    attach(i, [matched('2026-11-19', { entry_date: '2026-11-19' })]);
    let out = result(i);
    expect(
      out.planned_slots
        .filter((p) => p.course_revision_id === old.id)
        .every((p) => p.scheduled_day < '2026-11-18')
    ).toBe(true);
    expect(out.fulfilled_slots).toEqual([]);
    expect(out.actuals).toHaveLength(1);
    next.deleted_at = now;
    c.current_revision_id = null;
    out = result(i);
    expect(out.planned_slots.every((p) => p.scheduled_day < '2026-11-18')).toBe(
      true
    );
    expect(out.actuals).toHaveLength(1);
  });
  it('does not let advisory breaks suppress committed rules or include I07 provisional restarts', () => {
    const i = input(),
      r = i.courses[0]!.revisions[0]!;
    Object.assign(r, {
      course_cycle_on_weeks: 1,
      course_cycle_off_weeks: 1,
      course_cycle_anchor_date: '2026-11-09',
    });
    expect(result(i).planned_slots).toHaveLength(7);
    Object.assign(r, {
      course_cycle_anchor_date: '2026-11-01',
      end_date: '2026-11-07',
    });
    expect(result(i).planned_slots).toEqual([]);
  });
  it('qualifies varying future phase amounts rather than advancing a projected phase cursor', () => {
    const i = input();
    steps(i);
    const before = structuredClone(i.courses),
      out = result(i);
    expect(
      out.planned_slots.find((p) => p.scheduled_day === '2026-11-16')
        ?.dose_amount
    ).toBe('1');
    expect(
      out.planned_slots
        .filter((p) => p.scheduled_day > today)
        .every(
          (p) =>
            p.dose_amount === null &&
            p.dose_qualification === 'future_phase_unknown' &&
            p.course_step_id === null
        )
    ).toBe(true);
    expect(
      out.planned_slots.find((p) => p.scheduled_day === '2026-11-18')
        ?.time_of_day
    ).toBe('08:00:00');
    expect(i.courses).toEqual(before);
  });
  it('preserves fixed identical/terminal/rule-override intent while uncertain step identity stays unset', () => {
    const i = input();
    const r = steps(i, '1', '1');
    let out = result(i);
    expect(
      out.planned_slots
        .filter((p) => p.scheduled_day > today)
        .every((p) => p.dose_amount === '1' && p.course_step_id === null)
    ).toBe(true);
    r.steps[1]!.dose = '2';
    r.rules[0]!.dose_amount = '3';
    out = result(i);
    expect(
      out.planned_slots
        .filter((p) => p.scheduled_day > today)
        .every(
          (p) => p.dose_amount === '3' && p.dose_qualification === 'configured'
        )
    ).toBe(true);
    r.rules[0]!.dose_amount = null;
    i.phase_actuals = Array.from({ length: 7 }, (_, n) => ({
      ...matched('2026-11-0' + (n + 1)),
      id: uid(100 + n),
      entry_date: '2026-11-0' + (n + 1),
      phase_family_id: r.id,
      course_revision_id: null,
    }));
    out = result(i);
    expect(
      out.planned_slots
        .filter((p) => p.scheduled_day > today)
        .every(
          (p) => p.dose_amount === '2' && p.course_step_id === r.steps[1]!.id
        )
    ).toBe(true);
    i.phase_actuals.pop();
    expect(
      result(i)
        .planned_slots.filter((p) => p.scheduled_day > today)
        .every((p) => p.dose_amount === null)
    ).toBe(true);
  });
  it('does not label an unknown future phased amount with a unit that can also change', () => {
    const i = input(),
      r = steps(i);
    r.steps[1]!.dose = '500';
    r.steps[1]!.dose_unit = 'mcg';
    const out = result(i);
    expect(
      out.planned_slots
        .filter((p) => p.scheduled_day > today)
        .every(
          (p) =>
            p.dose_amount === null &&
            p.dose_unit === null &&
            p.dose_qualification === 'future_phase_unknown'
        )
    ).toBe(true);
    r.rules[0]!.dose_amount = '3';
    expect(
      result(i)
        .planned_slots.filter((p) => p.scheduled_day > today)
        .every((p) => p.dose_amount === '3' && p.dose_unit === 'mg')
    ).toBe(true);
  });
  it('uses the canonical original weekly frequency, not the number of visible weekly slots', () => {
    const i = input(),
      r = steps(i, '7', '14');
    r.dose_basis = 'per_week';
    r.rules[0]!.schedule_type_id = 'weekly';
    r.rules[0]!.days_of_week = [1, 3];
    r.rules[0]!.dose_amount = '6';
    i.courses[0]!.captured_at = today + 'T00:00:00Z';
    let out = result(i);
    expect(out.planned_slots).toHaveLength(1);
    expect(out.planned_slots[0]?.dose_amount).toBe('3');
    r.rules[0]!.schedule_type_id = 'cyclic';
    r.rules[0]!.cycle_on_days = 2;
    r.rules[0]!.cycle_off_days = 3;
    out = result(i);
    expect(
      out.planned_slots.every(
        (p) => p.dose_amount === null && p.dose_qualification === 'unknown'
      )
    ).toBe(true);
  });
  it('keeps actuals on frozen entry_date and plans in their captured timezone across profile-zone boundaries', () => {
    const i = input();
    i.timezone = 'UTC';
    i.courses[0]!.timezone = 'America/Los_Angeles';
    attach(i, [
      fact({ entry_date: '2026-11-16', occurred_at: '2026-11-17T03:00:00Z' }),
    ]);
    const out = result(i);
    expect(out.actuals[0]?.entry_date).toBe('2026-11-16');
    expect(
      medicationWeekCellItems(out, '2026-11-16', lane).some(
        (e) => e.kind === 'actual'
      )
    ).toBe(true);
    expect(
      out.planned_slots.find((p) => p.scheduled_day === today)?.scheduled_for
    ).toBe('2026-11-17T16:00:00.000Z');
  });
  it('retains untimed current pending intent and places unknown actual clocks last', () => {
    const i = input();
    i.courses[0]!.revisions[0]!.rules[0]!.time_of_day = null;
    attach(i, [
      fact({ id: uid(41), occurred_at: null }),
      fact({ id: uid(42), occurred_at: today + 'T06:00:00Z' }),
    ]);
    const out = result(i);
    expect(
      out.planned_slots.find((p) => p.scheduled_day === today)
    ).toMatchObject({
      status: 'pending',
      scheduled_for: null,
      time_of_day: null,
    });
    const items = medicationWeekCellItems(out, today, lane);
    expect(items[0]?.kind).toBe('actual');
    expect(items[0]?.actual?.occurred_at).toBe(today + 'T06:00:00Z');
  });
});
describe('explicit current legacy intent, never inferred historical expectations', () => {
  function legacy() {
    const i = input();
    i.courses = [];
    i.legacy_schedules = [
      {
        id: uid(50),
        medication_id: ids.medication,
        schedule_type_id: 'daily',
        time_of_day: '08:00',
        start_date: '2026-01-01',
        dose_amount: null,
        active: true,
      },
    ];
    return i;
  }
  it('labels legacy current/future coverage and never creates past misses', () => {
    const out = result(legacy());
    expect(out.planned_slots).toHaveLength(6);
    expect(
      out.planned_slots.every(
        (p) => p.scheduled_day >= today && p.status !== 'missed'
      )
    ).toBe(true);
    expect(out.coverage[0]?.coverage).toBe('unavailable');
    expect(out.coverage[1]?.coverage).toBe('current_schedule_only');
    expect(out.planned_slots[0]?.dose_amount).toBe('9');
  });
  it('matches only an explicit frozen schedule timing, including equivalent ISO instant formats', () => {
    const i = legacy();
    i.actuals = [
      fact({
        schedule_id: uid(50),
        scheduled_for: today + 'T08:00:00+00:00',
        scheduled_day: today,
      }),
    ];
    let out = result(i);
    expect(out.fulfilled_slots).toHaveLength(1);
    expect(
      medicationWeekCellItems(out, today, lane)[0]?.actual?.dose_amount
    ).toBe('2.75');
    i.legacy_schedules[0]!.time_of_day = '20:00';
    out = result(i);
    expect(out.fulfilled_slots).toHaveLength(0);
    i.legacy_schedules[0]!.time_of_day = '08:00';
    i.actuals[0]!.course_origin = true;
    expect(result(i).fulfilled_slots).toHaveLength(0);
  });
  it('uses explicit schedule overrides, qualifies invalid config and never falls back actual snapshots', () => {
    const i = legacy();
    i.legacy_schedules[0]!.dose_amount = '3';
    i.actuals = [fact({ dose_amount: null, dose_unit: null })];
    let out = result(i);
    expect(out.planned_slots[0]?.dose_amount).toBe('3');
    expect(out.actuals[0]?.dose_amount).toBeNull();
    i.legacy_schedules[0]!.dose_amount = '-1';
    out = result(i);
    expect(out.planned_slots[0]?.dose_amount).toBeNull();
    expect(out.planned_slots[0]?.dose_qualification).toBe('unknown');
  });
  it('honours existing schedule creation fallback and avoids any claimed historical legacy expectation', () => {
    const i = legacy();
    i.legacy_schedules[0]!.start_date = null;
    i.legacy_schedules[0]!.created_at = '2026-11-19T14:00:00Z';
    const out = result(i);
    expect(out.planned_slots[0]?.scheduled_day).toBe('2026-11-19');
    expect(out.planned_slots.some((p) => p.scheduled_day < today)).toBe(false);
  });
  it('returns an honest empty response without inferring no active protocols or creating totals', () => {
    const i = legacy();
    i.medications = [];
    i.legacy_schedules = [];
    const out = result(i);
    expect(out.lanes).toEqual([]);
    expect(out.planned_slots).toEqual([]);
    expect(out.actuals).toEqual([]);
    expect(out).not.toHaveProperty('adherence');
  });
});

describe('doses taken off the plan', () => {
  const offSchedule = (rows: MedicationWeekActualFacts[], i = input()) => {
    attach(i, rows);
    const week = result(i);
    return week.actuals.map((actual) => ({
      id: actual.id,
      off: medicationWeekOffSchedule(week, actual),
    }));
  };
  it('leaves a dose counted toward its own day’s planned dose alone', () => {
    expect(offSchedule([matched()])).toEqual([{ id: uid(1), off: null }]);
  });
  it('flags an extra dose where the plan has no slot for it', () => {
    const [row] = offSchedule([fact()]);
    expect(row?.off).toEqual({ credited_to: null });
  });
  it('flags a second dose on a day with one planned dose', () => {
    const rows = offSchedule([
      matched(),
      fact({ id: uid(2), occurred_at: today + 'T20:00:00Z' }),
    ]);
    expect(rows.find((r) => r.id === uid(1))?.off).toBeNull();
    expect(rows.find((r) => r.id === uid(2))?.off).toEqual({
      credited_to: null,
    });
  });
  it('names the planned day a dose taken on another day was counted toward', () => {
    const [row] = offSchedule([
      matched('2026-11-16', {
        entry_date: today,
        occurred_at: today + 'T09:00:00Z',
      }),
    ]);
    expect(row?.off?.credited_to?.scheduled_day).toBe('2026-11-16');
  });
  it('never flags an as-needed or skipped dose', () => {
    expect(
      offSchedule([
        fact({ status: 'prn_taken' }),
        fact({ id: uid(2), status: 'skipped' }),
      ]).map((r) => r.off)
    ).toEqual([null, null]);
  });
  it('has nothing to be off when no dose is planned for that medication that week', () => {
    const i = input();
    i.courses = [];
    expect(offSchedule([fact()], i)).toEqual([{ id: uid(1), off: null }]);
  });
});
