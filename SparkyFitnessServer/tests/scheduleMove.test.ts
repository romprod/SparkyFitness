import { describe, expect, it } from 'vitest';
import {
  lateDoseMove,
  rotateWeekdays,
  weekRotationMove,
  type MovableSchedule,
} from '@workspace/shared';

// 2026-11-16 is a Monday.
const weekly = (
  days: number[],
  extra: Partial<MovableSchedule> = {}
): MovableSchedule => ({
  id: 'rule-1',
  schedule_type_id: 'weekly',
  days_of_week: days,
  start_date: '2026-10-01',
  end_date: null,
  active: true,
  ...extra,
});
const every = (
  n: number,
  start: string,
  extra: Partial<MovableSchedule> = {}
): MovableSchedule => ({
  id: 'rule-1',
  schedule_type_id: 'every_n_days',
  interval_days: n,
  start_date: start,
  end_date: null,
  active: true,
  ...extra,
});

describe('rotateWeekdays', () => {
  it('moves days later and wraps the week', () => {
    expect(rotateWeekdays([1, 4], 1)).toEqual([2, 5]);
    expect(rotateWeekdays([5, 6], 2)).toEqual([0, 1]);
    expect(rotateWeekdays([1], 7)).toEqual([1]);
    expect(rotateWeekdays([3], -1)).toEqual([2]);
  });
});

