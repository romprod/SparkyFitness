import { describe, expect, it } from 'vitest';
import {
  afterMidnightGrace,
  DAY_ROLLOVER_GRACE_HOURS,
  nextGraceBoundary,
} from '@workspace/shared';

const at = (iso: string) => new Date(iso);

describe('afterMidnightGrace', () => {
  it('uses a two hour grace', () => {
    expect(DAY_ROLLOVER_GRACE_HOURS).toBe(2);
  });

  it('is active at 00:30 and 01:59 London time', () => {
    const a = afterMidnightGrace(at('2026-11-27T00:30:00Z'), 'Europe/London');
    expect(a).toMatchObject({
      active: true,
      today: '2026-11-27',
      yesterday: '2026-11-26',
    });
    expect(a.endsAt?.toISOString()).toBe('2026-11-27T02:00:00.000Z');
    const b = afterMidnightGrace(at('2026-11-27T01:59:00Z'), 'Europe/London');
    expect(b.active).toBe(true);
    expect(b.yesterday).toBe('2026-11-26');
  });

  it('is not active at 02:00 or 23:59', () => {
    for (const iso of ['2026-11-27T02:00:00Z', '2026-11-27T23:59:00Z']) {
      const r = afterMidnightGrace(at(iso), 'Europe/London');
      expect(r.active).toBe(false);
      expect(r.endsAt).toBeNull();
      expect(r.today).toBe('2026-11-27');
    }
  });

  it('crosses a year boundary', () => {
    const r = afterMidnightGrace(at('2027-01-01T00:30:00Z'), 'Europe/London');
    expect(r).toMatchObject({
      active: true,
      today: '2027-01-01',
      yesterday: '2026-12-31',
    });
  });

  it('uses the local date when it differs from the UTC date', () => {
    // 15:30 UTC on 26 Nov is 01:30 on 27 Nov in Brisbane (UTC+10).
    const brisbane = afterMidnightGrace(
      at('2026-11-26T15:30:00Z'),
      'Australia/Brisbane'
    );
    expect(brisbane).toMatchObject({
      active: true,
      today: '2026-11-27',
      yesterday: '2026-11-26',
    });
    expect(brisbane.endsAt?.toISOString()).toBe('2026-11-26T16:00:00.000Z');
    // 08:30 UTC on 27 Nov is 00:30 on 27 Nov in Los Angeles (UTC-8).
    const la = afterMidnightGrace(
      at('2026-11-27T08:30:00Z'),
      'America/Los_Angeles'
    );
    expect(la).toMatchObject({ active: true, today: '2026-11-27' });
    // 23:30 UTC on 26 Nov is 15:30 on 26 Nov in Los Angeles.
    expect(
      afterMidnightGrace(at('2026-11-26T23:30:00Z'), 'America/Los_Angeles')
        .active
    ).toBe(false);
  });

  it('copes with the clocks going forward in London', () => {
    // 29 Mar 2026: 01:00 UTC becomes 02:00 BST, so 00:30 is the last half hour before the jump.
    const before = afterMidnightGrace(
      at('2026-03-29T00:30:00Z'),
      'Europe/London'
    );
    expect(before.active).toBe(true);
    expect(before.endsAt?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // 01:00 UTC is already 02:00 BST, so the grace is over.
    expect(
      afterMidnightGrace(at('2026-03-29T01:00:00Z'), 'Europe/London').active
    ).toBe(false);
  });

  it('copes with the clocks going back in London', () => {
    // 25 Oct 2026: 01:00 BST repeats as 01:00 GMT, so the grace runs three real hours.
    const first = afterMidnightGrace(
      at('2026-10-24T23:30:00Z'),
      'Europe/London'
    );
    expect(first).toMatchObject({ active: true, today: '2026-10-25' });
    const repeated = afterMidnightGrace(
      at('2026-10-25T01:30:00Z'),
      'Europe/London'
    );
    expect(repeated.active).toBe(true);
    expect(repeated.endsAt?.toISOString()).toBe('2026-10-25T02:00:00.000Z');
    expect(
      afterMidnightGrace(at('2026-10-25T02:00:00Z'), 'Europe/London').active
    ).toBe(false);
  });
});

describe('nextGraceBoundary', () => {
  it('is 02:00 while active and the next midnight otherwise', () => {
    expect(
      nextGraceBoundary(
        at('2026-11-27T00:30:00Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-11-27T02:00:00.000Z');
    expect(
      nextGraceBoundary(
        at('2026-11-27T10:00:00Z'),
        'Europe/London'
      ).toISOString()
    ).toBe('2026-11-28T00:00:00.000Z');
  });
});
