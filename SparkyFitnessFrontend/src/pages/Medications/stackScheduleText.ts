import type { TFunction } from 'i18next';
import type {
  MedicationStack,
  MedicationStackMember,
  MedicationStackSchedule,
  StackMemberAction,
  StackNotFollowingReason,
  StackTimingView,
} from '@workspace/shared';

/** "1 Dec": a short calendar day that does not depend on the viewer's time zone. */
export function shortStackDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(date);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('day')} ${pick('month')}`.trim();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const weekdayName = (t: TFunction, index: number) => {
  const day = WEEKDAYS[index] ?? String(index);
  return t(`common.daysShort.${day}`, day);
};

/** "Daily at 08:00", "Mon, Thu at 20:00", "Every 3 days at 08:00 from 1 Dec", "5 days on, 2 off from 1 Dec". */
export function describeStackTiming(
  t: TFunction,
  timing: Pick<
    StackTimingView,
    | 'schedule_type_id'
    | 'time_of_day'
    | 'days_of_week'
    | 'interval_days'
    | 'cycle_on_days'
    | 'cycle_off_days'
    | 'start_date'
  >
): string {
  const time = timing.time_of_day ? timing.time_of_day.slice(0, 5) : null;
  const from = timing.start_date ? shortStackDay(timing.start_date) : null;
  let base: string;
  switch (timing.schedule_type_id) {
    case 'daily':
      base = t('medications.stacks.schedule.summary.daily', 'Daily');
      break;
    case 'weekly':
    case 'specific_days':
      base = (timing.days_of_week ?? []).length
        ? [...(timing.days_of_week ?? [])]
            .sort((a, b) => a - b)
            .map((day) => weekdayName(t, day))
            .join(', ')
        : t('medications.stacks.schedule.summary.noDays', 'No days chosen');
      break;
    case 'every_n_days':
      base = t(
        'medications.stacks.schedule.summary.everyN',
        'Every {{days}} days',
        { days: timing.interval_days ?? 0 }
      );
      break;
    case 'cyclic':
      base = t(
        'medications.stacks.schedule.summary.cycle',
        '{{on}} days on, {{off}} off',
        { on: timing.cycle_on_days ?? 0, off: timing.cycle_off_days ?? 0 }
      );
      break;
    case 'monthly':
      base = t('medications.stacks.schedule.summary.monthly', 'Monthly');
      break;
    case 'prn':
      base = t('medications.stacks.schedule.summary.prn', 'As needed');
      break;
    default:
      base = timing.schedule_type_id;
  }
  const parts = [base];
  if (time)
    parts.push(
      t('medications.stacks.schedule.summary.at', 'at {{time}}', { time })
    );
  if (from)
    parts.push(
      t('medications.stacks.schedule.summary.from', 'from {{date}}', {
        date: from,
      })
    );
  return parts.join(' ');
}

export const describeStackSchedule = (
  t: TFunction,
  schedule: MedicationStackSchedule
) => describeStackTiming(t, schedule);

export function notFollowingText(
  t: TFunction,
  reason: StackNotFollowingReason | null | undefined,
  otherStack?: string | null
): string {
  switch (reason) {
    case 'has_own_schedule':
      return t(
        'medications.stacks.schedule.notFollowing.hasOwn',
        'Not following: has its own schedule'
      );
    case 'paused':
      return t(
        'medications.stacks.schedule.notFollowing.paused',
        'Not following: paused'
      );
    case 'follows_other_stack':
      return t(
        'medications.stacks.schedule.notFollowing.otherStack',
        'Not following: follows {{stack}}',
        {
          stack:
            otherStack ??
            t('medications.stacks.schedule.otherStack', 'another stack'),
        }
      );
    case 'latest_not_applied':
      return t(
        'medications.stacks.schedule.notFollowing.latest',
        'Not following the latest schedule'
      );
    case 'only_as_needed':
      return t(
        'medications.stacks.schedule.notFollowing.asNeeded',
        'Not following: only as needed'
      );
    default:
      return t(
        'medications.stacks.schedule.notFollowing.notBound',
        'Not following: not tied to the schedule yet'
      );
  }
}

/** The chip on a member row; null when the stack has no schedule or the server did not say. */
export function memberScheduleChip(
  t: TFunction,
  stack: Pick<MedicationStack, 'schedule'>,
  member: MedicationStackMember
): { tone: 'ok' | 'wait' | 'warn'; text: string } | null {
  if (!stack.schedule) return null;
  switch (member.schedule_status) {
    case 'following':
      return {
        tone: 'ok',
        text: t('medications.stacks.schedule.following', 'Following'),
      };
    case 'pending':
      return {
        tone: 'wait',
        text: t('medications.stacks.schedule.waiting', 'Waiting for a plan'),
      };
    case 'not_following':
      return {
        tone: 'warn',
        text: notFollowingText(
          t,
          member.schedule_note,
          member.schedule_note_stack_name
        ),
      };
    default:
      return null;
  }
}

export function reviewActionText(
  t: TFunction,
  action: StackMemberAction,
  details: { effective: string; blocked: string }
): string {
  switch (action) {
    case 'edit':
      return t('medications.stacks.schedule.action.edit', 'Will change');
    case 'unchanged':
      return t('medications.stacks.schedule.action.same', 'Same');
    case 'pending':
      return t(
        'medications.stacks.schedule.action.pending',
        'Waiting for a plan'
      );
    case 'revise':
      return t(
        'medications.stacks.schedule.action.revise',
        'Will start a new revision on {{date}}',
        { date: details.effective }
      );
    case 'blocked':
      return t(
        'medications.stacks.schedule.action.blocked',
        'Left out: {{why}}',
        {
          why: details.blocked,
        }
      );
    case 'skipped':
      return t(
        'medications.stacks.schedule.action.skipped',
        'Plan finished, left as is'
      );
  }
}

/** The scheduled stack a medicine's plan timing is set by, if any. */
export function stackBindingFor(
  stacks: readonly MedicationStack[] | undefined,
  medicationId: string
): { stack: MedicationStack; schedule: MedicationStackSchedule } | null {
  for (const stack of stacks ?? []) {
    if (!stack.schedule) continue;
    const member = stack.members.find(
      (row) => row.medication_id === medicationId
    );
    if (member?.schedule_bound) return { stack, schedule: stack.schedule };
  }
  return null;
}
