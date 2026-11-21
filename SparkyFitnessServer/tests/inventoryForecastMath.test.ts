import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildInventoryForecast,
  buildInventoryForecastPlan,
  courseSlotKey,
  medicationForecastCoverageSchema,
  type CourseDeliveredDose,
  type InventoryForecastDevice,
  type InventoryForecastInput,
  type InventoryForecastLegacyPlan,
  type InventoryForecastPlanInput,
  type InventoryPreparedContainer,
  type MedicationCourse,
} from '@workspace/shared';
import {
  medicationCourseFixture,
  courseFixtureIds as ids,
} from './fixtures/medicationCourseFixture.ts';
const today = '2026-11-16',
  now = '2026-11-16T12:00:00Z';
const device: InventoryForecastDevice = {
  id: '10000000-0000-4000-a000-000000000001',
  basis: 'preferred',
  device: {
    name: 'Synthetic U100',
    device_type: 'syringe',
    graduation_type: 'units',
    units_per_ml: 100,
    capacity_ml: '1',
    capacity_units: 100,
    increment: '1',
  },
};
const prepared = (
  patch: Partial<InventoryPreparedContainer> = {}
): InventoryPreparedContainer => ({
  id: '10000000-0000-4000-a000-000000000002',
  status: 'in_use',
  remaining_ml: '3',
  concentration_mcg_ml: '1000',
  usable_until: '2028-01-01',
  opened_at: '2026-11-01T12:00:00Z',
  expiry_date: null,
  created_at: '2026-11-01T12:00:00Z',
  ...patch,
});
const context = (
  course: MedicationCourse = medicationCourseFixture()
): Omit<InventoryForecastPlanInput, 'devices'> & {
  devices: Record<string, InventoryForecastDevice | null>;
} => ({
  today,
  now,
  timezone: 'Europe/London',
  medication_active: true,
  route: 'injection',
  courses: [course],
  actuals: [],
  devices: { [course.revisions[0]!.id]: device },
});
const input = (
  plan: InventoryForecastPlanInput = context(),
  containers: InventoryPreparedContainer[] = [prepared()]
): InventoryForecastInput => ({
  plan,
  containers,
  lead_days: 14,
  buffer_days: 3,
});
const finite = (end = '2026-11-18') => {
  const c = medicationCourseFixture();
  c.revisions[0]!.end_date = end;
  return c;
};
const actual = (
  day: string,
  status = 'taken',
  patch: Partial<CourseDeliveredDose> = {}
): CourseDeliveredDose => ({
  id: '10000000-0000-4000-a000-000000000003',
  status,
  course_revision_id: ids.revision,
  course_rule_id: ids.rule,
  course_slot_key: courseSlotKey(ids.revision, ids.rule, day, '08:00:00'),
  scheduled_day: day,
  scheduled_for: day + 'T08:00:00.000Z',
  entry_date: day,
  occurred_at: day + 'T08:00:00.000Z',
  ...patch,
});
const validate = (result: ReturnType<typeof buildInventoryForecast>) => {
  medicationForecastCoverageSchema.parse(result);
  medicationForecastCoverageSchema.parse(result.prepared_only);
  for (const container of result.containers)
    medicationForecastCoverageSchema.parse(container.coverage);
  return result;
};

