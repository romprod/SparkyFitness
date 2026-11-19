import { describe, expect, it } from 'vitest';
import {
  addDays,
  planDoseReminders,
  unloggedDosesToday,
  DEFAULT_DOSE_REMINDER_SETTINGS,
  type MedicationLogWeekResponse,
  type MedicationLogWeekPlannedSlot,
} from '@workspace/shared';

const today = '2026-11-19';
const lane = (id: string, name: string, is_supplement = false) => ({
  id: `medication:${id}`,
  medication_id: id,
  name,
  is_supplement,
});
const ids = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
};
const slot = (
  med: string,
  time: string | null,
  changes: Partial<MedicationLogWeekPlannedSlot> = {}
): MedicationLogWeekPlannedSlot => ({
  id: `slot-${med}-${time}`,
  lane_id: `medication:${med}`,
  medication_id: med,
  plan_kind: 'legacy',
  timezone: 'Europe/London',
  scheduled_day: today,
  scheduled_for: time ? `${today}T${time}:00.000Z` : null,
  time_of_day: time ? `${time}:00` : null,
  status: 'planned',
  dose_amount: '1',
  dose_unit: 'tablet',
  dose_qualification: 'configured',
  course_id: null,
  course_revision_id: null,
  course_rule_id: null,
  course_step_id: null,
  course_slot_key: null,
  course_expected_version: null,
  schedule_id: null,
  ...changes,
});
const week = (
  planned_slots: MedicationLogWeekPlannedSlot[],
  changes: Partial<MedicationLogWeekResponse> = {}
): MedicationLogWeekResponse => ({
  as_of: `${today}T12:00:00Z`,
  today,
  timezone: 'Europe/London',
  week_start: '2026-11-16',
  days: Array.from({ length: 7 }, (_, i) => addDays('2026-11-16', i)),
  lanes: [
    lane(ids.a, 'Sertraline'),
    lane(ids.b, 'Omega 3', true),
    lane(ids.c, 'Magnesium', true),
  ],
  planned_slots,
  actuals: [],
  fulfilled_slots: [],
  coverage: [],
  ...changes,
});
const at = (clock: string) => new Date(`${today}T${clock}:00Z`);

describe('dose reminder planning', () => {
  it('groups everything due at one clock time into a single notification', () => {
    const plan = planDoseReminders(
      week([slot(ids.b, '09:00'), slot(ids.c, '09:00'), slot(ids.a, '21:00')]),
      at('09:02')
    );
    expect(plan.day).toBe(today);
    expect(plan.events).toEqual([
      {
        key: 'due@09:00',
        title: '2 doses are due',
        body: '09:00 · Magnesium, Omega 3',
        tag: 'sparky-dose-09:00',
        url: '/medications',
      },
    ]);
  });

  it('fires from five minutes before until thirty minutes after, never outside', () => {
    const data = week([slot(ids.a, '21:00')]);
    expect(planDoseReminders(data, at('20:54')).events).toHaveLength(0);
    expect(planDoseReminders(data, at('20:55')).events[0]?.title).toBe(
      'Sertraline is due'
    );
    expect(planDoseReminders(data, at('21:30')).events).toHaveLength(1);
    expect(planDoseReminders(data, at('21:31')).events).toHaveLength(0);
  });

  it('skips logged, skipped and other-day doses, and fulfilled slots', () => {
    const data = week(
      [
        slot(ids.a, '09:00', { status: 'taken' }),
        slot(ids.b, '09:00', { status: 'skipped' }),
        slot(ids.c, '09:00', { id: 'fulfilled' }),
        slot(ids.a, '09:00', { id: 'tomorrow', scheduled_day: '2026-11-20' }),
      ],
      {
        fulfilled_slots: [
          {
            planned_id: 'fulfilled',
            actual: {} as MedicationLogWeekResponse['actuals'][number],
          },
        ],
      }
    );
    expect(planDoseReminders(data, at('09:00')).events).toEqual([]);
  });

  it('reminds doses with no set time at the chosen time in the owner timezone', () => {
    const data = week([slot(ids.a, null)], { timezone: 'Australia/Brisbane' });
    // 08:00 in Brisbane is 22:00 UTC the day before.
    const plan = planDoseReminders(data, new Date('2026-11-18T22:01:00Z'), {
      ...DEFAULT_DOSE_REMINDER_SETTINGS,
      untimed_time: '08:00',
    });
    expect(plan.events.map((e) => e.key)).toEqual(['due@08:00']);
  });

  it('can leave supplements out', () => {
    const settings = {
      ...DEFAULT_DOSE_REMINDER_SETTINGS,
      include_supplements: false,
    };
    const data = week([slot(ids.b, '09:00'), slot(ids.a, '09:00')]);
    expect(planDoseReminders(data, at('09:00'), settings).events).toEqual([
      expect.objectContaining({ title: 'Sertraline is due' }),
    ]);
    expect(unloggedDosesToday(data, settings).map((i) => i.name)).toEqual([
      'Sertraline',
    ]);
  });

  it('sends one catch-up listing only doses whose time has already passed', () => {
    const data = week([
      slot(ids.b, '09:00'),
      slot(ids.a, '21:00'),
      slot(ids.c, '09:00', { status: 'taken' }),
    ]);
    const plan = planDoseReminders(data, at('18:00'));
    expect(plan.events).toEqual([
      expect.objectContaining({
        key: 'catch-up',
        title: '1 dose still to log today',
        body: 'Omega 3',
      }),
    ]);
  });

  it('sends no catch-up when nothing is pending or when it is turned off', () => {
    const data = week([slot(ids.a, '21:00')]);
    expect(planDoseReminders(data, at('18:00')).events).toEqual([]);
    const late = week([slot(ids.a, '09:00')]);
    expect(
      planDoseReminders(late, at('18:00'), {
        ...DEFAULT_DOSE_REMINDER_SETTINGS,
        nag_enabled: false,
      }).events
    ).toEqual([]);
  });

  it('never puts a dose amount in the text', () => {
    const plan = planDoseReminders(
      week([slot(ids.a, '09:00', { dose_amount: '250', dose_unit: 'mg' })]),
      at('09:00')
    );
    expect(JSON.stringify(plan.events)).not.toMatch(/250|mg/);
  });

  it('shortens long lists', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `medication:m${i}`,
      medication_id: null,
      name: `Item ${i}`,
      is_supplement: false,
    }));
    const slots = many.map((l, i) =>
      slot(`m${i}`, '09:00', { lane_id: l.id, id: `s${i}` })
    );
    const plan = planDoseReminders(week(slots, { lanes: many }), at('09:00'));
    expect(plan.events[0]?.body).toBe(
      '09:00 · Item 0, Item 1, Item 2, Item 3 and 2 more'
    );
  });
});
