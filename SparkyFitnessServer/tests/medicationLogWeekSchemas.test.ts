import { describe, expect, it } from 'vitest';
import {
  medicationInjectionReadSchema,
  medicationLogWeekQuerySchema,
  medicationLogWeekResponseSchema,
  type MedicationLogWeekActual,
  type MedicationLogWeekPlannedSlot,
  type MedicationLogWeekResponse,
} from '@workspace/shared';
import { addDays } from '../../shared/src/utils/timezone.ts';

const med = '30000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000002';
const revision = '30000000-0000-4000-8000-000000000003';
const rule = '30000000-0000-4000-8000-000000000004';
const course = '30000000-0000-4000-8000-000000000005';
const slot = (): MedicationLogWeekPlannedSlot => ({
  id: 'explicit-managed-slot',
  lane_id: `medication:${med}`,
  medication_id: med,
  plan_kind: 'managed',
  timezone: 'Pacific/Auckland',
  scheduled_day: '2026-11-16',
  scheduled_for: null,
  time_of_day: null,
  status: 'taken',
  dose_amount: '9',
  dose_unit: 'mg',
  dose_qualification: 'configured',
  course_id: course,
  course_revision_id: revision,
  course_rule_id: rule,
  course_step_id: null,
  course_slot_key: 'explicit-managed-slot',
  course_expected_version: 1,
  schedule_id: null,
});
const actual = (
  source_kind: 'entry' | 'injection' = 'entry'
): MedicationLogWeekActual => ({
  key: `${source_kind}:${id}`,
  id,
  source_kind,
  lane_id: `medication:${med}`,
  medication_id: med,
  medication_name: 'Recorded native item',
  status: 'taken',
  entry_date: '2026-11-17',
  occurred_at: null,
  dose_amount: '2',
  dose_unit: 'tablet',
  dose_mg_exact: null,
  schedule_id: null,
  course_origin: true,
  course_revision_id: revision,
  course_rule_id: rule,
  course_step_id: null,
  course_slot_key: 'explicit-managed-slot',
  scheduled_day: '2026-11-16',
  scheduled_for: null,
  notes: null,
  site: null,
  administration_route: null,
});
const response = (): MedicationLogWeekResponse => ({
  as_of: '2026-11-17T10:00:00Z',
  today: '2026-11-17',
  timezone: 'Europe/London',
  week_start: '2026-11-16',
  days: Array.from({ length: 7 }, (_, index) => addDays('2026-11-16', index)),
  lanes: [
    {
      id: `medication:${med}`,
      medication_id: med,
      name: 'Synthetic item',
      is_supplement: false,
    },
  ],
  planned_slots: [slot()],
  actuals: [actual()],
  fulfilled_slots: [{ planned_id: slot().id, actual: actual() }],
  coverage: [
    {
      lane_id: `medication:${med}`,
      course_id: course,
      timezone: 'Pacific/Auckland',
      day: '2026-11-16',
      coverage: 'partial',
    },
  ],
});