describe('authored inventory projection cursor', () => {
  it('advances only forecast phases for consumed pending today and projected future slots', () => {
    const c = finite(),
      r = c.revisions[0]!;
    r.steps = [
      {
        id: ids.step,
        user_id: ids.owner,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: '20000000-0000-4000-a000-000000000001',
        user_id: ids.owner,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const snapshot = structuredClone(c),
      p = buildInventoryForecastPlan(context(c));
    expect(p.slots.map((s) => s.value)).toEqual(['1', '2', '2']);
    expect(p.slots[0]?.status).toBe('pending');
    expect(p.slots[1]?.status).toBe('projected');
    expect(c).toEqual(snapshot);
  });
  it('does not double-count an early actual explicitly credited to a later slot', () => {
    const c = finite('2026-11-19'),
      r = c.revisions[0]!;
    r.steps = [1, 2, 3, 4].map((dose, i) => ({
      id: `20000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
      user_id: ids.owner,
      revision_id: r.id,
      step_index: i,
      dose: String(dose),
      dose_unit: 'mg',
      duration_days: i === 3 ? null : 1,
    }));
    const p = context(c);
    p.actuals = [
      actual('2026-11-17', 'taken', { occurred_at: '2026-11-16T07:00:00Z' }),
    ];
    const out = buildInventoryForecastPlan(p);
    expect(out.slots.map((s) => [s.day, s.value])).toEqual([
      ['2026-11-16', '1'],
      ['2026-11-18', '3'],
      ['2026-11-19', '4'],
    ]);
  });
  it('uses full explicit actual history before the displayed week and excludes skipped/missed/fulfilled slots', () => {
    const c = finite('2026-11-19'),
      r = c.revisions[0]!;
    r.steps = [
      {
        id: ids.step,
        user_id: ids.owner,
        revision_id: r.id,
        step_index: 0,
        dose: '1',
        dose_unit: 'mg',
        duration_days: 1,
      },
      {
        id: '20000000-0000-4000-a000-000000000009',
        user_id: ids.owner,
        revision_id: r.id,
        step_index: 1,
        dose: '2',
        dose_unit: 'mg',
        duration_days: null,
      },
    ];
    const p = context(c);
    p.actuals = [
      actual('2026-11-01'),
      actual('2026-11-16', 'skipped', {
        id: '20000000-0000-4000-a000-000000000010',
      }),
    ];
    expect(
      buildInventoryForecastPlan(p).slots.map((s) => [s.day, s.value])
    ).toEqual([
      ['2026-11-17', '2'],
      ['2026-11-18', '2'],
      ['2026-11-19', '2'],
    ]);
  });
  it('aggregates every committed plan before the global 800-slot cap', () => {
    const a = medicationCourseFixture(),
      r = a.revisions[0]!;
    r.rules = ['08:00', '14:00', '20:00'].map((time, i) => ({
      ...r.rules[0]!,
      id: `30000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
      rule_index: i,
      time_of_day: time,
    }));
    const b = medicationCourseFixture();
    b.id = '30000000-0000-4000-a000-000000000010';
    b.current_revision_id = '30000000-0000-4000-a000-000000000011';
    b.revisions[0]!.id = b.current_revision_id;
    b.revisions[0]!.course_id = b.id;
    b.revisions[0]!.rules = [
      {
        ...b.revisions[0]!.rules[0]!,
        id: '30000000-0000-4000-a000-000000000012',
        revision_id: b.current_revision_id,
        time_of_day: '11:00',
      },
    ];
    const p = context(a);
    p.courses.push(b);
    p.devices[b.current_revision_id] = device;
    const out = buildInventoryForecastPlan(p);
    expect(out.slots).toHaveLength(800);
    expect(out.basis).toBe('slot_cap');
    expect(
      out.slots.slice(0, 4).map((s) => s.scheduled_at?.slice(11, 16))
    ).toEqual(['08:00', '11:00', '14:00', '20:00']);
    expect(out.slots.some((s) => s.plan_id === b.current_revision_id)).toBe(
      true
    );
    expect(out.coverage_end! < addDays(today, 365)).toBe(true);
  });
  it('retains a future-cut predecessor and switches to its successor without stock double demand', () => {
    const c = finite('2026-11-19'),
      old = c.revisions[0]!;
    old.status = 'completed';
    old.activity[0]!.until_at = '2026-11-18T00:00:00Z';
    old.closed_date = '2026-11-17';
    const next = structuredClone(old);
    next.id = '40000000-0000-4000-a000-000000000001';
    next.predecessor_id = old.id;
    next.revision_no = 2;
    next.status = 'active';
    next.start_date = '2026-11-18';
    next.closed_date = null;
    next.activity = [
      {
        ...old.activity[0]!,
        id: '40000000-0000-4000-a000-000000000002',
        revision_id: next.id,
        from_at: '2026-11-18T00:00:00Z',
        until_at: null,
      },
    ];
    next.rules = [
      {
        ...old.rules[0]!,
        id: '40000000-0000-4000-a000-000000000003',
        revision_id: next.id,
      },
    ];
    c.revisions.push(next);
    c.current_revision_id = next.id;
    const p = context(c);
    p.devices[next.id] = device;
    expect(
      buildInventoryForecastPlan(p).slots.map((s) => [s.day, s.plan_id])
    ).toEqual([
      ['2026-11-16', old.id],
      ['2026-11-17', old.id],
      ['2026-11-18', next.id],
      ['2026-11-19', next.id],
    ]);
  });
  it.each(['paused', 'completed', 'deleted', 'past-end', 'past-rule-end'])(
    'does not resurrect historical pending demand for stopped %s plans',
    (state) => {
      const c = medicationCourseFixture(),
        r = c.revisions[0]!;
      if (state === 'deleted') r.deleted_at = now;
      else if (state === 'past-end') r.end_date = '2026-11-15';
      else if (state === 'past-rule-end') r.rules[0]!.end_date = '2026-11-15';
      else {
        r.status = state as 'paused' | 'completed';
        r.activity[0]!.until_at = now;
      }
      const result = validate(buildInventoryForecast(input(context(c))));
      expect(result.status).toBe('unknown');
      expect(result.expected_slots).toBe(0);
    }
  );
  it('keeps end-today pending and future-start committed plans without extending their ends', () => {
    const c = finite(today);
    expect(
      buildInventoryForecastPlan(context(c)).slots.map((s) => s.day)
    ).toEqual([today]);
    c.revisions[0]!.start_date = '2026-11-18';
    c.revisions[0]!.end_date = '2026-11-19';
    expect(
      buildInventoryForecastPlan(context(c)).slots.map((s) => s.day)
    ).toEqual(['2026-11-18', '2026-11-19']);
  });
  it('does not fall back after an explicit saved device is deleted', () => {
    const c = finite();
    c.revisions[0]!.device_choice = 'explicit';
    c.revisions[0]!.device_id = null;
    const result = validate(buildInventoryForecast(input(context(c))));
    expect(result.status).toBe('unknown');
    expect(result.limitations).toContain('missing_device');
  });
});

describe('canonical physical prepared-stock walk', () => {
  it('distinguishes finite covered from depletion and respects API null-state invariants', () => {
    const result = validate(buildInventoryForecast(input(context(finite()))));
    expect(result).toMatchObject({
      status: 'covered',
      basis: 'course_end',
      coverage_through: '2026-11-18',
      depletion_date: null,
      reorder_by: null,
      days_left: null,
      served_slots: 3,
    });
  });
  it('retains exact decimal 0.3/0.1 consumption and canonical device-rounded yield', () => {
    const c = finite(),
      r = c.revisions[0]!;
    r.target_dose = '0.1';
    const a = validate(
      buildInventoryForecast(
        input(context(c), [prepared({ remaining_ml: '0.3' })])
      )
    );
    expect(a.status).toBe('covered');
    expect(a.containers[0]?.remaining_doses).toBe(3);
    r.end_date = null;
    r.target_dose = '500';
    r.dose_unit = 'mcg';
    const b = validate(
      buildInventoryForecast(
        input(context(c), [
          prepared({ remaining_ml: '2', concentration_mcg_ml: '7500' }),
        ])
      )
    );
    expect(b.served_slots).toBe(28);
    expect(b.containers[0]?.remaining_doses).toBe(28);
  });
  it('does not pool remnants or consume a draw blocked by nominal remaining-volume guard', () => {
    const c = finite();
    c.revisions[0]!.target_dose = '0.1';
    const noPool = validate(
      buildInventoryForecast(
        input(context(c), [
          prepared({ remaining_ml: '0.06' }),
          prepared({
            id: '50000000-0000-4000-a000-000000000001',
            remaining_ml: '0.06',
          }),
        ])
      )
    );
    expect(noPool.served_slots).toBe(0);
    expect(noPool.days_left).toBe(0);
    c.revisions[0]!.target_dose = '0.104';
    c.revisions[0]!.dose_unit = 'ml';
    const p = context(c);
    p.devices[ids.revision] = {
      ...device,
      device: { ...device.device, graduation_type: 'ml', increment: '0.1' },
    };
    const guard = validate(
      buildInventoryForecast(input(p, [prepared({ remaining_ml: '0.3' })]))
    );
    expect(guard.served_slots).toBe(2);
    expect(guard.containers[0]?.remaining_doses).toBe(2);
  });
  it('uses eligible-vial UI order: in-use, expiry ascending, creation descending', () => {
    const c = finite('2026-11-17');
    c.revisions[0]!.target_dose = '0.1';
    const a = prepared({
        remaining_ml: '0.1',
        expiry_date: today,
        usable_until: today,
        created_at: '2026-11-01T00:00:00Z',
      }),
      b = prepared({
        id: '50000000-0000-4000-a000-000000000002',
        remaining_ml: '0.1',
        expiry_date: '2026-12-01',
        usable_until: '2026-12-01',
        created_at: '2026-11-15T00:00:00Z',
      });
    expect(
      validate(buildInventoryForecast(input(context(c), [b, a]))).status
    ).toBe('covered');
    a.expiry_date = null;
    b.expiry_date = null;
    expect(
      validate(buildInventoryForecast(input(context(c), [a, b]))).served_slots
    ).toBe(1);
  });
  it('uses BUD through its named day and never treats an unknown BUD as unlimited', () => {
    const c = finite();
    const expiry = validate(
      buildInventoryForecast(
        input(context(c), [
          prepared({ remaining_ml: '100', usable_until: '2026-11-17' }),
        ])
      )
    );
    expect(expiry.served_slots).toBe(2);
    expect(expiry.depletion_date).toBe('2026-11-17');
    const unknown = validate(
      buildInventoryForecast(
        input(context(c), [
          prepared({ remaining_ml: '100', usable_until: null }),
        ])
      )
    );
    expect(unknown.status).toBe('unknown');
    expect(unknown.limitations).toContain('unknown_bud');
  });
  it('keeps known zero/expired stock distinct from missing or unknown stock', () => {
    const zero = validate(
      buildInventoryForecast(
        input(context(finite()), [
          prepared({ remaining_ml: '0', usable_until: null }),
        ])
      )
    );
    expect(zero).toMatchObject({
      status: 'reorder_now',
      days_left: 0,
      depletion_date: today,
    });
    const expired = validate(
      buildInventoryForecast(
        input(context(finite()), [prepared({ usable_until: '2026-11-15' })])
      )
    );
    expect(expired.days_left).toBe(0);
    expect(
      validate(buildInventoryForecast(input(context(finite()), []))).status
    ).toBe('unknown');
    expect(
      validate(
        buildInventoryForecast(
          input(context(finite()), [prepared({ remaining_ml: null })])
        )
      ).status
    ).toBe('unknown');
  });
  it.each(['missing', 'capacity', 'below-measurable', 'unit', 'route'])(
    'never invents a usable physical draw: %s',
    (kind) => {
      const c = finite(),
        p = context(c);
      if (kind === 'missing') p.devices[ids.revision] = null;
      if (kind === 'capacity') c.revisions[0]!.target_dose = '2';
      if (kind === 'below-measurable') c.revisions[0]!.target_dose = '0.0001';
      if (kind === 'unit') c.revisions[0]!.dose_unit = 'IU';
      if (kind === 'route')
        p.devices[ids.revision] = {
          ...device,
          device: { ...device.device, device_type: 'pump' },
        };
      const result = validate(
        buildInventoryForecast(input(p, [prepared({ remaining_ml: '100' })]))
      );
      expect(result.status).toBe('unknown');
      expect(result.reorder_by).toBeNull();
    }
  );
  it('rounds a saved real pump by its mL increment, never on an invented U100 barrel', () => {
    const c = finite();
    c.revisions[0]!.target_dose = '2';
    c.revisions[0]!.dose_unit = 'pumps';
    const p = context(c);
    p.route = 'nasal';
    p.devices[ids.revision] = {
      ...device,
      device: {
        ...device.device,
        device_type: 'pump',
        graduation_type: 'ml',
        increment: '0.1',
        capacity_units: 0,
      },
    };
    const result = validate(
      buildInventoryForecast(input(p, [prepared({ remaining_ml: '0.6' })]))
    );
    expect(result.status).toBe('covered');
    expect(result.containers[0]?.remaining_doses).toBe(3);
  });
  it('uses lead+buffer only for urgency and subtracts lead only for the reorder date, preserving zero', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(), [prepared({ remaining_ml: '18' })])
      )
    );
    expect(result).toMatchObject({
      status: 'reorder_now',
      days_left: 17,
      reorder_by: addDays(today, 3),
    });
    const data = input(context(), [prepared({ remaining_ml: '2' })]);
    data.lead_days = 0;
    data.buffer_days = 0;
    expect(validate(buildInventoryForecast(data))).toMatchObject({
      status: 'ok',
      days_left: 1,
      reorder_by: '2026-11-17',
    });
  });
  it('qualifies unrepresentable reorder dates for maximum valid preferences instead of throwing or clamping', () => {
    const data = input(context(), [prepared({ remaining_ml: '1' })]);
    data.lead_days = 2147483647;
    data.buffer_days = 2147483647;
    const result = validate(buildInventoryForecast(data));
    expect(result.status).toBe('unknown');
    expect(result.limitations).toContain('date_out_of_range');
    expect(result.reorder_by).toBeNull();
  });
});

