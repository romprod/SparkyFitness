import { addDays, daysBetween } from '../utils/timezone.ts';

/**
 * What a course's weekly on/off cycle should say today: a countdown to the planned stop, the last
 * day, a planned break, or a restart. Pure and advisory: the dates come from the server's cycle
 * state and nothing here ends or starts a cycle. Text never carries a dose amount.
 */

export type CourseCyclePhase =
  'none' | 'scheduled' | 'on' | 'off' | 'ended' | 'restart_due';

export type CourseCycleAlertKind =
  | 'ending_soon'
  | 'last_dose'
  | 'stop_now'
  | 'off_cycle'
  | 'restart_soon'
  | 'restart_now';

/** info = ambient context; warn = act soon; action = act today. */
export type CourseCycleAlertLevel = 'info' | 'warn' | 'action';

/** Days before a phase boundary the banner starts to warn. */
export const COURSE_CYCLE_WARN_DAYS = 7;

export interface CourseCycleAlertInput {
  phase: CourseCyclePhase;
  today: string;
  planned_stop_date: string | null;
  next_restart_date: string | null;
}

export interface CourseCycleAlertResult {
  kind: CourseCycleAlertKind;
  level: CourseCycleAlertLevel;
  /** Days left in the current phase counting today; days until restart during a break; 0 once ended. */
  days: number;
  /** The planned last dose day, or the restart day, depending on the kind. */
  date: string | null;
}

export function courseCycleAlert(
  input: CourseCycleAlertInput
): CourseCycleAlertResult | null {
  const { phase, today } = input;
  const stop = input.planned_stop_date;
  const restart = input.next_restart_date;

  if (phase === 'on') {
    if (!stop) return null;
    const left = daysBetween(today, stop) + 1;
    if (left < 1) return null;
    if (left === 1)
      return { kind: 'last_dose', level: 'action', days: 1, date: stop };
    if (left <= COURSE_CYCLE_WARN_DAYS)
      return { kind: 'ending_soon', level: 'warn', days: left, date: stop };
    return null;
  }

  if (phase === 'ended') {
    if (!stop) return null;
    const since = daysBetween(stop, today);
    return {
      kind: 'stop_now',
      level: since <= 7 ? 'action' : 'warn',
      days: 0,
      date: stop,
    };
  }

  if (phase === 'restart_due')
    return {
      kind: 'restart_now',
      level: 'action',
      days: 0,
      date: restart ?? addDays(today, 0),
    };

  if (phase === 'off') {
    if (!restart) return null;
    const until = daysBetween(today, restart);
    if (until < 0) return null;
    return until <= COURSE_CYCLE_WARN_DAYS
      ? { kind: 'restart_soon', level: 'warn', days: until, date: restart }
      : { kind: 'off_cycle', level: 'info', days: until, date: restart };
  }

  return null;
}

/** Only alerts worth a banner: ambient off-cycle status stays quiet. */
export function isCourseCycleBannerAlert(
  alert: CourseCycleAlertResult | null
): boolean {
  return !!alert && alert.level !== 'info';
}
