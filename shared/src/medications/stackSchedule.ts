import type {
  MedicationCourseBucket,
  MedicationCoursePlanInput,
  MedicationCourseRuleInput,
} from '../schemas/api/MedicationCourses.api.zod.ts';
import {
  normalizeStackTime,
  type MedicationStackScheduleInput,
  type StackNotFollowingReason,
  type StackMemberAction,
  type StackTimingView,
} from '../schemas/api/MedicationStackSchedule.api.zod.ts';

/**
 * One definition of "timing" for a stack schedule: the pattern, the time of
 * day and the anchor of an interval or cycle. Doses, steps, end dates, notes,
 * devices and meal hints are never timing, so a stack never touches them.
 * The server apply, the edit guard, the review and the apps all use this.
 */
export type StackTiming = MedicationStackScheduleInput;
type TimingPlan = Pick<
  MedicationCoursePlanInput,
  'rules' | 'start_date' | 'cycle_anchor_date'
>;

const padTime = (time: string | null | undefined): string | null =>
  time ? (time.length === 5 ? `${time}:00` : time) : null;
const sortedDays = (days: number[] | null | undefined) =>
  [...new Set(days ?? [])].sort((a, b) => a - b);
const isAsNeeded = (rule: { schedule_type_id: string }) =>
  rule.schedule_type_id === 'prn';

/** Rules that follow a calendar; as-needed rules have no timing and stay as they are. */
export const stackTimedRules = <T extends { schedule_type_id: string }>(
  rules: T[]
): T[] => rules.filter((rule) => !isAsNeeded(rule));

function timingKey(parts: {
  type: string;
  time: string | null | undefined;
  days: number[] | null | undefined;
  interval: number | null | undefined;
  on: number | null | undefined;
  off: number | null | undefined;
  anchor: string | null | undefined;
}): string {
  const weekdays = parts.type === 'weekly' || parts.type === 'specific_days';
  return JSON.stringify([
    parts.type,
    padTime(parts.time),
    weekdays ? sortedDays(parts.days) : [],
    parts.type === 'every_n_days' ? (parts.interval ?? null) : null,
    parts.type === 'cyclic' ? (parts.on ?? null) : null,
    parts.type === 'cyclic' ? (parts.off ?? null) : null,
    parts.type === 'every_n_days' || parts.type === 'cyclic'
      ? (parts.anchor ?? null)
      : null,
  ]);
}

/** Where an interval or cycle rule counts from, as the recurrence engine reads it. */
function ruleAnchor(rule: MedicationCourseRuleInput, plan: TimingPlan) {
  if (rule.schedule_type_id === 'cyclic')
    return (
      plan.cycle_anchor_date ??
      rule.anchor_date ??
      rule.start_date ??
      plan.start_date
    );
  if (rule.schedule_type_id === 'every_n_days')
    return rule.anchor_date ?? rule.start_date ?? plan.start_date;
  return null;
}

export const stackScheduleKey = (schedule: StackTiming): string =>
  timingKey({
    type: schedule.schedule_type_id,
    time: schedule.time_of_day,
    days: schedule.days_of_week,
    interval: schedule.interval_days,
    on: schedule.cycle_on_days,
    off: schedule.cycle_off_days,
    anchor: schedule.start_date,
  });

/** One key per timed rule of a plan, in rule order. */
export const stackPlanKeys = (plan: TimingPlan): string[] =>
  stackTimedRules(plan.rules).map((rule) =>
    timingKey({
      type: rule.schedule_type_id,
      time: rule.time_of_day,
      days: rule.days_of_week,
      interval: rule.interval_days,
      on: rule.cycle_on_days,
      off: rule.cycle_off_days,
      anchor: ruleAnchor(rule, plan),
    })
  );

/** The member's rule with the stack's timing and its own dose, meal hint, start and end. */
export function stackRuleFor(
  schedule: StackTiming,
  rule: MedicationCourseRuleInput
): MedicationCourseRuleInput {
  const type = schedule.schedule_type_id;
  const counted = type === 'every_n_days' || type === 'cyclic';
  return {
    ...rule,
    schedule_type_id: type,
    time_of_day: schedule.time_of_day,
    days_of_week:
      type === 'specific_days' ? sortedDays(schedule.days_of_week) : null,
    interval_days: type === 'every_n_days' ? schedule.interval_days : null,
    day_of_month: null,
    cycle_on_days: type === 'cyclic' ? schedule.cycle_on_days : null,
    cycle_off_days: type === 'cyclic' ? schedule.cycle_off_days : null,
    anchor_date: counted ? schedule.start_date : null,
  };
}

/**
 * The plan with its timing replaced by the stack's. Several timed rules collapse
 * into the first one (keeping its dose); as-needed rules are kept. A plan-level
 * cycle anchor would override the rule's anchor, so a cyclic stack clears it.
 */