describe('lateDoseMove, weekly', () => {
  it('moves a Monday schedule onto Wednesday after a late Wednesday dose', () => {
    const move = lateDoseMove({
      schedules: [weekly([1])],
      takenDays: ['2026-11-18'],
      today: '2026-11-18',
    });
    expect(move).toMatchObject({
      kind: 'weekly',
      schedule_ids: ['rule-1'],
      dose_day: '2026-11-18',
      planned_day: '2026-11-16',
      offset_days: 2,
      from_days: [1],
      to_days: [3],
      rotate_days: 2,
      end_date: '2026-11-18',
      new_start_date: '2026-11-19',
      next_day: '2026-11-25',
    });
  });

  it('rotates every weekday of a multi-day schedule together', () => {
    const move = lateDoseMove({
      schedules: [weekly([1, 4])],
      takenDays: ['2026-11-17'],
      today: '2026-11-17',
    })!;
    expect(move.from_days).toEqual([1, 4]);
    expect(move.to_days).toEqual([2, 5]);
    expect(move.next_day).toBe('2026-11-20');
  });

  it('treats an early dose as a move to the earlier day', () => {
    const move = lateDoseMove({
      schedules: [weekly([1])],
      takenDays: ['2026-11-15'],
      today: '2026-11-15',
    })!;
    expect(move.planned_day).toBe('2026-11-16');
    expect(move.offset_days).toBe(-1);
    expect(move.to_days).toEqual([0]);
    expect(move.rotate_days).toBe(6);
    expect(move.next_day).toBe('2026-11-22');
  });

  it('prefers the earlier planned day when two are equally near', () => {
    // Wednesday is one day from Tuesday and one from Thursday.
    const move = lateDoseMove({
      schedules: [weekly([2, 4])],
      takenDays: ['2026-11-18'],
      today: '2026-11-18',
    })!;
    expect(move.planned_day).toBe('2026-11-17');
    expect(move.offset_days).toBe(1);
  });

  it('skips a planned day that already has its own dose', () => {
    const move = lateDoseMove({
      schedules: [weekly([1, 4])],
      takenDays: ['2026-11-16', '2026-11-17'],
      today: '2026-11-17',
    })!;
    // Monday is done, so Tuesday's dose stands in for Thursday two days on.
    expect(move.planned_day).toBe('2026-11-19');
    expect(move.offset_days).toBe(-2);
    expect(move.to_days).toEqual([2, 6]);
    expect(move.next_day).toBe('2026-11-21');
  });

  it('offers nothing for an on-schedule dose', () => {
    expect(
      lateDoseMove({
        schedules: [weekly([1])],
        takenDays: ['2026-11-16'],
        today: '2026-11-16',
      })
    ).toBeNull();
  });

  it('offers nothing when the dose is older than the window', () => {
    expect(
      lateDoseMove({
        schedules: [weekly([1])],
        takenDays: ['2026-11-18'],
        today: '2026-11-21',
      })
    ).toBeNull();
  });

  it('offers nothing once the schedule was moved for that dose', () => {
    expect(
      lateDoseMove({
        schedules: [
          weekly([1], { id: 'old', end_date: '2026-11-18' }),
          weekly([3], { id: 'new', start_date: '2026-11-19' }),
        ],
        takenDays: ['2026-11-18'],
        today: '2026-11-19',
      })
    ).toBeNull();
  });

  it('ignores ended rules but not a second live rule', () => {
    const ended = weekly([3], { id: 'ended', end_date: '2026-11-01' });
    expect(
      lateDoseMove({
        schedules: [ended, weekly([1])],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).not.toBeNull();
    expect(
      lateDoseMove({
        schedules: [weekly([1], { id: 'a' }), weekly([1], { id: 'b' })],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).toBeNull();
  });

  it('offers nothing for daily, as-needed, inactive or empty schedules', () => {
    const daily = { ...weekly([]), schedule_type_id: 'daily' };
    const base = { takenDays: ['2026-11-18'], today: '2026-11-18' };
    expect(lateDoseMove({ ...base, schedules: [daily] })).toBeNull();
    expect(
      lateDoseMove({ ...base, schedules: [weekly([1], { active: false })] })
    ).toBeNull();
    expect(
      lateDoseMove({
        ...base,
        schedules: [{ ...weekly([1]), schedule_type_id: 'prn' }],
      })
    ).toBeNull();
    expect(lateDoseMove({ ...base, schedules: [weekly([])] })).toBeNull();
    expect(lateDoseMove({ ...base, schedules: [] })).toBeNull();
  });

  it('offers nothing when the dose predates the schedule', () => {
    expect(
      lateDoseMove({
        schedules: [weekly([1], { start_date: '2026-11-19' })],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).toBeNull();
  });

  it('offers nothing when the schedule ends before the moved rule would be due', () => {
    expect(
      lateDoseMove({
        schedules: [weekly([1], { end_date: '2026-11-20' })],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).toBeNull();
  });
});

describe('lateDoseMove, every N days', () => {
  it('counts N days on from an off-pattern dose', () => {
    // Grid: 2026-11-02, 11-09, 11-16, 11-23. Taken on the 18th.
    const move = lateDoseMove({
      schedules: [every(7, '2026-11-02')],
      takenDays: ['2026-11-18'],
      today: '2026-11-18',
    })!;
    expect(move).toMatchObject({
      kind: 'interval',
      interval_days: 7,
      dose_day: '2026-11-18',
      end_date: '2026-11-18',
      new_start_date: '2026-11-25',
      next_day: '2026-11-25',
      rotate_days: null,
      planned_day: null,
    });
  });

  it('offers nothing on the grid, with no start date, or after a roll', () => {
    expect(
      lateDoseMove({
        schedules: [every(7, '2026-11-02')],
        takenDays: ['2026-11-16'],
        today: '2026-11-16',
      })
    ).toBeNull();
    expect(
      lateDoseMove({
        schedules: [every(7, '2026-11-02', { start_date: null })],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).toBeNull();
    expect(
      lateDoseMove({
        schedules: [
          every(7, '2026-11-02', { id: 'old', end_date: '2026-11-18' }),
          every(7, '2026-11-25', { id: 'new' }),
        ],
        takenDays: ['2026-11-18'],
        today: '2026-11-19',
      })
    ).toBeNull();
  });

  it('does not treat every day as an interval', () => {
    expect(
      lateDoseMove({
        schedules: [every(1, '2026-11-02')],
        takenDays: ['2026-11-18'],
        today: '2026-11-18',
      })
    ).toBeNull();
  });
});

describe('weekRotationMove', () => {
  it('rotates every weekly rule of a medication from the given day', () => {
    const plan = weekRotationMove({
      schedules: [
        weekly([1], { id: 'a' }),
        weekly([1], { id: 'b' }),
        weekly([3], { id: 'gone', end_date: '2026-10-20' }),
      ],
      shift: 2,
      from: '2026-11-23',
    })!;
    expect(plan).toMatchObject({
      kind: 'weekly',
      schedule_ids: ['a', 'b'],
      end_date: '2026-11-22',
      new_start_date: '2026-11-23',
      rotate_days: 2,
      from_days: [1],
      to_days: [3],
      next_day: '2026-11-25',
    });
  });

  it('refuses a mixed or empty set, a zero shift, or a rule starting later', () => {
    const from = '2026-11-23';
    expect(
      weekRotationMove({
        schedules: [weekly([1]), every(7, '2026-11-02', { id: 'x' })],
        shift: 1,
        from,
      })
    ).toBeNull();
    expect(weekRotationMove({ schedules: [], shift: 1, from })).toBeNull();
    expect(
      weekRotationMove({ schedules: [weekly([1])], shift: 7, from })
    ).toBeNull();
    expect(
      weekRotationMove({
        schedules: [weekly([1], { start_date: '2026-11-30' })],
        shift: 1,
        from,
      })
    ).toBeNull();
  });
});
