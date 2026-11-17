import { describe, expect, it } from 'vitest';
import {
  buildMedicationCourseTimeline,
  courseProjectionEligibility,
  dayOfWeek,
  daysBetween,
  instantToDay,
  medicationCourseTimelineResponseSchema,
  type MedicationCourseTimelineInput,
  type TimelineCourseFacts,
} from '@workspace/shared';
import { medicationCourseFixture } from './fixtures/medicationCourseFixture.ts';
const now = '2026-11-17T12:00:00Z';
function facts(): TimelineCourseFacts {
  const c = medicationCourseFixture();
  c.revisions[0]!.end_date = '2026-11-25';
  return c;
}
function input(c = facts()): MedicationCourseTimelineInput {
  return {
    courses: [c],
    medications: new Map([
      [c.medication_id!, { name: 'Synthetic medication', is_active: true }],
    ]),
    as_of: now,
    today: '2026-11-17',
    timezone: 'Europe/London',
  };
}
function timeline(i = input()) {
  return medicationCourseTimelineResponseSchema.parse(
    buildMedicationCourseTimeline(i)
  );
}
function repeating() {
  const c = facts(),
    r = c.revisions[0]!;
  Object.assign(r, {
    course_cycle_on_weeks: 1,
    course_cycle_off_weeks: 2,
    course_cycle_anchor_date: '2026-11-01',
    end_date: '2026-11-07',
  });
  return c;
}
const at = (t: ReturnType<typeof timeline>, day: string) =>
  t.overlap.find((d) => d.day === day)!;