describe('whole inventory qualification and dose ambiguity', () => {
  it('never converts conditional prepared depletion into a whole-stock alert when sealed stock is excluded', () => {
    const data = input(context(finite()), [prepared({ remaining_ml: '1' })]);
    data.stock_limitations = ['sealed_stock_excluded'];
    const result = validate(buildInventoryForecast(data));
    expect(result.status).toBe('unknown');
    expect(result.reorder_by).toBeNull();
    expect(result.prepared_only.status).toBe('reorder_now');
  });
  it('can prove bounded coverage with known usable stock despite extra excluded stock', () => {
    const data = input(context(finite()));
    data.stock_limitations = ['sealed_stock_excluded'];
    const result = validate(buildInventoryForecast(data));
    expect(result.status).toBe('covered');
    expect(result.limitations).toContain('sealed_stock_excluded');
  });
  it('does not let an unmodelled-demand gap claim coverage or purchase urgency in either scope', () => {
    const p = context(finite());
    p.limitations = ['unmodelled_legacy_demand'];
    const result = validate(buildInventoryForecast(input(p)));
    expect(result.status).toBe('unknown');
    expect(result.prepared_only.status).toBe('unknown');
    expect(result.containers[0]?.remaining_doses).toBeNull();
  });
  it('does not let one unknown or incompatible extra container veto independently proved coverage', () => {
    const data = input(context(finite()), [
      prepared({ remaining_ml: null, expiry_date: '2026-11-17' }),
      prepared({ id: '50000000-0000-4000-a000-000000000003' }),
    ]);
    expect(validate(buildInventoryForecast(data)).status).toBe('covered');
  });
  it('returns no single current-dose yield for different current rule targets within one revision', () => {
    const c = finite(),
      r = c.revisions[0]!;
    r.rules = [
      { ...r.rules[0]!, dose_amount: '1' },
      {
        ...r.rules[0]!,
        id: '60000000-0000-4000-a000-000000000001',
        rule_index: 1,
        time_of_day: '20:00',
        dose_amount: '2',
      },
    ];
    const result = validate(
      buildInventoryForecast(
        input(context(c), [prepared({ remaining_ml: '100' })])
      )
    );
    expect(result.containers[0]?.current_dose).toBeNull();
    expect(result.containers[0]?.remaining_doses).toBeNull();
  });
});

