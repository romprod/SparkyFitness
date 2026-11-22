import { describe, expect, it } from 'vitest';
import {
  isLifeEventDay,
  lifeEventDayCounts,
  lifeEventInputSchema,
  lifeEventShades,
  LIFE_EVENT_MAX_DAYS,
  type LifeEventWindow,
} from '@workspace/shared';

const window = (
  id: string,
  kind: LifeEventWindow['kind'],
  start_day: string,
  end_day: string,
  label: string | null = null
): LifeEventWindow => ({ id, kind, start_day, end_day, label });

describe('an illness, travel or other window', () => {
  const parse = (value: unknown) => lifeEventInputSchema.safeParse(value);

  it('takes a kind, a start day, an optional end day, a label and notes', () => {
    const out = parse({
      kind: 'illness',
      start_day: '2026-11-10',
      end_day: '2026-11-14',
      label: ' flu ',
      notes: ' stayed in bed ',
    });
    expect(out.success && out.data).toEqual({
      kind: 'illness',
      start_day: '2026-11-10',
      end_day: '2026-11-14',
      label: 'flu',
      notes: 'stayed in bed',
    });
  });

  it('reads a blank end day as the start day only, and blank text as none', () => {
    for (const end of [undefined, null]) {
      const out = parse({
        kind: 'travel',
        start_day: '2026-11-10',
        end_day: end,
        label: '   ',
        notes: null,
      });
      expect(out.success && out.data).toEqual({
        kind: 'travel',
        start_day: '2026-11-10',
        end_day: '2026-11-10',
        label: null,
        notes: null,
      });
    }
  });

  it('allows up to 120 days counting both ends, and no more', () => {
    expect(LIFE_EVENT_MAX_DAYS).toBe(120);
    expect(
      parse({ kind: 'other', start_day: '2026-01-01', end_day: '2026-04-30' })
        .success
    ).toBe(true);
    const tooLong = parse({
      kind: 'other',
      start_day: '2026-01-01',
      end_day: '2026-05-01',
    });
    expect(tooLong.success).toBe(false);
    expect(!tooLong.success && tooLong.error.issues[0]?.path).toEqual([
      'end_day',
    ]);
  });

  it('refuses an end day before the start day', () => {
    const out = parse({
      kind: 'other',
      start_day: '2026-11-10',
      end_day: '2026-11-09',
    });
    expect(out.success).toBe(false);
    expect(!out.success && out.error.issues[0]?.message).toMatch(
      /on or after the start day/
    );
  });

  it('refuses a day that is not on the calendar, an unknown kind and overlong text', () => {
    const base = { kind: 'illness', start_day: '2026-11-10' };
    expect(parse({ ...base, start_day: '2026-02-31' }).success).toBe(false);
    expect(parse({ ...base, start_day: '10/11/2026' }).success).toBe(false);
    expect(parse({ ...base, end_day: '2026-13-01' }).success).toBe(false);
    expect(parse({ ...base, kind: 'holiday' }).success).toBe(false);
    expect(parse({ ...base, label: 'x'.repeat(61) }).success).toBe(false);
    expect(parse({ ...base, label: 'x'.repeat(60) }).success).toBe(true);
    expect(parse({ ...base, notes: 'x'.repeat(2001) }).success).toBe(false);
    expect(parse({ start_day: '2026-11-10' }).success).toBe(false);
  });
});

describe('windows on a range of days', () => {
  const flu = window('flu', 'illness', '2026-11-10', '2026-11-14', 'flu');
  const trip = window('trip', 'travel', '2026-11-13', '2026-11-20');
  const cold = window('cold', 'illness', '2026-11-12', '2026-11-16');
  const old = window('old', 'other', '2026-09-01', '2026-09-03');

  it('knows whether a day is inside a window, both ends included', () => {
    expect(isLifeEventDay([flu], '2026-11-10')).toBe(true);
    expect(isLifeEventDay([flu], '2026-11-14')).toBe(true);
    expect(isLifeEventDay([flu], '2026-11-09')).toBe(false);
    expect(isLifeEventDay([flu], '2026-11-15')).toBe(false);
    expect(isLifeEventDay([], '2026-11-10')).toBe(false);
  });

  it('counts the days covered per kind, once however many windows overlap', () => {
    const counts = lifeEventDayCounts(
      [flu, trip, cold],
      '2026-11-01',
      '2026-11-30'
    );
    // Illness: the 10th to the 16th, the flu and the cold overlapping on 12-14: 7 days.
    expect(counts.illness).toBe(7);
    // Travel: the 13th to the 20th.
    expect(counts.travel).toBe(8);
    expect(counts.other).toBe(0);
    // The 10th to the 20th, either kind: 11 days.
    expect(counts.any).toBe(11);
  });

  it('counts only the days inside the range, both of its ends included', () => {
    expect(lifeEventDayCounts([flu], '2026-11-12', '2026-11-13')).toEqual({
      illness: 2,
      travel: 0,
      other: 0,
      any: 2,
    });
    expect(lifeEventDayCounts([flu], '2026-11-14', '2026-11-20').illness).toBe(
      1
    );
    expect(lifeEventDayCounts([flu], '2026-11-15', '2026-11-20').any).toBe(0);
  });

  it('counts nothing for no windows or a backwards range', () => {
    const none = { illness: 0, travel: 0, other: 0, any: 0 };
    expect(lifeEventDayCounts([], '2026-11-01', '2026-11-30')).toEqual(none);
    expect(lifeEventDayCounts([flu], '2026-11-30', '2026-11-01')).toEqual(none);
  });

  it('cuts each overlapping window to the range and leaves out the rest', () => {
    const shades = lifeEventShades(
      [trip, old, flu],
      '2026-11-12',
      '2026-11-16'
    );
    expect(shades).toEqual([
      {
        id: 'flu',
        kind: 'illness',
        label: 'flu',
        from_day: '2026-11-12',
        to_day: '2026-11-14',
      },
      {
        id: 'trip',
        kind: 'travel',
        label: null,
        from_day: '2026-11-13',
        to_day: '2026-11-16',
      },
    ]);
  });

  it('keeps a window that touches only the first or last day of the range', () => {
    expect(
      lifeEventShades([flu], '2026-11-14', '2026-11-20').map((s) => s.from_day)
    ).toEqual(['2026-11-14']);
    expect(
      lifeEventShades([flu], '2026-11-01', '2026-11-10').map((s) => s.to_day)
    ).toEqual(['2026-11-10']);
    expect(lifeEventShades([flu], '2026-11-15', '2026-11-20')).toEqual([]);
  });
});
