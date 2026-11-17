import { describe, expect, it } from 'vitest';
import {
  medicationCourseTimelineQuerySchema,
  medicationCourseTimelineResponseSchema,
  medicationCourseTimelineRowSchema,
  type MedicationCourseTimelineResponse,
  type MedicationCourseTimelineRow,
} from '@workspace/shared';
import { addDays } from '../../shared/src/utils/timezone.ts';

const id = '20000000-0000-4000-8000-000000000001';
const row = (): MedicationCourseTimelineRow => ({
  course_id: id,
  revision_id: '20000000-0000-4000-8000-000000000002',
  revision_no: 1,
  name: 'Synthetic authored plan',
  medication_id: '20000000-0000-4000-8000-000000000003',
  medication_name: 'Synthetic medication',
  timezone: 'America/Los_Angeles',
  local_today: '2026-11-23',
  status: 'active',
  bucket: 'active',
  is_current_tip: true,
  medication_active: true,
  version: 1,
  start_date: '2026-11-02',
  end_date: '2026-12-01',
  closed_date: null,
  open_end: false,
  overlap_eligible: true,
  segments: [
    {
      kind: 'authored_window',
      from: '2026-11-02',
      to: '2026-12-01',
      offset: 1,
      days: 30,
    },
    {
      kind: 'advisory_break',
      from: '2026-11-09',
      to: '2026-11-15',
      offset: 8,
      days: 7,
    },
  ],
  limitations: [],
});
const response = (): MedicationCourseTimelineResponse => ({
  as_of: '2026-11-24T01:00:00Z',
  today: '2026-11-24',
  timezone: 'UTC',
  window: {
    start_date: '2026-11-01',
    end_date: addDays('2026-11-01', 139),
    days: 140,
  },
  today_offset: 23,
  week_ticks: Array.from({ length: 20 }, (_, index) => ({
    day: addDays('2026-11-01', index * 7),
    offset: index * 7,
  })),
  rows: [row()],
  overlap: Array.from({ length: 140 }, (_, index) => ({
    day: addDays('2026-11-01', index),
    planned_on: 0,
    projected_on: 0,
  })),
});

describe('read-only course timeline schemas', () => {
  it('accepts only an optional profile assertion, without calendar or mutation controls', () => {
    expect(medicationCourseTimelineQuerySchema.parse({})).toEqual({});
    expect(
      medicationCourseTimelineQuerySchema.parse({ expected_owner_id: id })
    ).toEqual({ expected_owner_id: id });
    for (const extra of [
      { range: 365 },
      { as_of: '2026-11-01' },
      { owner_id: id },
      { anchor_date: '2026-11-01' },
    ])
      expect(medicationCourseTimelineQuerySchema.safeParse(extra).success).toBe(
        false
      );
  });

  it('preserves saved course date labels and local today independently from profile today', () => {
    const parsed = medicationCourseTimelineResponseSchema.parse(response());
    expect(parsed.today).toBe('2026-11-24');
    expect(parsed.rows[0]!.local_today).toBe('2026-11-23');
    expect(parsed.rows[0]!.timezone).toBe('America/Los_Angeles');
    expect(parsed.rows[0]!.segments[0]!.from).toBe('2026-11-02');
  });

  it('retains the authored window underneath an advisory break', () => {
    const parsed = medicationCourseTimelineRowSchema.parse(row());
    expect(parsed.segments.map((segment) => segment.kind)).toEqual([
      'authored_window',
      'advisory_break',
    ]);
  });

  it('requires the source-sized Sunday-snapped window and profile-today offset', () => {
    const good = response();
    for (const bad of [
      { ...good, window: { ...good.window, days: 139 } },
      { ...good, window: { ...good.window, end_date: '2027-01-01' } },
      { ...good, today_offset: 24 },
      { ...good, today: '2026-11-01', today_offset: 0 },
    ])
      expect(
        medicationCourseTimelineResponseSchema.safeParse(bad).success
      ).toBe(false);
  });

  it('rejects offset/date disagreement and geometry outside the displayed window', () => {
    for (const segment of [
      { ...row().segments[0]!, offset: 2 },
      { ...row().segments[0]!, days: 29 },
      { ...row().segments[0]!, offset: 139, days: 2 },
      { ...row().segments[0]!, from: '2026-12-02', to: '2026-12-01' },
    ]) {
      const value = response();
      value.rows[0]!.segments = [segment];
      expect(
        medicationCourseTimelineResponseSchema.safeParse(value).success
      ).toBe(false);
    }
  });

  it('rejects missing, duplicated or misaligned axis/overlap columns', () => {
    const tick = response();
    tick.week_ticks[1]!.offset = 0;
    const overlap = response();
    overlap.overlap[1]!.day = overlap.overlap[0]!.day;
    const short = response();
    short.overlap.pop();
    const duplicate = response();
    duplicate.rows.push(row());
    for (const bad of [tick, overlap, short, duplicate])
      expect(
        medicationCourseTimelineResponseSchema.safeParse(bad).success
      ).toBe(false);
  });

  it('requires a live current active plan and linked active medication for overlap eligibility', () => {
    for (const override of [
      { is_current_tip: false },
      { status: 'paused' },
      { status: 'completed' },
      { medication_active: false },
      { medication_active: null },
      { medication_id: null },
    ])
      expect(
        medicationCourseTimelineRowSchema.safeParse({ ...row(), ...override })
          .success
      ).toBe(false);
  });

  it('retains historical or missing-medication rows without inventing overlap or association', () => {
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        status: 'completed',
        bucket: 'completed',
        is_current_tip: false,
        overlap_eligible: false,
      }).success
    ).toBe(true);
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        medication_id: null,
        medication_active: null,
        medication_name: '',
        overlap_eligible: false,
      }).success
    ).toBe(true);
  });

  it('does not fill an unknown start or claim a completed open future', () => {
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        start_date: null,
      }).success
    ).toBe(false);
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        start_date: null,
        segments: [],
        overlap_eligible: false,
        limitations: ['unknown_start'],
      }).success
    ).toBe(true);
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        status: 'completed',
        overlap_eligible: false,
        open_end: true,
      }).success
    ).toBe(false);
  });

  it('keeps hypothetical windows beyond the authored end and only on current/future dates', () => {
    const projected = {
      kind: 'projected_on',
      from: '2026-12-02',
      to: '2026-12-08',
      offset: 31,
      days: 7,
    };
    expect(
      medicationCourseTimelineRowSchema.safeParse({
        ...row(),
        segments: [projected],
      }).success
    ).toBe(true);
    for (const bad of [
      { ...row(), overlap_eligible: false, segments: [projected] },
      { ...row(), end_date: null, segments: [projected] },
      { ...row(), segments: [{ ...projected, from: '2026-11-30' }] },
      { ...row(), local_today: '2026-12-03', segments: [projected] },
    ])
      expect(medicationCourseTimelineRowSchema.safeParse(bad).success).toBe(
        false
      );
  });

  it('contains no dose, phase, actual-history or inline editing payload', () => {
    for (const extra of [
      { dose_amount: '1' },
      { phase: 1 },
      { notes: 'private' },
      { actuals: [] },
    ])
      expect(
        medicationCourseTimelineRowSchema.safeParse({ ...row(), ...extra })
          .success
      ).toBe(false);
  });
});