describe('proved static legacy demand uses only explicit schedule attribution', () => {
  const legacy = (): InventoryForecastLegacyPlan => ({
    id: '70000000-0000-4000-a000-000000000001',
    rule: {
      schedule_type_id: 'daily',
      start_date: today,
      end_date: '2026-11-18',
      time_of_day: '08:00',
      active: true,
    },
    dose_amount: '1',
    dose_unit: 'mg',
    timezone: 'Europe/London',
    device,
  });
  it('supports known fixed future rules without fabricating a course or phase history', () => {
    const p = context();
    p.courses = [];
    p.legacy_plans = [legacy()];
    p.legacy_actuals = [
      {
        id: '70000000-0000-4000-a000-000000000002',
        schedule_id: p.legacy_plans[0]!.id,
        entry_date: '2026-11-17',
        scheduled_for: today + 'T08:00:00Z',
        scheduled_day: today,
        status: 'taken',
      },
    ];
    const result = validate(buildInventoryForecast(input(p)));
    expect(result.expected_slots).toBe(2);
    expect(result.coverage_through).toBe('2026-11-18');
    expect(result.limitations).not.toContain('no_managed_plan');
  });
  it('never matches a historical slot by recorded date alone and discloses unassigned ambiguity', () => {
    const p = context();
    p.courses = [];
    p.legacy_plans = [legacy()];
    p.legacy_actuals = [
      {
        id: '70000000-0000-4000-a000-000000000002',
        schedule_id: p.legacy_plans[0]!.id,
        entry_date: today,
        status: 'taken',
      },
    ];
    const result = validate(buildInventoryForecast(input(p)));
    expect(result.status).toBe('unknown');
    expect(result.limitations).toContain('unmodelled_legacy_demand');
  });
});

