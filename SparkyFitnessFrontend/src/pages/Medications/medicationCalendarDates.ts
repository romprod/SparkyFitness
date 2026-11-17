import { addDays, isDayString } from '@workspace/shared';

/** Navigation only: Monday civil label, independent of browser UTC offset. */
export function medicationCalendarMonday(day: string, today: string) {
  const label = isDayString(day) ? day : today;
  const weekday = new Date(`${label}T12:00:00Z`).getUTCDay();
  return addDays(label, -((weekday + 6) % 7));
}