describe('read-only authored course timeline geometry', () => {
  it('uses exactly20 Sunday weeks with an inclusive140 civil-day window and centred today column', () => {
    const t = timeline();
    expect(t.window).toEqual({
      start_date: '2026-10-25',
      end_date: '2027-03-13',
      days: 140,
    });
    expect(t.today_offset).toBe(23);
    expect(t.week_ticks).toHaveLength(20);
    expect(
      t.week_ticks.every((w, i) => w.offset === i * 7 && dayOfWeek(w.day) === 0)
    ).toBe(true);
    expect(t.overlap).toHaveLength(140);
  });
  it.each(['2026-03-29', '2026-10-25', '2028-02-29'])(
    'keeps civil geometry across DST/leap day %s',
    (day) => {
      const i = input();
      i.today = day;
      i.as_of = day + 'T12:00:00Z';
      const t = timeline(i);
      expect(daysBetween(t.window.start_date, t.window.end_date)).toBe(139);
      expect(dayOfWeek(t.window.start_date)).toBe(0);
      expect(dayOfWeek(t.window.end_date)).toBe(6);
    }
  );
  it('preserves finite authored bounds, inclusive endpoints and positive width', () => {
    const t = timeline(),
      r = t.rows[0]!;
    expect(r.segments[0]).toMatchObject({
      kind: 'authored_window',
      from: '2026-11-01',
      to: '2026-11-25',
      days: 25,
      offset: 7,
    });
    expect(r.open_end).toBe(false);
    expect(at(t, '2026-11-25').planned_on).toBe(1);
    expect(at(t, '2026-11-26').planned_on).toBe(0);
  });
  it('shows known active open ends only through display edge and omits outside-window finite rows', () => {
    const i = input();
    i.courses[0]!.revisions[0]!.end_date = null;
    const t = timeline(i);
    expect(t.rows[0]?.open_end).toBe(true);
    expect(t.rows[0]?.segments[0]?.to).toBe(t.window.end_date);
    i.courses[0]!.revisions[0]!.end_date = '2026-10-20';
    expect(timeline(i).rows).toHaveLength(0);
  });
  it('does not fill null start or pre-anchor history with inferred On', () => {
    const i = input();
    i.courses[0]!.revisions[0]!.start_date = null;
    let r = timeline(i).rows[0]!;
    expect(r.segments).toEqual([]);
    expect(r.limitations).toContain('unknown_start');
    const c = facts();
    Object.assign(c.revisions[0]!, {
      course_cycle_on_weeks: 1,
      course_cycle_off_weeks: 1,
      course_cycle_anchor_date: '2026-12-01',
      end_date: null,
    });
    r = timeline(input(c)).rows[0]!;
    expect(r.limitations).toContain('cycle_before_anchor');
    expect(
      r.segments.some(
        (s) => s.kind === 'authored_window' && s.from === '2026-11-01'
      )
    ).toBe(true);
    expect(
      r.segments
        .filter((s) => s.kind !== 'authored_window')
        .every((s) => s.from >= '2026-12-01')
    ).toBe(true);
  });
  it('keeps authored dues window intact while weekly Break is advisory and on-only stops its overlay', () => {
    const c = facts();
    Object.assign(c.revisions[0]!, {
      course_cycle_on_weeks: 1,
      course_cycle_off_weeks: 1,
      course_cycle_anchor_date: '2026-11-01',
    });
    let r = timeline(input(c)).rows[0]!;
    expect(r.segments[0]?.to).toBe('2026-11-25');
    expect(
      r.segments.some(
        (s) => s.kind === 'advisory_break' && s.from === '2026-11-08'
      )
    ).toBe(true);
    c.revisions[0]!.course_cycle_off_weeks = null;
    r = timeline(input(c)).rows[0]!;
    expect(r.segments[0]?.to).toBe('2026-11-25');
    expect(r.segments.filter((s) => s.kind === 'planned_on').at(-1)?.to).toBe(
      '2026-11-07'
    );
    expect(r.segments.some((s) => s.kind === 'projected_on')).toBe(false);
  });
  it('qualifies missing cycle anchors without suppressing the separate authored window', () => {
    const i = input();
    i.courses[0]!.revisions[0]!.course_cycle_on_weeks = 1;
    const r = timeline(i).rows[0]!;
    expect(r.limitations).toContain('unknown_cycle_anchor');
    expect(r.segments.every((s) => s.kind === 'authored_window')).toBe(true);
  });
  it('clips On classification before capture while preserving known authored boundaries', () => {
    const i = input();
    i.courses[0]!.captured_at = '2026-11-10T15:00:00Z';
    const t = timeline(i);
    expect(t.rows[0]?.segments[0]?.from).toBe('2026-11-01');
    expect(at(t, '2026-11-09').planned_on).toBe(0);
    expect(at(t, '2026-11-10').planned_on).toBe(1);
  });
  it('uses positive half-open activity intersections and never fills gaps or zero intervals', () => {
    const i = input(),
      r = i.courses[0]!.revisions[0]!;
    r.activity = [
      { from_at: '2026-11-10T15:00:00Z', until_at: '2026-11-11T00:00:00Z' },
      { from_at: '2026-11-13T12:00:00Z', until_at: '2026-11-13T12:01:00Z' },
      { from_at: '2026-11-15T00:00:00Z', until_at: '2026-11-15T00:00:00Z' },
    ];
    const t = timeline(i);
    expect(at(t, '2026-11-10').planned_on).toBe(1);
    expect(at(t, '2026-11-11').planned_on).toBe(0);
    expect(at(t, '2026-11-12').planned_on).toBe(0);
    expect(at(t, '2026-11-13').planned_on).toBe(1);
    expect(at(t, '2026-11-15').planned_on).toBe(0);
  });
  it('retains paused/completed geometry but excludes those current versions from all overlap dates', () => {
    const i = input();
    i.courses[0]!.revisions[0]!.status = 'paused';
    let t = timeline(i);
    expect(t.rows[0]?.segments.some((s) => s.kind === 'planned_on')).toBe(true);
    expect(
      t.overlap.every((d) => d.planned_on === 0 && d.projected_on === 0)
    ).toBe(true);
    i.courses[0]!.revisions[0]!.status = 'completed';
    t = timeline(i);
    expect(t.rows[0]?.open_end).toBe(false);
    expect(t.rows[0]?.segments.length).toBeGreaterThan(0);
    expect(t.overlap.every((d) => d.planned_on === 0)).toBe(true);
  });
  it('does not fabricate a completed stop, but accepts an authoritative finite activity stop', () => {
    const i = input(),
      r = i.courses[0]!.revisions[0]!;
    r.status = 'completed';
    r.end_date = null;
    r.activity = [];
    let row = timeline(i).rows[0]!;
    expect(row.limitations).toContain('unknown_stop');
    expect(row.segments).toEqual([]);
    expect(row.open_end).toBe(false);
    r.activity = [
      { from_at: '2026-11-01T00:00:00Z', until_at: '2026-11-15T12:00:00Z' },
    ];
    row = timeline(i).rows[0]!;
    expect(row.segments[0]?.to).toBe('2026-11-15');
    expect(row.limitations).not.toContain('unknown_stop');
  });
  it('preserves inclusive predecessor cutoff even after late actual floor and successor tombstone', () => {
    const i = input(),
      c = i.courses[0]!,
      old = c.revisions[0]!,
      next = structuredClone(old);
    Object.assign(old, { status: 'completed', end_date: '2026-11-30' });
    Object.assign(next, {
      id: '20000000-0000-4000-a000-000000000001',
      predecessor_id: old.id,
      revision_no: 2,
      start_date: '2026-11-10',
    });
    next.activity = [{ from_at: '2026-11-10T00:00:00Z', until_at: null }];
    c.revisions.push(next);
    c.current_revision_id = next.id;
    let t = timeline(i);
    expect(t.rows[0]?.segments[0]?.to).toBe('2026-11-09');
    expect(at(t, '2026-11-02').planned_on).toBe(0);
    expect(at(t, '2026-11-11').planned_on).toBe(1);
    next.deleted_at = now;
    c.current_revision_id = null;
    t = timeline(i);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.segments[0]?.to).toBe('2026-11-09');
    expect(
      t.overlap.every((d) => d.planned_on === 0 && d.projected_on === 0)
    ).toBe(true);
  });
  it('projects only current/future civil On/Break windows under the exact I07 gate', () => {
    const i = input(repeating()),
      before = structuredClone(i.courses);
    const t = timeline(i),
      r = t.rows[0]!;
    expect(
      r.segments
        .filter((s) => s.kind.startsWith('projected'))
        .every((s) => s.from >= r.local_today && s.from > '2026-11-07')
    ).toBe(true);
    expect(
      r.segments.some(
        (s) => s.kind === 'projected_on' && s.from === '2026-11-22'
      )
    ).toBe(true);
    expect(at(t, '2026-11-22')).toMatchObject({
      planned_on: 0,
      projected_on: 1,
    });
    expect(i.courses).toEqual(before);
  });
  it.each([
    'early_end',
    'late_end',
    'paused',
    'inactive',
    'missing_medication',
    'superseded',
  ] as const)('does not project %s plans', (kind) => {
    const i = input(repeating()),
      c = i.courses[0]!,
      r = c.revisions[0]!;
    if (kind === 'early_end') r.end_date = '2026-11-06';
    if (kind === 'late_end') r.end_date = '2026-11-08';
    if (kind === 'paused') r.status = 'paused';
    if (kind === 'inactive')
      i.medications = new Map([
        [c.medication_id!, { name: 'Synthetic', is_active: false }],
      ]);
    if (kind === 'missing_medication') i.medications = new Map();
    if (kind === 'superseded') c.current_revision_id = null;
    expect(
      timeline(i)
        .rows.flatMap((r) => r.segments)
        .some((s) => s.kind.startsWith('projected'))
    ).toBe(false);
  });
  it('honours finite activity and closed boundaries for provisional tails', () => {
    const i = input(repeating()),
      r = i.courses[0]!.revisions[0]!;
    r.activity = [
      { from_at: '2026-11-01T00:00:00Z', until_at: '2026-11-24T00:00:00Z' },
    ];
    r.closed_date = '2026-11-22';
    const t = timeline(i);
    expect(
      t.rows[0]?.segments
        .filter((s) => s.kind.startsWith('projected'))
        .every((s) => s.to <= '2026-11-22')
    ).toBe(true);
    expect(at(t, '2026-11-23').projected_on).toBe(0);
  });
  it('counts distinct active current courses even for one medication and separates provisional counts', () => {
    const i = input(),
      other = repeating();
    other.id = '30000000-0000-4000-a000-000000000001';
    other.current_revision_id = '30000000-0000-4000-a000-000000000002';
    other.revisions[0]!.id = other.current_revision_id;
    i.courses.push(other);
    const t = timeline(i);
    expect(at(t, '2026-11-02')).toMatchObject({
      planned_on: 2,
      projected_on: 0,
    });
    expect(at(t, '2026-11-22')).toMatchObject({
      planned_on: 1,
      projected_on: 1,
    });
    expect(t.overlap.every((d) => d.planned_on + d.projected_on <= 2)).toBe(
      true
    );
  });
  it('keeps saved course calendars and local-today labels without viewer reinterpretation', () => {
    const i = input();
    i.as_of = '2026-11-17T01:00:00Z';
    i.timezone = 'UTC';
    i.courses[0]!.timezone = 'America/Los_Angeles';
    const t = timeline(i);
    expect(t.today).toBe('2026-11-17');
    expect(t.rows[0]?.local_today).toBe('2026-11-16');
    expect(t.rows[0]?.timezone).toBe('America/Los_Angeles');
    expect(t.rows[0]?.segments[0]?.from).toBe('2026-11-01');
    expect(t.rows[0]?.local_today).toBe(
      instantToDay(i.as_of, i.courses[0]!.timezone)
    );
  });
  it('does not infer a linked active medication and preserves unknown empty-name facts', () => {
    const i = input();
    i.medications = new Map();
    i.courses[0]!.medication_id = null;
    i.courses[0]!.medication_name_snapshot = null;
    const t = timeline(i);
    expect(t.rows[0]).toMatchObject({
      medication_active: null,
      medication_name: '',
      overlap_eligible: false,
    });
    expect(t.overlap.every((d) => d.planned_on === 0)).toBe(true);
  });
  it('extracts the strict I07 gate with the original range-failure and tombstone-cutoff semantics', () => {
    const c = repeating();
    expect(
      courseProjectionEligibility({ course: c, medicationActive: true })
        ?.next_restart_date
    ).toBe('2026-11-22');
    c.revisions.push({
      ...structuredClone(c.revisions[0]!),
      id: 'child',
      predecessor_id: c.revisions[0]!.id,
      deleted_at: now,
    });
    expect(
      courseProjectionEligibility({ course: c, medicationActive: true })
    ).toBeNull();
    c.revisions.pop();
    c.revisions[0]!.course_cycle_anchor_date = '9999-12-31';
    expect(() =>
      courseProjectionEligibility({ course: c, medicationActive: true })
    ).toThrow(RangeError);
    expect(timeline(input(c)).rows[0]?.limitations).toContain(
      'date_out_of_range'
    );
  });
});