it('does not let future authored phase changes alone make the actual-current target ambiguous', () => {
  const c = finite(),
    r = c.revisions[0]!;
  r.rules = [
    r.rules[0]!,
    {
      ...r.rules[0]!,
      id: '80000000-0000-4000-a000-000000000001',
      rule_index: 1,
      time_of_day: '20:00',
    },
  ];
  r.steps = [1, 2, 3].map((dose, index) => ({
    id: `80000000-0000-4000-a000-${String(index + 2).padStart(12, '0')}`,
    user_id: ids.owner,
    revision_id: r.id,
    step_index: index,
    dose: String(dose),
    dose_unit: 'mg',
    duration_days: index === 2 ? null : 1,
  }));
  const p = context(c);
  p.actuals = [
    actual('2026-11-14', 'taken', {
      id: '80000000-0000-4000-a000-000000000010',
    }),
    actual('2026-11-15', 'taken', {
      id: '80000000-0000-4000-a000-000000000011',
    }),
    actual(today, 'taken', { id: '80000000-0000-4000-a000-000000000012' }),
  ];
  const result = validate(
    buildInventoryForecast(
      input(p, [prepared({ remaining_ml: '2', concentration_mcg_ml: '10000' })])
    )
  );
  expect(result.containers[0]?.current_dose?.value).toBe('2');
  expect(result.containers[0]?.remaining_doses).toBe(10);
  expect(
    buildInventoryForecastPlan(p).slots.some((slot) => slot.value === '3')
  ).toBe(true);
});

