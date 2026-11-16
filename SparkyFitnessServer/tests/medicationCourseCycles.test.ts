import { describe, it, expect } from 'vitest';
import { courseCycleDates } from '../services/medicationCourseCycleCalendar.js';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.js';
import {
  buildCourseCycleState,
  buildCourseCycleReview,
  courseCycleStartPlan,
} from '../services/medicationCourseCycleService.js';
import type {
  CourseActual,
  CoursePhaseActual,
} from '../models/medicationCourseRepository.js';
function fixture() {
  const c = medicationCourseFixture(),
    r = c.revisions[0]!;
  r.course_cycle_on_weeks = 1;
  r.course_cycle_off_weeks = 1;
  r.course_cycle_anchor_date = '2026-11-01';
  r.phase_origin_context = { start_date: r.start_date, end_date: r.end_date };
  return c;
}
const now = new Date('2026-11-16T12:00:00Z');
function actual(status = 'taken', day = '2026-11-08'): CourseActual {
  const c = fixture(),
    r = c.revisions[0]!;
  return {
    id: '00000000-0000-4000-a000-000000000099',
    source_kind: 'entry',
    course_origin: true,
    course_revision_id: r.id,
    course_rule_id: null,
    course_step_id: null,
    course_slot_key: null,
    scheduled_day: null,
    scheduled_for: null,
    entry_date: day,
    occurred_at: `${day}T12:00:00Z`,
    status,
    medication_name: 'Synthetic recorded label',
    dose_amount: '1',
    dose_unit: 'mg',
    dose_mg_exact: null,
    volume_ml: null,
    site: null,
    notes: null,
    administration_route: null,
  };
}
describe('reviewed weekly cycle boundaries', () => {
  it('leaves no plan continuous and generates no weekly dates or action', () => {
    const c = fixture();
    c.revisions[0]!.course_cycle_on_weeks = null;
    c.revisions[0]!.course_cycle_off_weeks = null;
    c.revisions[0]!.course_cycle_anchor_date = null;
    const s = buildCourseCycleState(c, true, [], [], now);
    expect(s).toMatchObject({
      phase: 'none',
      planned_stop_date: null,
      next_restart_date: null,
      end_cycle: { allowed: false },
      start_next_cycle: { allowed: false },
    });
  });
  it('supports overdue repeating restart and on-only manual restart without invented restart date', () => {
    const c = fixture();
    expect(buildCourseCycleState(c, true, [], [], now)).toMatchObject({
      phase: 'restart_due',
      planned_stop_date: '2026-11-07',
      next_restart_date: '2026-11-15',
      start_next_cycle: { allowed: true },
    });
    c.revisions[0]!.course_cycle_off_weeks = null;
    expect(buildCourseCycleState(c, true, [], [], now)).toMatchObject({
      phase: 'ended',
      next_restart_date: null,
      start_next_cycle: { allowed: true },
    });
  });
  it('preserves an earlier authored End without pulling an explicit break restart forward', () => {
    const c = fixture();
    c.revisions[0]!.end_date = '2026-11-05';
    const at = new Date('2026-11-06T12:00:00Z');
    const r = buildCourseCycleReview(
      c,
      true,
      [],
      [],
      { action: 'end', expected_version: 1 },
      {},
      at
    );
    expect(r).toMatchObject({
      candidate_end_date: '2026-11-05',
      can_commit: true,
    });
    expect(r.cycle.start_next_cycle.allowed).toBe(false);
    expect(r.cycle.next_restart_date).toBe('2026-11-15');
  });
  it('uses immutable course zone and permits completed restart without requiring End first', () => {
    const c = fixture();
    c.timezone = 'Pacific/Kiritimati';
    c.revisions[0]!.status = 'completed';
    expect(
      buildCourseCycleState(c, true, [], [], new Date('2026-11-14T12:00:00Z'))
    ).toMatchObject({
      today: '2026-11-15',
      start_next_cycle: { allowed: true },
      end_cycle: { allowed: false },
    });
  });
  it('does not autoactivate inactive medication or paused revisions', () => {
    const c = fixture();
    expect(
      buildCourseCycleState(c, false, [], [], now).start_next_cycle.allowed
    ).toBe(false);
    c.revisions[0]!.status = 'paused';
    expect(
      buildCourseCycleState(c, true, [], [], now).start_next_cycle.allowed
    ).toBe(false);
  });
  it('protects stored taken/skip/snooze/timing but not virtual missed expectations', () => {
    for (const status of ['taken', 'skipped', 'snoozed']) {
      const c = fixture();
      expect(
        buildCourseCycleState(c, true, [actual(status)], [], now).end_cycle
          .allowed
      ).toBe(false);
      expect(
        buildCourseCycleState(c, true, [actual(status, '2026-11-16')], [], now)
          .start_next_cycle.allowed
      ).toBe(false);
    }
    expect(
      buildCourseCycleState(fixture(), true, [], [], now).end_cycle.allowed
    ).toBe(true);
    const row = actual('taken', '2026-11-02');
    row.scheduled_day = '2026-11-17';
    expect(
      buildCourseCycleState(fixture(), true, [row], [], now).start_next_cycle
        .allowed
    ).toBe(false);
  });
  it('protects retained detached phase history without remapping it to current slots', () => {
    const c = fixture(),
      a = actual('taken', '2026-11-16');
    const detached: CoursePhaseActual = {
      ...a,
      course_revision_id: null,
      phase_family_id: c.revisions[0]!.id,
    };
    expect(
      buildCourseCycleState(c, true, [], [detached], now).start_next_cycle
        .allowed
    ).toBe(false);
  });
  it('previews only first due at/after action NOW and refreshes if that boundary passes', () => {
    const c = fixture();
    const before = buildCourseCycleReview(
      c,
      true,
      [],
      [],
      { action: 'start', expected_version: 1 },
      {},
      new Date('2026-11-16T07:00:00Z')
    );
    const after = buildCourseCycleReview(
      c,
      true,
      [],
      [],
      { action: 'start', expected_version: 1 },
      {},
      now
    );
    expect(before.first_due?.scheduled_day).toBe('2026-11-16');
    expect(after.first_due?.scheduled_day).toBe('2026-11-17');
    expect(before.review_fingerprint).not.toBe(after.review_fingerprint);
    expect(
      buildCourseCycleReview(
        c,
        true,
        [],
        [],
        { action: 'start', expected_version: 1 },
        {},
        new Date('2026-11-16T12:30:00Z')
      ).review_fingerprint
    ).toBe(after.review_fingerprint);
  });
  it('preserves exhausted rule bounds rather than inventing a first due', () => {
    const c = fixture();
    c.revisions[0]!.rules[0]!.end_date = '2026-11-02';
    const review = buildCourseCycleReview(
      c,
      true,
      [],
      [],
      { action: 'start', expected_version: 1 },
      {},
      now
    );
    expect(review.can_commit).toBe(true);
    expect(review.first_due).toBeNull();
  });
  it('pins ONLY otherwise moving daily cyclic/interval fallback and preserves explicit anchors/bounds', () => {
    const c = fixture(),
      r = c.revisions[0]!;
    const base = r.rules[0]!;
    r.rules = [
      {
        ...base,
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 3,
        anchor_date: null,
        start_date: null,
        end_date: '2027-01-01',
      },
      {
        ...base,
        schedule_type_id: 'every_n_days',
        interval_days: 5,
        anchor_date: null,
        start_date: null,
      },
      {
        ...base,
        schedule_type_id: 'every_n_days',
        interval_days: 5,
        anchor_date: null,
        start_date: '2026-10-01',
      },
      {
        ...base,
        schedule_type_id: 'cyclic',
        cycle_on_days: 2,
        cycle_off_days: 3,
        anchor_date: '2026-10-02',
      },
    ];
    const p = courseCycleStartPlan(r, '2026-11-18');
    expect(p.rules.map((rule) => rule.anchor_date)).toEqual([
      '2026-11-01',
      '2026-11-01',
      null,
      '2026-10-02',
    ]);
    expect(p.rules[0]!.end_date).toBe('2027-01-01');
    expect(p.cycle_anchor_date).toBeNull();
    r.cycle_anchor_date = '2026-10-03';
    expect(
      courseCycleStartPlan(r, '2026-11-18').rules[0]!.anchor_date
    ).toBeNull();
  });
  it('returns a typed calendar-range failure without clamping a valid extreme authored date', () => {
    expect(() => courseCycleDates(104, 104, '9999-12-31')).toThrow(
      expect.objectContaining({ statusCode: 422 })
    );
  });
  it('does not veto unchanged older linked history, but protects detached facts whose original boundary is unknown', () => {
    const c = fixture(),
      origin = c.revisions[0]!;
    origin.status = 'completed';
    origin.closed_date = '2026-11-07';
    const child = {
      ...structuredClone(origin),
      id: '00000000-0000-4000-a000-000000000077',
      predecessor_id: origin.id,
      revision_no: 2,
      status: 'active' as const,
      start_date: '2026-11-08',
      closed_date: null,
      course_cycle_anchor_date: '2026-11-08',
      phase_family_id: origin.id,
      phase_origin_context: null,
    };
    c.current_revision_id = child.id;
    c.revisions.push(child);
    const late = actual('taken', '2026-11-15');
    expect(
      buildCourseCycleState(c, true, [late], [], now).end_cycle.allowed
    ).toBe(true);
    const detached: CoursePhaseActual = {
      ...late,
      course_revision_id: null,
      phase_family_id: origin.id,
    };
    expect(
      buildCourseCycleState(c, true, [], [detached], now).end_cycle.allowed
    ).toBe(false);
  });
  it('never reconstructs missing continuation origin context from a boundary-modified window', () => {
    const c = fixture(),
      origin = c.revisions[0]!;
    origin.phase_origin_context = null;
    origin.status = 'completed';
    origin.end_date = '2026-11-07';
    const child = {
      ...structuredClone(origin),
      id: '00000000-0000-4000-a000-000000000078',
      predecessor_id: origin.id,
      revision_no: 2,
      status: 'active' as const,
      start_date: '2026-11-08',
      end_date: null,
      course_cycle_anchor_date: '2026-11-08',
      phase_family_id: origin.id,
    };
    c.revisions.push(child);
    c.current_revision_id = child.id;
    const review = buildCourseCycleReview(
      c,
      true,
      [],
      [],
      { action: 'start', expected_version: 1 },
      {},
      new Date('2026-11-23T12:00:00Z')
    );
    expect(review.can_commit).toBe(false);
    expect(review.cycle.start_next_cycle.reasons.join(' ')).toContain(
      'origin context'
    );
  });
});
