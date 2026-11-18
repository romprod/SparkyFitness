import { describe, expect, it } from 'vitest';
import { comingWeekStart, smoothWeek } from '@workspace/shared';

// Sunday-first: index 0 = Sun … 6 = Sat.
const on = (...days: number[]) =>
  Array.from({ length: 7 }, (_, d) => (days.includes(d) ? 1 : 0));
const none = on();

describe('smoothing the week', () => {
  it('moves a weekly dose off a day that already has one', () => {
    const result = smoothWeek({
      movable: [
        { id: 'a', name: 'Alpha', counts: on(6) }, // Sat
        { id: 'b', name: 'Beta', counts: on(6) }, // Sat
      ],
      fixed: none,
    });
    expect(result.already_flat).toBe(false);
    expect(Math.max(...result.current)).toBe(2);
    expect(Math.max(...result.proposed)).toBe(1);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.shift).toBe(1); // the smallest move that helps
    expect(result.proposed.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('works around a fixed daily dose and keeps doses per week', () => {
    const result = smoothWeek({
      movable: [{ id: 'a', name: 'Alpha', counts: on(1, 2) }],
      fixed: [0, 0, 1, 0, 0, 0, 0],
    });
    // Alpha on Mon+Tue stacks Tuesday to 2; rotating off Tuesday evens the week.
    expect(Math.max(...result.current)).toBe(2);
    expect(Math.max(...result.proposed)).toBe(1);
    expect(result.proposed.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('reports an already flat week and moves nothing', () => {
    const flat = smoothWeek({
      movable: [{ id: 'a', name: 'Alpha', counts: on(6) }],
      fixed: none,
    });
    expect(flat).toEqual({
      current: on(6),
      proposed: on(6),
      moves: [],
      already_flat: true,
    });
    const nothing = smoothWeek({ movable: [], fixed: none });
    expect(nothing.already_flat).toBe(true);
  });

  it('counts but never moves anything past the search limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      name: `M${i}`,
      counts: on(0),
    }));
    const result = smoothWeek({ movable: many, fixed: none });
    expect(result.proposed.reduce((a, b) => a + b, 0)).toBe(8);
    expect(result.moves.length).toBeLessThanOrEqual(6);
  });

  it('starts the coming week on the next Monday, or today when it is Monday', () => {
    expect(comingWeekStart('2026-11-18')).toBe('2026-11-23'); // Wednesday
    expect(comingWeekStart('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(comingWeekStart('2026-11-22')).toBe('2026-11-23'); // Sunday
  });
});