export function stackPlanFor<T extends TimingPlan>(
  schedule: StackTiming,
  plan: T
): T {
  const first = plan.rules.findIndex((rule) => !isAsNeeded(rule));
  if (first < 0) return plan;
  return {
    ...plan,
    cycle_anchor_date:
      schedule.schedule_type_id === 'cyclic' ? null : plan.cycle_anchor_date,
    rules: plan.rules.flatMap((rule, index) =>
      isAsNeeded(rule)
        ? [rule]
        : index === first
          ? [stackRuleFor(schedule, rule)]
          : []
    ),
  };
}

/** True when the plan already has exactly the stack's timing (doses ignored). */
export const stackTimingEquals = (
  schedule: StackTiming,
  plan: TimingPlan
): boolean => {
  const keys = stackPlanKeys(plan);
  return keys.length === 1 && keys[0] === stackScheduleKey(schedule);
};

/** True when a plan's timing differs from another's. */
export const stackTimingChanged = (
  before: TimingPlan,
  after: TimingPlan
): boolean =>
  JSON.stringify(stackPlanKeys(before)) !==
  JSON.stringify(stackPlanKeys(after));

/**
 * The edit guard: a follower's timing may not be changed by its own plan editor.
 * A request that keeps the plan's current timing, or sets exactly the stack's, passes.
 */
export const stackTimingViolatesSchedule = (
  schedule: StackTiming,
  before: TimingPlan,
  after: TimingPlan
): boolean =>
  stackTimingChanged(before, after) && !stackTimingEquals(schedule, after);

/** A schedule in the same shape the apps show a member's current timing in. */
export const stackScheduleView = (schedule: StackTiming): StackTimingView => ({
  schedule_type_id: schedule.schedule_type_id,
  time_of_day: normalizeStackTime(schedule.time_of_day),
  days_of_week:
    schedule.schedule_type_id === 'specific_days'
      ? sortedDays(schedule.days_of_week)
      : null,
  interval_days: schedule.interval_days,
  cycle_on_days: schedule.cycle_on_days,
  cycle_off_days: schedule.cycle_off_days,
  start_date: schedule.start_date,
});

/** A plan's timed rules in the display shape, so "today" can sit beside "new". */
export const stackPlanTiming = (plan: TimingPlan): StackTimingView[] =>
  stackTimedRules(plan.rules).map((rule) => {
    const weekdays =
      rule.schedule_type_id === 'weekly' ||
      rule.schedule_type_id === 'specific_days';
    return {
      schedule_type_id: rule.schedule_type_id,
      time_of_day: normalizeStackTime(rule.time_of_day),
      days_of_week: weekdays ? sortedDays(rule.days_of_week) : null,
      interval_days:
        rule.schedule_type_id === 'every_n_days'
          ? (rule.interval_days ?? null)
          : null,
      cycle_on_days:
        rule.schedule_type_id === 'cyclic'
          ? (rule.cycle_on_days ?? null)
          : null,
      cycle_off_days:
        rule.schedule_type_id === 'cyclic'
          ? (rule.cycle_off_days ?? null)
          : null,
      start_date: ruleAnchor(rule, plan),
    };
  });

export interface StackMemberFacts {
  schedule: StackTiming;
  /** The member's current plan; null when it has none. */
  plan: {
    bucket: MedicationCourseBucket;
    /** Delivered-dose history exists under the tip revision. */
    has_history: boolean;
    value: TimingPlan;
  } | null;
  /** A legacy schedule rule is still running for the medicine. */
  legacy_running: boolean;
  /** The name of another stack whose schedule the medicine already follows. */
  other_stack_name: string | null;
}
export interface StackMemberVerdict {
  action: StackMemberAction;
  reason: StackNotFollowingReason | null;
  /** Several timed rules will be replaced by one; the owner confirms. */
  needs_ack: boolean;
}

/** What a stack schedule does to one member, before any write. */
export function stackMemberVerdict(
  facts: StackMemberFacts
): StackMemberVerdict {
  const blocked = (reason: StackNotFollowingReason): StackMemberVerdict => ({
    action: 'blocked',
    reason,
    needs_ack: false,
  });
  if (facts.other_stack_name) return blocked('follows_other_stack');
  const plan = facts.plan;
  if (!plan)
    return facts.legacy_running
      ? blocked('has_own_schedule')
      : { action: 'pending', reason: null, needs_ack: false };
  // A finished plan has nothing to schedule; it adopts the schedule if a new plan starts.
  if (plan.bucket === 'completed' || plan.bucket === 'ended')
    return { action: 'skipped', reason: null, needs_ack: false };
  const timed = stackTimedRules(plan.value.rules);
  if (!timed.length) return blocked('only_as_needed');
  if (stackTimingEquals(facts.schedule, plan.value))
    return { action: 'unchanged', reason: null, needs_ack: false };
  if (plan.has_history && plan.bucket === 'paused') return blocked('paused');
  return {
    action: plan.has_history && plan.bucket === 'active' ? 'revise' : 'edit',
    reason: null,
    needs_ack: timed.length > 1,
  };
}
