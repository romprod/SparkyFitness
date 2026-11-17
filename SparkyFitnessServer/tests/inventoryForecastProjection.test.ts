import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildInventoryForecast,
  buildInventoryForecastPlan,
  medicationForecastPlannedCoverageSchema,
  type InventoryForecastInput,
  type MedicationCourse,
  type CourseDeliveredDose,
} from '@workspace/shared';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.ts';
const today = '2026-11-01';
function course(): MedicationCourse {
  const c = medicationCourseFixture(),
    r = c.revisions[0]!;
  Object.assign(r, {
    start_date: today,
    end_date: '2026-11-07',
    course_cycle_on_weeks: 1,
    course_cycle_off_weeks: 2,
    course_cycle_anchor_date: today,
    phase_origin_context: null,
  });
  c.captured_at = today + 'T00:00:00Z';
  c.capture_day = today;
  return c;
}
function input(c = course(), volume = '7'): InventoryForecastInput {
  return {
    plan: {
      forecast_mode: 'planned_cycles',
      today,
      now: today + 'T00:00:00Z',
      timezone: 'Europe/London',
      medication_active: true,
      route: 'injection',
      courses: [c],
      actuals: [],
      devices: {
        [c.revisions[0]!.id]: {
          id: '10000000-0000-4000-a000-000000000001',
          basis: 'preferred',
          device: {
            name: 'Synthetic',
            device_type: 'syringe',
            graduation_type: 'units',
            units_per_ml: 100,
            capacity_ml: '1',
            capacity_units: 100,
            increment: '1',
          },
        },
      },
    },
    containers: [
      {
        id: '10000000-0000-4000-a000-000000000002',
        status: 'in_use',
        remaining_ml: volume,
        concentration_mcg_ml: '1000',
        usable_until: '2028-01-01',
        opened_at: today + 'T00:00:00Z',
        expiry_date: null,
        created_at: today + 'T00:00:00Z',
      },
    ],
    lead_days: 14,
    buffer_days: 3,
  };
}
function result(i = input()) {
  const r = buildInventoryForecast(i);
  medicationForecastPlannedCoverageSchema.parse(r);
  medicationForecastPlannedCoverageSchema.parse(r.prepared_only);
  r.containers.forEach((c) =>
    medicationForecastPlannedCoverageSchema.parse(c.coverage)
  );
  return r;
}
describe('opt-in provisional weekly cycle forecast', () => {
  it('leaves omitted and explicit committed modes byte-equivalent and free of projection metadata', () => {
    const i = input();
    delete i.plan.forecast_mode;
    const a = buildInventoryForecast(i),
      b = buildInventoryForecast({
        ...i,
        plan: { ...i.plan, forecast_mode: 'committed' },
      });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toHaveProperty('projection');
    expect(a).not.toHaveProperty('cycle_assumptions');
    expect(a.status).toBe('covered');
  });
  it('adds only on-window demand and orders against first unserved need rather than last coverage', () => {
    const r = result();
    expect(r.projection).toMatchObject({
      projection_starts_on: '2026-11-22',
      first_unserved_day: '2026-11-22',
      first_unserved_kind: 'projected_restart',
      claim_basis: 'projected_restart',
    });
    expect(r.depletion_date).toBe('2026-11-07');
    expect(r.days_left).toBe(6);
    expect(r.reorder_by).toBe('2026-11-08');
    expect(r.status).toBe('ok');
    const slots = buildInventoryForecastPlan(input().plan).slots;
    expect(
      slots.filter((s) => s.day > '2026-11-07' && s.day < '2026-11-22')
    ).toHaveLength(0);
  });
  it('uses the later failed projected dose after some next-cycle doses were served', () => {
    const r = result(input(course(), '9'));
    expect(r.projection?.first_unserved_day).toBe('2026-11-24');
    expect(r.coverage_through).toBe('2026-11-23');
    expect(r.reorder_by).toBe('2026-11-10');
  });
  it('preserves ordinary committed failure timing before any provisional influence', () => {
    const r = result(input(course(), '1'));
    expect(r.projection).toMatchObject({
      claim_basis: 'committed',
      first_unserved_kind: 'committed',
      first_unserved_day: '2026-11-02',
    });
    expect(r.depletion_date).toBe(today);
    expect(r.reorder_by).toBe(today);
    expect(r.status).toBe('reorder_now');
  });
  it('marks a later committed shortage conditional when provisional consumption influenced stock', () => {
    const i = input(course(), '8'),
      other = medicationCourseFixture();
    other.id = '20000000-0000-4000-a000-000000000001';
    other.current_revision_id = '20000000-0000-4000-a000-000000000002';
    other.revisions[0]!.id = other.current_revision_id;
    Object.assign(other.revisions[0]!, {
      start_date: '2026-11-23',
      end_date: '2026-11-23',
      course_cycle_on_weeks: null,
      course_cycle_off_weeks: null,
      course_cycle_anchor_date: null,
    });
    other.revisions[0]!.rules[0]!.time_of_day = '07:00:00';
    other.revisions[0]!.rules[0]!.id = '20000000-0000-4000-a000-000000000003';
    i.plan.courses.push(other);
    i.plan.devices = {
      ...i.plan.devices,
      [other.current_revision_id]:
        i.plan.devices[i.plan.courses[0]!.current_revision_id!]!,
    };
    const r = result(i);
    expect(r.projection).toMatchObject({
      claim_basis: 'projected_coverage',
      first_unserved_kind: 'committed',
      first_unserved_day: '2026-11-23',
    });
  });
  it.each([
    'missing_end',
    'early_end',
    'late_end',
    'on_only',
    'missing_anchor',
    'paused',
    'completed',
    'inactive',
  ] as const)('does not project ineligible %s plans', (kind) => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    if (kind === 'missing_end') r.end_date = null;
    if (kind === 'early_end') r.end_date = '2026-11-06';
    if (kind === 'late_end') r.end_date = '2026-11-08';
    if (kind === 'on_only') r.course_cycle_off_weeks = null;
    if (kind === 'missing_anchor') r.course_cycle_anchor_date = null;
    if (kind === 'paused' || kind === 'completed') {
      r.status = kind;
      r.activity[0]!.until_at = i.plan.now;
    }
    if (kind === 'inactive') i.plan.medication_active = false;
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots.every((s) => s.demand_kind === 'committed')).toBe(true);
    expect(p.cycle_assumptions).toEqual([]);
  });
  it('retains exact daily interval anchors and reports the first actual scheduled restart slot', () => {
    const i = input();
    i.plan.courses[0]!.revisions[0]!.rules[0]!.schedule_type_id = 'weekly';
    i.plan.courses[0]!.revisions[0]!.rules[0]!.days_of_week = [1];
    const r = result(i);
    expect(r.cycle_assumptions?.[0]?.projection_starts_on).toBe('2026-11-23');
    const interval = input();
    Object.assign(interval.plan.courses[0]!.revisions[0]!.rules[0]!, {
      schedule_type_id: 'every_n_days',
      interval_days: 3,
      anchor_date: '2026-10-31',
    });
    const slots = buildInventoryForecastPlan(interval.plan)
      .slots.filter((s) => s.demand_kind === 'projected_restart')
      .slice(0, 2);
    expect(slots.map((s) => s.day)).toEqual(['2026-11-24', '2026-11-27']);
  });
  it('filters off-window slots before phase progress and retains the original NULL-context frequency', () => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    r.rules[0]!.end_date = '2027-11-01';
    r.steps = [
      {
        id: 'step1',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 7,
      },
      {
        id: 'step2',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: 7,
      },
      {
        id: 'step3',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 2,
        dose: '3',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const p = buildInventoryForecastPlan(i.plan),
      first = p.slots.find((s) => s.demand_kind === 'projected_restart');
    expect(first?.value).toBe('2');
    expect(first?.day).toBe('2026-11-22');
    expect(p.current_targets?.[0]?.value).toBe('1');
    expect(r.phase_origin_context).toBeNull();
  });
  it('does not replay elapsed hypothetical doses or rebase an overdue anchor', () => {
    const i = input();
    i.plan.today = '2026-11-23';
    i.plan.now = '2026-11-23T12:00:00Z';
    const r = i.plan.courses[0]!.revisions[0]!;
    r.steps = [
      {
        id: 'step1',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: 'step2',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]?.day).toBe('2026-11-24');
    expect(p.slots[0]?.value).toBe('1');
    expect(p.cycle_assumptions?.[0]).toMatchObject({
      anchor_date: today,
      next_restart_date: '2026-11-22',
      overdue: true,
    });
    expect(p.slots.some((s) => s.demand_kind === 'committed')).toBe(false);
  });
  it('retains date-only provisional Today without inventing a time or reviving prior committed history', () => {
    const i = input();
    i.plan.today = '2026-11-23';
    i.plan.now = '2026-11-23T00:00:00Z';
    i.plan.courses[0]!.revisions[0]!.rules[0]!.time_of_day = null;
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]?.day).toBe('2026-11-23');
    expect(p.slots[0]?.scheduled_at).toBeNull();
    expect(p.slots[0]?.status).toBe('pending');
    expect(p.slots.some((s) => s.demand_kind === 'committed')).toBe(false);
  });
  it('respects future committed successor ownership without projecting an older revision', () => {
    const i = input(),
      c = i.plan.courses[0]!,
      old = c.revisions[0]!,
      next = structuredClone(old);
    Object.assign(next, {
      id: '30000000-0000-4000-a000-000000000001',
      predecessor_id: old.id,
      revision_no: 2,
      start_date: '2026-11-20',
      end_date: '2026-11-26',
      course_cycle_anchor_date: '2026-11-20',
    });
    next.rules[0]!.id = '30000000-0000-4000-a000-000000000002';
    next.activity[0]!.from_at = '2026-11-20T00:00:00Z';
    c.revisions.push(next);
    c.current_revision_id = next.id;
    old.status = 'completed';
    old.activity[0]!.until_at = '2026-11-20T00:00:00Z';
    i.plan.devices = { ...i.plan.devices, [next.id]: i.plan.devices[old.id]! };
    const p = buildInventoryForecastPlan(i.plan);
    expect(
      p.slots.filter(
        (s) => s.plan_id === old.id && s.demand_kind === 'projected_restart'
      )
    ).toHaveLength(0);
    expect(
      p.slots.filter((s) => s.day === '2026-11-22').map((s) => s.plan_id)
    ).toEqual([next.id]);
  });
  it('retains attempted assumptions with no demand inside finite rule/activity bounds', () => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    r.rules[0]!.end_date = '2026-11-07';
    i.plan.today = '2026-11-08';
    i.plan.now = '2026-11-08T12:00:00Z';
    const r1 = result(i);
    expect(r1.status).toBe('unknown');
    expect(r1.cycle_assumptions).toHaveLength(1);
    expect(r1.cycle_assumptions?.[0]?.projection_starts_on).toBeNull();
    expect(r1.projection?.provisional_slots).toBe(0);
    const finite = input();
    finite.plan.courses[0]!.revisions[0]!.activity[0]!.until_at =
      '2026-11-08T00:00:00Z';
    expect(
      buildInventoryForecastPlan(finite.plan).slots.every(
        (s) => s.demand_kind === 'committed'
      )
    ).toBe(true);
  });
  it('keeps unknown demand and excluded stock suppression while labelling covered projection', () => {
    const unknown = input();
    unknown.plan.limitations = ['unmodelled_legacy_demand'];
    expect(result(unknown).projection?.claim_basis).toBe('unknown');
    const excluded = input();
    excluded.stock_limitations = ['sealed_stock_excluded'];
    expect(result(excluded).status).toBe('unknown');
    expect(result(excluded).prepared_only.projection?.claim_basis).toBe(
      'projected_restart'
    );
    const covered = input(course(), '1000');
    covered.stock_limitations = ['sealed_stock_excluded'];
    const r = result(covered);
    expect(r.status).toBe('covered');
    expect(r.projection?.claim_basis).toBe('projected_coverage');
    expect(r.depletion_date).toBeNull();
  });
  it('uses the same retained aggregate cap after OFF filtering across multiple rules', () => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    r.course_cycle_off_weeks = 1;
    r.rules = Array.from({ length: 8 }, (_, n) => ({
      ...r.rules[0]!,
      id: 'rule' + n,
      rule_index: n,
      time_of_day: String(n + 8).padStart(2, '0') + ':00:00',
    }));
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots).toHaveLength(800);
    expect(p.basis).toBe('slot_cap');
    expect(p.slots.every((s) => s.day <= addDays(today, 365))).toBe(true);
    expect(
      p.slots
        .filter((s) => s.demand_kind === 'projected_restart')
        .every(
          (s) =>
            Math.round((Date.parse(s.day) - Date.parse(today)) / 86400000) %
              14 <
            7
        )
    ).toBe(true);
  });
  it('preserves zero lead/buffer semantics at the first future need', () => {
    const i = input();
    i.lead_days = 0;
    i.buffer_days = 0;
    const r = result(i);
    expect(r.reorder_by).toBe('2026-11-22');
    expect(r.status).toBe('ok');
  });
  it('recomputes family progress dynamically without counting matched future actuals twice', () => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    r.steps = [
      {
        id: 'step1',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: 'step2',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const actual: CourseDeliveredDose = {
      id: 'actual',
      source_kind: 'injection',
      course_revision_id: r.id,
      phase_family_id: r.id,
      entry_date: '2026-10-31',
      status: 'taken',
    };
    i.plan.phase_actuals = [actual];
    expect(buildInventoryForecastPlan(i.plan).slots[0]?.value).toBe('2');
    i.plan.phase_actuals = [];
    expect(buildInventoryForecastPlan(i.plan).slots[0]?.value).toBe('1');
  });
  it('keeps unknown handling dates unknown in every planned coverage scope', () => {
    const i = input();
    i.containers[0]!.usable_until = null;
    const r = result(i);
    expect(r.status).toBe('unknown');
    expect(r.projection?.claim_basis).toBe('unknown');
    expect(r.prepared_only.projection?.first_unserved_day).toBeNull();
    expect(r.containers[0]?.coverage.projection?.claim_basis).toBe('unknown');
  });
  it('credits a logged projected future slot once without replaying it into earlier forecast phases', () => {
    const i = input(),
      r = i.plan.courses[0]!.revisions[0]!;
    r.steps = [
      {
        id: 'a',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: 'b',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: 7,
      },
      {
        id: 'c',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 2,
        dose: '3',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const early: CourseDeliveredDose = {
      id: 'early',
      source_kind: 'injection',
      phase_family_id: r.id,
      course_revision_id: r.id,
      course_rule_id: r.rules[0]!.id,
      course_slot_key: JSON.stringify([
        r.id,
        r.rules[0]!.id,
        '2026-11-22',
        '08:00:00',
      ]),
      scheduled_day: '2026-11-22',
      scheduled_for: '2026-11-22T08:00:00Z',
      entry_date: '2026-10-31',
      occurred_at: '2026-10-31T08:00:00Z',
      status: 'taken',
    };
    i.plan.actuals = [early];
    i.plan.phase_actuals = [early, early];
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]?.value).toBe('1');
    expect(p.slots.some((s) => s.day === '2026-11-22')).toBe(false);
    expect(p.slots.find((s) => s.day === '2026-11-23')?.value).toBe('3');
    expect(p.current_targets?.[0]?.value).toBe('2');
  });
  it('excludes strictly past timed provisional Today but retains an exact as-of slot', () => {
    const i = input();
    i.plan.today = '2026-11-23';
    i.plan.now = '2026-11-23T08:00:00Z';
    let p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]?.day).toBe('2026-11-23');
    expect(p.slots[0]?.status).toBe('pending');
    i.plan.now = '2026-11-23T08:00:01Z';
    p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]?.day).toBe('2026-11-24');
  });
  it('retains untimed provisional Today alongside an exact-as-of timed peer', () => {
    const i = input();
    i.plan.today = '2026-11-23';
    i.plan.now = '2026-11-23T08:00:00Z';
    const r = i.plan.courses[0]!.revisions[0]!;
    r.rules.push({
      ...r.rules[0]!,
      id: 'untimed-peer',
      rule_index: 1,
      time_of_day: null,
    });
    const slots = buildInventoryForecastPlan(i.plan).slots.filter(
      (s) => s.day === '2026-11-23'
    );
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.status === 'pending')).toBe(true);
    expect(slots.some((s) => s.scheduled_at === null)).toBe(true);
  });
  it('reports a horizon-limited long break without stretching the walked coverage prefix', () => {
    const i = input();
    i.plan.courses[0]!.revisions[0]!.course_cycle_off_weeks = 104;
    const r = result(i);
    expect(r.status).toBe('covered');
    expect(r.basis).toBe('horizon');
    expect(r.coverage_through).toBe('2026-11-07');
    expect(r.projection?.provisional_slots).toBe(0);
    expect(r.cycle_assumptions?.[0]?.next_restart_date).toBe('2028-11-05');
    expect(r.depletion_date).toBeNull();
  });
  it('caps provisional demand in the forecast timezone while preserving the authored course calendar', () => {
    const i = input(),
      c = i.plan.courses[0]!,
      r = c.revisions[0]!;
    c.timezone = 'Pacific/Honolulu';
    r.course_cycle_off_weeks = 1;
    r.rules[0]!.time_of_day = '23:00:00';
    const p = buildInventoryForecastPlan(i.plan),
      provisional = p.slots.filter(
        (s) => s.demand_kind === 'projected_restart'
      );
    expect(provisional.length).toBeGreaterThan(0);
    expect(provisional.every((s) => s.day <= addDays(today, 365))).toBe(true);
    expect(p.cycle_assumptions?.[0]).toMatchObject({
      timezone: 'Pacific/Honolulu',
      next_restart_date: '2026-11-15',
      projection_starts_on: '2026-11-16',
    });
  });
  it('retains cross-zone date-only demand and phase advancement but suppresses unprovable dated coverage', () => {
    const i = input(),
      c = i.plan.courses[0]!,
      r = c.revisions[0]!;
    i.plan.today = '2026-11-17';
    i.plan.now = '2026-11-17T01:00:00Z';
    i.plan.timezone = 'UTC';
    c.timezone = 'America/Los_Angeles';
    c.captured_at = '2026-10-26T00:00:00Z';
    Object.assign(r, {
      start_date: '2026-10-26',
      end_date: '2026-11-01',
      course_cycle_anchor_date: '2026-10-26',
    });
    r.activity[0]!.from_at = '2026-10-26T00:00:00Z';
    r.rules[0]!.time_of_day = null;
    r.steps = [
      {
        id: 'a',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: 'b',
        user_id: r.user_id,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const p = buildInventoryForecastPlan(i.plan);
    expect(p.slots[0]).toMatchObject({
      day: '2026-11-16',
      scheduled_at: null,
      status: 'pending',
      value: '1',
      date_basis_unknown: true,
    });
    expect(p.slots[1]?.value).toBe('2');
    const out = result(i);
    expect(out.status).toBe('unknown');
    expect(out.limitations).toContain('unknown_projection_date');
    expect(out.projection).toMatchObject({
      claim_basis: 'unknown',
      projection_starts_on: null,
      first_unserved_day: null,
    });
    expect(out.reorder_by).toBeNull();
    expect(out.coverage_through).toBeNull();
    expect(out.prepared_only.status).toBe('unknown');
    expect(out.containers[0]?.coverage.status).toBe('unknown');
    expect(out.cycle_assumptions?.[0]).toMatchObject({
      timezone: 'America/Los_Angeles',
      anchor_date: '2026-10-26',
      next_restart_date: '2026-11-16',
      projection_starts_on: null,
    });
  });
});