describe('canonical weekly medication calendar schemas', () => {
  it('accepts a Monday or default week and profile assertion only', () => {
    expect(medicationLogWeekQuerySchema.parse({})).toEqual({});
    expect(
      medicationLogWeekQuerySchema.safeParse({
        week_start: '2026-11-16',
        expected_owner_id: id,
      }).success
    ).toBe(true);
    for (const bad of [
      { week_start: '2026-11-17' },
      { week_start: '9999-12-27' },
      { range: 30 },
      { as_of: '2026-11-17' },
      { owner_id: id },
    ])
      expect(medicationLogWeekQuerySchema.safeParse(bad).success).toBe(false);
  });

  it('requires exactly seven consecutive Monday-first civil dates', () => {
    const good = response();
    expect(medicationLogWeekResponseSchema.safeParse(good).success).toBe(true);
    const short = response();
    short.days.pop();
    const repeated = response();
    repeated.days[1] = repeated.days[0]!;
    for (const bad of [short, repeated, { ...good, week_start: '2026-11-17' }])
      expect(medicationLogWeekResponseSchema.safeParse(bad).success).toBe(
        false
      );
  });

  it('keeps recorded native amount, NULL clock and actual date separate from planned values', () => {
    const parsed = medicationLogWeekResponseSchema.parse(response());
    expect(parsed.actuals[0]).toMatchObject({
      entry_date: '2026-11-17',
      occurred_at: null,
      dose_amount: '2',
      dose_unit: 'tablet',
    });
    expect(parsed.planned_slots[0]).toMatchObject({
      scheduled_day: '2026-11-16',
      dose_amount: '9',
      timezone: 'Pacific/Auckland',
      scheduled_for: null,
    });
  });

  it('permits exact linked outside-week summaries without moving or adding actual glyphs', () => {
    const value = response();
    value.actuals = [];
    value.fulfilled_slots[0]!.actual.entry_date = '2026-11-23';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    value.actuals = [value.fulfilled_slots[0]!.actual];
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('requires an in-week linked actual to remain one consistent visible snapshot', () => {
    const missing = response();
    missing.actuals = [];
    const changed = response();
    changed.fulfilled_slots[0]!.actual.dose_amount = '9';
    const duplicate = response();
    duplicate.actuals.push(actual());
    const doubleLink = response();
    doubleLink.fulfilled_slots.push(doubleLink.fulfilled_slots[0]!);
    for (const bad of [missing, changed, duplicate, doubleLink])
      expect(medicationLogWeekResponseSchema.safeParse(bad).success).toBe(
        false
      );
  });

  it('does not collapse ordinary and injection rows with the same UUID', () => {
    const value = response();
    value.actuals.push(actual('injection'));
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    value.actuals[1]!.key = value.actuals[0]!.key;
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('rejects nearest-date or medication-only managed fulfilment guesses', () => {
    for (const patch of [
      { course_rule_id: null },
      { course_revision_id: null },
      { scheduled_day: '2026-11-17' },
      { course_slot_key: null },
    ]) {
      const value = response();
      Object.assign(value.actuals[0]!, patch);
      Object.assign(value.fulfilled_slots[0]!.actual, patch);
      expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
        false
      );
    }
  });

  it('keeps unknown future phased doses qualified and has no speculative amount fallback', () => {
    const value = response();
    value.actuals = [];
    value.fulfilled_slots = [];
    value.planned_slots[0] = {
      ...slot(),
      status: 'planned',
      scheduled_day: '2026-11-20',
      dose_amount: null,
      dose_qualification: 'future_phase_unknown',
    };
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    value.planned_slots[0]!.dose_amount = '9';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('preserves orphan snapshots and explicit course lanes without inferred medication grouping', () => {
    const value = response();
    value.planned_slots = [];
    value.fulfilled_slots = [];
    value.coverage = [];
    value.actuals = [
      { ...actual(), medication_id: null, lane_id: `orphan:entry:${id}` },
    ];
    value.lanes = [
      {
        id: `orphan:entry:${id}`,
        medication_id: null,
        name: 'Recorded native item',
        is_supplement: null,
      },
    ];
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    value.actuals[0]!.lane_id = 'orphan:guess-by-name';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('cannot create missed legacy history and only matches exact saved timing', () => {
    const value = response();
    const schedule = '30000000-0000-4000-8000-000000000006';
    value.planned_slots = [
      {
        ...slot(),
        id: 'legacy-slot',
        plan_kind: 'legacy',
        scheduled_day: '2026-11-17',
        scheduled_for: '2026-11-17T08:00:00Z',
        status: 'taken',
        course_id: null,
        course_revision_id: null,
        course_rule_id: null,
        course_step_id: null,
        course_slot_key: null,
        course_expected_version: null,
        schedule_id: schedule,
      },
    ];
    const logged = {
      ...actual(),
      course_origin: null,
      course_revision_id: null,
      course_rule_id: null,
      course_step_id: null,
      course_slot_key: null,
      scheduled_day: null,
      schedule_id: schedule,
      scheduled_for: '2026-11-17T08:00:00.000Z',
    };
    value.actuals = [logged];
    value.fulfilled_slots = [{ planned_id: 'legacy-slot', actual: logged }];
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    const wrong = structuredClone(value);
    wrong.actuals[0]!.course_origin = true;
    wrong.fulfilled_slots[0]!.actual.course_origin = true;
    expect(medicationLogWeekResponseSchema.safeParse(wrong).success).toBe(
      false
    );
    value.planned_slots[0]!.scheduled_day = '2026-11-16';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
    value.planned_slots[0]!.scheduled_day = '2026-11-17';
    value.planned_slots[0]!.status = 'missed';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('retains unavailable capture/history coverage rather than guessing a denominator', () => {
    const value = response();
    value.coverage[0]!.coverage = 'unavailable';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(true);
    value.coverage[0]!.course_id = null;
    value.coverage[0]!.coverage = 'current_schedule_only';
    expect(medicationLogWeekResponseSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('keeps week summaries bounded while the exact injection read preserves nullable physical facts', () => {
    const value = response();
    expect(
      medicationLogWeekResponseSchema.safeParse({
        ...value,
        actuals: [{ ...actual(), pen_id: id }],
      }).success
    ).toBe(false);
    const exact = {
      id,
      medication_id: null,
      user_id: med,
      pen_id: null,
      preparation_id: null,
      injected_at: null,
      entry_date: '2026-11-17',
      site: null,
      administration_route: 'nasal',
      dose_mg: '0.123456789',
      dose_mg_exact: '0.123456789',
      volume_ml: '0.0123456789',
      syringe_units: null,
      dose_input_unit: 'ml',
      syringe_id: null,
      notes: null,
      source: 'manual',
      custom_fields: {},
      created_at: null,
      updated_at: null,
      scheduled_for: null,
      course_revision_id: null,
      course_rule_id: null,
      course_step_id: null,
      scheduled_day: null,
      course_slot_key: null,
      course_origin: true,
      medication_name_snapshot: 'Saved item',
    };
    expect(medicationInjectionReadSchema.parse(exact)).toMatchObject({
      medication_id: null,
      injected_at: null,
      dose_mg_exact: '0.123456789',
      volume_ml: '0.0123456789',
    });
  });

  it('preserves known delivered volume as native ml without presenting the zero-mass sentinel', () => {
    const value = response();
    const volume = {
      ...actual('injection'),
      dose_amount: '0.0123456789',
      dose_unit: 'ml',
      dose_mg_exact: null,
    };
    value.actuals = [volume];
    value.fulfilled_slots[0]!.actual = volume;
    const parsed = medicationLogWeekResponseSchema.parse(value);
    expect(parsed.actuals[0]).toMatchObject({
      dose_amount: '0.0123456789',
      dose_unit: 'ml',
      dose_mg_exact: null,
    });
    expect(parsed.fulfilled_slots[0]!.actual.dose_amount).not.toBe(
      parsed.planned_slots[0]!.dose_amount
    );
  });
});
