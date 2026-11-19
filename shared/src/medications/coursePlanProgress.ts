/**
 * Where a plan stands today, from its own dates: "Day 10 of 91", "starts in 4
 * days". Calendar days only: it says nothing about doses taken or due.
 */
export type CoursePlanProgress =
  | { kind: 'not_started'; starts_in_days: number; start_date: string }
  | { kind: 'running'; day: number; of: number | null; end_date: string | null }
  | { kind: 'finished'; end_date: string }
  | { kind: 'unknown' };

const days = (from: string, to: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
};

export function coursePlanProgress(row: {
  start_date: string | null;
  end_date: string | null;
  local_today: string;
}): CoursePlanProgress {
  const { start_date: start, end_date: end, local_today: today } = row;
  if (!start) return { kind: 'unknown' };
  if (today < start)
    return {
      kind: 'not_started',
      starts_in_days: days(today, start),
      start_date: start,
    };
  if (end && today > end) return { kind: 'finished', end_date: end };
  return {
    kind: 'running',
    day: days(start, today) + 1,
    of: end ? days(start, end) + 1 : null,
    end_date: end,
  };
}
