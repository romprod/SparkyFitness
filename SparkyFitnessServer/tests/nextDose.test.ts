import { describe, expect, it } from 'vitest';
import {
  nextDoseWhen,
  nextDosesByMedication,
  type NextDoseSlot,
} from '@workspace/shared';

const tz = 'Europe/London';
const slot = (patch: Partial<NextDoseSlot> = {}): NextDoseSlot => ({
  id: 'slot-1',
  medication_id: 'med-a',
  scheduled_day: '2026-11-26',
  scheduled_for: '2026-11-26T19:00:00.000Z',
  time_of_day: '19:00:00',
  status: 'planned',
  dose_amount: '0.25',
  dose_unit: 'mg',
  ...patch,
});
const now = '2026-11-22T10:00:00.000Z';

describe('next planned dose per medication', () => {
  it('takes the earliest slot still to come for each medication, soonest first', () => {
    const result = nextDosesByMedication({
      now,
      timezone: tz,
      slots: [
        slot({ id: 'a-late', scheduled_for: '2026-12-03T19:00:00.000Z' }),
        slot({ id: 'a-early' }),
        slot({
          id: 'b',
          medication_id: 'med-b',
          scheduled_day: '2026-11-22',
          scheduled_for: '2026-11-22T13:00:00.000Z',
          dose_amount: '2',
          dose_unit: 'mg',
        }),
      ],
    });
    expect(result.map((r) => [r.medication_id, r.slot_id, r.time])).toEqual([
      ['med-b', 'b', '13:00'],
      ['med-a', 'a-early', '19:00'],
    ]);
    expect(result[0]).toMatchObject({ dose_amount: '2', dose_unit: 'mg' });
  });
  it('ignores slots already past, taken, skipped or missed, and unknown medications', () => {
    expect(
      nextDosesByMedication({
        now,
        timezone: tz,
        slots: [
          slot({ id: 'past', scheduled_for: '2026-11-22T09:00:00.000Z' }),
          slot({ id: 'taken', status: 'taken' }),
          slot({ id: 'skipped', status: 'skipped' }),
          slot({ id: 'missed', status: 'missed' }),
          slot({ id: 'none', medication_id: null }),
        ],
      })
    ).toEqual([]);
  });
  it('counts a pending slot that is still ahead', () => {
    expect(
      nextDosesByMedication({
        now,
        timezone: tz,
        slots: [slot({ status: 'pending' })],
      })
    ).toHaveLength(1);
  });
  it('limits to the medications asked for', () => {
    const slots = [slot(), slot({ id: 'b', medication_id: 'med-b' })];
    expect(
      nextDosesByMedication({
        now,
        timezone: tz,
        slots,
        medication_ids: new Set(['med-b']),
      }).map((r) => r.medication_id)
    ).toEqual(['med-b']);
  });
  it('reads the local clock time in the person’s zone, including summer time', () => {
    const [dose] = nextDosesByMedication({
      now: '2026-07-01T00:00:00.000Z',
      timezone: tz,
      slots: [
        slot({
          scheduled_day: '2026-07-10',
          scheduled_for: '2026-07-10T12:00:00.000Z',
        }),
      ],
    });
    expect(dose?.time).toBe('13:00');
  });
  it('treats an untimed slot as the start of its day with no time', () => {
    const [dose] = nextDosesByMedication({
      now,
      timezone: tz,
      slots: [
        slot({
          scheduled_for: null,
          time_of_day: null,
          scheduled_day: '2026-11-23',
        }),
      ],
    });
    expect(dose).toMatchObject({ time: null, at: '2026-11-23T00:00:00.000Z' });
  });
  it('breaks a tie on the same instant by slot id', () => {
    const [dose] = nextDosesByMedication({
      now,
      timezone: tz,
      slots: [slot({ id: 'z' }), slot({ id: 'a' })],
    });
    expect(dose?.slot_id).toBe('a');
  });
});

describe('wording when the next dose is', () => {
  const when = (at: string, from = now) => nextDoseWhen(at, from, tz);
  it('counts down only a dose later the same day', () => {
    expect(when('2026-11-22T13:20:00.000Z')).toEqual({
      kind: 'later_today',
      hours: 3,
      minutes: 20,
    });
    expect(when('2026-11-22T10:14:00.000Z')).toEqual({
      kind: 'later_today',
      hours: 0,
      minutes: 14,
    });
  });
  it('says now within the minute and overdue once past', () => {
    expect(when('2026-11-22T10:00:20.000Z')).toEqual({ kind: 'now' });
    expect(when('2026-11-22T09:00:00.000Z')).toEqual({ kind: 'overdue' });
  });
  it('names a later day: tomorrow, the weekday up to six days out, then the date', () => {
    expect(when('2026-11-23T08:00:00.000Z')).toEqual({ kind: 'tomorrow' });
    expect(when('2026-11-24T08:00:00.000Z')).toEqual({
      kind: 'weekday',
      day: '2026-11-24',
    });
    expect(when('2026-11-28T08:00:00.000Z')).toEqual({
      kind: 'weekday',
      day: '2026-11-28',
    });
    expect(when('2026-11-29T08:00:00.000Z')).toEqual({
      kind: 'date',
      day: '2026-11-29',
    });
  });
  it('counts days in the person’s own zone, not UTC', () => {
    // 00:30 on 11 July in London is still 10 July in UTC; 09:00 London is the same London day.
    expect(
      when('2026-07-11T08:00:00.000Z', '2026-07-10T23:30:00.000Z')
    ).toEqual({ kind: 'later_today', hours: 8, minutes: 30 });
  });
});