describe('forecast pending boundaries', () => {
  const simultaneous = () => {
    const c = finite('2026-11-17');
    const r = c.revisions[0]!;
    r.rules.push({
      ...r.rules[0]!,
      id: '80000000-0000-4000-a000-000000000001',
      rule_index: 1,
    });
    return c;
  };
  it('keeps both genuine simultaneous pending rules in authored order', () => {
    const p = context(simultaneous());
    const slots = buildInventoryForecastPlan(p).slots.filter(
      (slot) => slot.day === today
    );
    expect(slots.map((slot) => slot.rule_id)).toEqual([
      ids.rule,
      '80000000-0000-4000-a000-000000000001',
    ]);
    expect(slots.map((slot) => slot.status)).toEqual(['pending', 'pending']);
  });
  it('credits a fulfilled simultaneous rule once without hiding its pending peer', () => {
    const p = context(simultaneous());
    p.actuals = [actual(today)];
    const slots = buildInventoryForecastPlan(p).slots.filter(
      (slot) => slot.day === today
    );
    expect(slots.map((slot) => slot.rule_id)).toEqual([
      '80000000-0000-4000-a000-000000000001',
    ]);
    expect(slots[0]?.status).toBe('pending');
  });
  it('respects the existing creation-day fallback of unbounded legacy rules', () => {
    const p = context();
    p.courses = [];
    p.legacy_plans = [
      {
        id: '80000000-0000-4000-a000-000000000002',
        rule: {
          schedule_type_id: 'daily',
          time_of_day: '08:00',
          created_at: '2026-11-17T00:30:00Z',
          end_date: '2026-11-18',
        },
        dose_amount: '1',
        dose_unit: 'mg',
        timezone: 'Europe/London',
        device,
      },
    ];
    expect(buildInventoryForecastPlan(p).slots.map((slot) => slot.day)).toEqual(
      ['2026-11-17', '2026-11-18']
    );
  });
});

