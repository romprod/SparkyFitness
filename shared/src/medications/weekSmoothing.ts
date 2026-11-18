import { addDays, dayOfWeek } from '../utils/timezone.ts';

/** A weekly pattern: doses on each weekday, Sunday (0) to Saturday (6). */
export type WeekCounts = number[];

export interface SmoothItem {
  id: string;
  name: string;
  /** Doses on each weekday, Sunday first. */
  counts: WeekCounts;
}

export interface SmoothMove {
  id: string;
  name: string;
  /** Days later (1-6) every dose moves; the weekly count is unchanged. */
  shift: number;
  from_days: number[];
  to_days: number[];
}

export interface SmoothResult {
  current: WeekCounts;
  proposed: WeekCounts;
  moves: SmoothMove[];
  /** True when no rotation makes the week any flatter. */
  already_flat: boolean;
}

/** Items beyond this are left unmoved: the search tries every rotation of every item. */
export const SMOOTH_MAX_MOVABLE = 6;

const sum = (a: readonly number[], b: readonly number[]) =>
  a.map((n, i) => n + b[i]!);
const rotate = (counts: readonly number[], shift: number): WeekCounts =>
  counts.map((_, day) => counts[(day - shift + 7) % 7]!);
const daysOf = (counts: readonly number[]) =>
  counts.flatMap((n, day) => (n > 0 ? [day] : []));
const score = (week: readonly number[]): [number, number] => [
  Math.max(...week),
  week.reduce((total, n) => total + n * n, 0),
];

/**
 * Where the weekly pattern of each movable item should sit so the busiest day is as light as
 * possible, then the week as even as possible, then with the fewest and smallest moves. Doses per
 * week, amounts and times never change; only the weekdays rotate. Fixed items (daily, every N
 * days, anything not a plain weekly pattern) are counted but never moved.
 */
export function smoothWeek(input: {
  movable: readonly SmoothItem[];
  fixed: WeekCounts;
}): SmoothResult {
  const items = input.movable.slice(0, SMOOTH_MAX_MOVABLE);
  const extra = input.movable.slice(SMOOTH_MAX_MOVABLE);
  const base = extra.reduce(
    (week, item) => sum(week, item.counts),
    input.fixed
  );
  const current = items.reduce((week, item) => sum(week, item.counts), base);
  let best = { shifts: items.map(() => 0), week: current, moved: 0, far: 0 };
  const search = (index: number, shifts: number[], week: WeekCounts) => {
    if (index === items.length) {
      const [peak, spread] = score(week);
      const [bestPeak, bestSpread] = score(best.week);
      const moved = shifts.filter((s) => s !== 0).length;
      const far = shifts.reduce((n, s) => n + Math.min(s, 7 - s), 0);
      if (
        peak < bestPeak ||
        (peak === bestPeak && spread < bestSpread) ||
        (peak === bestPeak &&
          spread === bestSpread &&
          (moved < best.moved || (moved === best.moved && far < best.far)))
      )
        best = { shifts: [...shifts], week, moved, far };
      return;
    }
    for (let shift = 0; shift < 7; shift++)
      search(
        index + 1,
        [...shifts, shift],
        sum(week, rotate(items[index]!.counts, shift))
      );
  };
  search(0, [], base);
  const flatterThanNow =
    score(best.week)[0] < score(current)[0] ||
    (score(best.week)[0] === score(current)[0] &&
      score(best.week)[1] < score(current)[1]);
  if (!flatterThanNow)
    return { current, proposed: current, moves: [], already_flat: true };
  return {
    current,
    proposed: best.week,
    already_flat: false,
    moves: items.flatMap((item, i) => {
      const shift = best.shifts[i]!;
      if (shift === 0) return [];
      return [
        {
          id: item.id,
          name: item.name,
          shift,
          from_days: daysOf(item.counts),
          to_days: daysOf(rotate(item.counts, shift)),
        },
      ];
    }),
  };
}

/** The Monday a "coming week" strip starts on: today if it is a Monday, else the next one. */
export function comingWeekStart(today: string): string {
  const monday = (dayOfWeek(today) + 6) % 7;
  return monday === 0 ? today : addDays(today, 7 - monday);
}