const sealed = (
  patch: Partial<InventoryPreparedContainer> = {}
): InventoryPreparedContainer => ({
  id: '10000000-0000-4000-a000-0000000000a1',
  status: 'sealed',
  remaining_ml: null,
  concentration_mcg_ml: null,
  usable_until: null,
  opened_at: null,
  expiry_date: null,
  created_at: '2026-11-01T12:00:00Z',
  label_mass_mg: '10',
  sealed_bud_days: 28,
  ...patch,
});

describe('sealed vials counted by label mass', () => {
  it('covers a finite plan from sealed stock alone and reports how many doses a vial holds', () => {
    const result = validate(
      buildInventoryForecast(input(context(finite()), [sealed()]))
    );
    expect(result).toMatchObject({ status: 'covered', served_slots: 3 });
    expect(result.limitations).not.toContain('unknown_stock');
    expect(result.containers[0]?.remaining_doses).toBe(10);
  });
  it('charges each dose its nominal mass and runs out when the label mass is spent', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(finite()), [sealed({ label_mass_mg: '2' })])
      )
    );
    expect(result).toMatchObject({
      status: 'reorder_now',
      basis: 'depleted',
      served_slots: 2,
      depletion_date: '2026-11-17',
    });
  });
  it('starts the use-by clock at the first dose the walk draws', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(), [
          sealed({ label_mass_mg: '1000', sealed_bud_days: 3 }),
        ])
      )
    );
    expect(result.served_slots).toBe(4);
    expect(result.depletion_date).toBe('2026-11-19');
  });
  it('uses 28 use-by days when the medication sets none', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(), [
          sealed({ label_mass_mg: '1000', sealed_bud_days: null }),
        ])
      )
    );
    expect(result.served_slots).toBe(29);
    expect(result.depletion_date).toBe('2026-12-14');
  });
  it('stops at a stamped expiry that falls before the use-by', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(), [
          sealed({
            label_mass_mg: '1000',
            usable_until: '2026-11-17',
            expiry_date: '2026-11-17',
          }),
        ])
      )
    );
    expect(result.served_slots).toBe(2);
    expect(result.depletion_date).toBe('2026-11-17');
  });
  it('opens a sealed vial only after the prepared one is spent', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(finite()), [
          prepared({ remaining_ml: '1' }),
          sealed({ label_mass_mg: '2' }),
        ])
      )
    );
    expect(result).toMatchObject({ status: 'covered', served_slots: 3 });
    // Alone, the 2 mg vial serves only two of the three doses; the prepared vial gives the third.
    expect(
      result.containers.find((c) => c.container_id === sealed().id)?.coverage
        .served_slots
    ).toBe(2);
  });
  it('cannot size a dose in ml or units against a sealed vial', () => {
    const c = finite(),
      r = c.revisions[0]!;
    r.target_dose = '0.5';
    r.dose_unit = 'ml';
    const result = validate(
      buildInventoryForecast(input(context(c), [sealed()]))
    );
    expect(result.status).toBe('unknown');
  });
  it('does not count a sealed vial that has no label mass', () => {
    const result = validate(
      buildInventoryForecast(
        input(context(finite()), [sealed({ label_mass_mg: null })])
      )
    );
    expect(result.status).toBe('unknown');
  });
});
