import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  addDays,
  courseBucket,
  coursePhaseActuals,
  medicationStackScheduleReviewSchema,
  stackMemberVerdict,
  stackPlanFor,
  stackPlanTiming,
  stackScheduleKey,
  stackScheduleView,
  type MedicationCourse,
  type MedicationCourseMutationResult,
  type MedicationCoursePlanInput,
  type MedicationCourseReviewInput,
  type MedicationCourseReviseInput,
  type MedicationCourseEditInput,
  type MedicationStackSchedule,
  type MedicationStackScheduleInput,
  type MedicationStackScheduleReview,
  type MedicationStackScheduleReviewMember,
  type MedicationStackScheduleSaveInput,
  type MedicationStackScheduleClearInput,
  type MedicationStackScheduleResult,
  type StackMemberAction,
  type StackNotFollowingReason,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import {
  courseActor,
  courseFingerprint,
  courseOperationReceipt,
  courseProblem,
  coursePlan,
  loadCourseActuals,
  loadCourseOwnerContext,
  loadCoursePhaseActuals,
  lockMedicationCourse,
  saveCourseReceipt,
} from '../models/medicationCourseRepository.js';
import {
  bindMedication,
  deleteSchedule,
  insertSchedule,
  loadSchedule,
  lockMedicinesAscending,
  lockStack,
  otherStackBindings,
  publicSchedule,
  stackBindings,
  stackMemberRows,
  updateSchedule,
  type StoredStackSchedule,
} from '../models/medicationStackScheduleRepository.js';
import {
  assertWrite,
  editCourseInTransaction,
  reviseCourseInTransaction,
  revisionReview,
  tip,
} from './medicationCourseService.js';

/**
 * One schedule per stack. Saving it rewrites every follower's timing in one
 * transaction. Lock order for every writer: the stack row, then each follower's
 * medicine by ascending id, then each follower's course (medicine, course,
 * revisions). Single-medicine writers never take the stack lock, so there is no
 * cycle. One receipt in medication_course_operations covers the whole save.
 */

type Receipt = MedicationCourseMutationResult & {
  stack_schedule: MedicationStackScheduleResult;
};

interface Member {
  medication_id: string;
  name: string;
  position: number;
  action: StackMemberAction;
  reason: StackNotFollowingReason | null;
  other_stack_name: string | null;
  needs_ack: boolean;
  timed_rules: number;
  course: MedicationCourse | null;
  current_timing: ReturnType<typeof stackPlanTiming> | null;
  fingerprint: string | null;
  edit: MedicationCourseEditInput | null;
  revise: MedicationCourseReviseInput | null;
  bound_here: boolean;
}
interface Prepared {
  stackName: string;
  existing: StoredStackSchedule | null;
  today: string;
  effective: string;
  members: Member[];
  skipped: string[];
  fingerprint: string;
}

const stackNotFound = () => courseProblem('Stack not found.', 404);

function blockerText(
  name: string,
  reason: StackNotFollowingReason,
  other: string | null
): string {
  switch (reason) {
    case 'has_own_schedule':
      return `${name} still has a schedule of its own. Hand it over to a plan first.`;
    case 'paused':
      return `Resume ${name} first, or take it out of the stack.`;
    case 'follows_other_stack':
      return `${name} already follows the schedule of the ${other} stack.`;
    case 'only_as_needed':
      return `${name} only has as-needed doses, so there is no timing to set.`;
    default:
      return `${name} cannot follow this schedule.`;
  }
}

async function liveCourseId(
  client: PoolClient,
  owner: string,
  medicationId: string
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT c.id FROM medication_courses c
     JOIN medication_course_revisions r ON r.id = c.current_revision_id AND r.user_id = c.user_id
     WHERE c.user_id = $1 AND c.medication_id = $2 AND c.deleted_at IS NULL AND r.deleted_at IS NULL
     ORDER BY (r.status <> 'completed') DESC, c.captured_at DESC, c.id LIMIT 1`,
    [owner, medicationId]
  );
  return rows[0]?.id ?? null;
}

async function legacyRunning(
  client: PoolClient,
  owner: string,
  medicationId: string,
  today: string
) {
  const { rows } = await client.query(
    `SELECT 1 FROM medication_schedules
     WHERE user_id = $1 AND medication_id = $2 AND active = true
       AND (end_date IS NULL OR end_date >= $3::date) LIMIT 1`,
    [owner, medicationId, today]
  );
  return rows.length > 0;
}

/**
 * Reads, under the locks, what the schedule would do to each member, and builds
 * the exact edit or revise input for the ones that change. Writes nothing.
 * `onlyIds` limits it to those members (members just added to the stack).
 */
async function prepare(
  client: PoolClient,
  owner: string,
  stackId: string,
  schedule: MedicationStackScheduleInput,
  requestedEffective: string | undefined,
  now: Date,
  onlyIds?: string[]
): Promise<Prepared> {
  const context = await loadCourseOwnerContext(client, owner, now);
  const today = context.today;
  const stack = await lockStack(client, owner, stackId);
  const existing = await loadSchedule(client, owner, stackId);
  const rows = await stackMemberRows(client, owner, stackId);
  const wanted = onlyIds ? new Set(onlyIds) : null;
  const chosen = rows.filter((row) => !wanted || wanted.has(row.medication_id));
  const ids = chosen.map((row) => row.medication_id);
  const medicines = await lockMedicinesAscending(client, owner, ids);
  const bindings = await stackBindings(client, owner, stackId);
  const others = await otherStackBindings(client, owner, stackId, ids);

  const byId = new Map<string, Member>();
  const loggedToday: boolean[] = [];
  let earliest = today;
  for (const id of [...ids].sort()) {
    const name = medicines.get(id)?.name ?? 'This medicine';
    const courseId = await liveCourseId(client, owner, id);
    const course = courseId
      ? await lockMedicationCourse(client, owner, courseId)
      : null;
    const revision = course ? tip(course) : null;
    const phase = course
      ? await loadCoursePhaseActuals(client, owner, course.id)
      : [];
    const hasHistory =
      course && revision
        ? coursePhaseActuals({ course, revision, delivered: phase }).length > 0
        : false;
    const current = revision ? coursePlan(revision) : null;
    const verdict = stackMemberVerdict({
      schedule,
      plan:
        revision && current
          ? {
              bucket: courseBucket(revision, today),
              has_history: hasHistory,
              value: current,
            }
          : null,
      legacy_running: revision
        ? false
        : await legacyRunning(client, owner, id, today),
      other_stack_name: others.get(id) ?? null,
    });
    const member: Member = {
      medication_id: id,
      name,
      position: chosen.find((row) => row.medication_id === id)!.position,
      action: verdict.action,
      reason: verdict.reason,
      other_stack_name: others.get(id) ?? null,
      needs_ack: verdict.needs_ack,
      timed_rules: current
        ? current.rules.filter((rule) => rule.schedule_type_id !== 'prn').length
        : 0,
      course,
      current_timing: current ? stackPlanTiming(current) : null,
      fingerprint: null,
      edit: null,
      revise: null,
      bound_here: bindings.has(id),
    };
    if (course && revision && current) {
      member.fingerprint = courseFingerprint({
        course_id: course.id,
        version: course.version,
        revision_id: revision.id,
        action: member.action,
        rules: current.rules,
      });
      if (member.action === 'revise') {
        const actuals = await loadCourseActuals(client, owner, course.id);
        loggedToday.push(
          actuals.some(
            (actual) =>
              actual.course_revision_id === revision.id &&
              String(actual.scheduled_day ?? actual.entry_date).slice(0, 10) ===
                today
          )
        );
        // The successor must start after the predecessor.
        if (addDays(revision.start_date, 1) > earliest)
          earliest = addDays(revision.start_date, 1);
      }
    }
    byId.set(id, member);
  }
  const dated = loggedToday.some(Boolean) ? addDays(today, 1) : today;
  const floor = dated > earliest ? dated : earliest;
  const effective = requestedEffective ?? floor;
  if (effective < floor)
    throw courseProblem(
      `Choose ${floor} or a later day for the schedule to start.`,
      422
    );

  // Now that the effective date is known, build the writes for the members that change.
  for (const member of byId.values()) {
    const course = member.course;
    if (!course) continue;
    const revision = tip(course);
    const base = stackPlanFor(schedule, coursePlan(revision));
    if (member.action === 'edit')
      member.edit = {
        ...base,
        expected_version: course.version,
        operation_id: randomUUID(),
      };
    if (member.action === 'revise') {
      const draft: MedicationCourseReviewInput = {
        ...base,
        start_date: effective,
        expected_version: course.version,
      };
      const actuals = await loadCourseActuals(client, owner, course.id);
      const phase = await loadCoursePhaseActuals(client, owner, course.id);
      const first = await revisionReview(
        client,
        owner,
        course,
        draft,
        actuals,
        phase,
        today
      );
      const final: MedicationCourseReviewInput = {
        ...draft,
        steps: first.carried_steps,
      };
      const reviewed = await revisionReview(
        client,
        owner,
        course,
        final,
        actuals,
        phase,
        today
      );
      member.revise = {
        ...(final as MedicationCoursePlanInput),
        expected_version: course.version,
        operation_id: randomUUID(),
        review_fingerprint: reviewed.review_fingerprint,
      };
      member.fingerprint = courseFingerprint({
        member: member.fingerprint,
        review: reviewed.review_fingerprint,
      });
    }
  }

  const members = [...byId.values()].sort(
    (a, b) =>
      a.position - b.position || (a.medication_id < b.medication_id ? -1 : 1)
  );
  const skipped = members
    .filter((member) => member.action === 'blocked')
    .map((member) => member.medication_id)
    .sort();
  return {
    stackName: stack.name,
    existing,
    today,
    effective,
    members,
    skipped,
    fingerprint: courseFingerprint({
      stack_id: stackId,
      version: existing?.version ?? 0,
      schedule,
      effective,
      members: members
        .map((member) => ({
          id: member.medication_id,
          action: member.action,
          ack: member.needs_ack,
          fingerprint: member.fingerprint,
          bound: member.bound_here,
          other: member.other_stack_name,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    }),
  };
}

function reviewMember(
  member: Member,
  schedule: MedicationStackScheduleInput
): MedicationStackScheduleReviewMember {
  const blockers = member.reason
    ? [blockerText(member.name, member.reason, member.other_stack_name)]
    : [];
  const warnings: string[] = [];
  if (member.needs_ack)
    warnings.push(
      `${member.name} has ${member.timed_rules} timed slots; the stack schedule will replace them with one.`
    );
  if (member.action === 'pending')
    warnings.push(
      `${member.name} has no plan yet. It follows the schedule when a plan is created.`
    );
  if (member.action === 'skipped')
    warnings.push(
      `${member.name} has no current plan. It follows the schedule when a new plan starts.`
    );
  return {
    medication_id: member.medication_id,
    name: member.name,
    action: member.action,
    current_timing: member.current_timing,
    new_timing: stackScheduleView(schedule),
    reason: member.reason,
    reason_stack_name: member.other_stack_name,
    blockers,
    warnings,
    needs_ack: member.needs_ack,
  };
}

async function transaction<T>(
  owner: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** What saving this schedule would do, member by member. Read only; the locks end with the call. */
export async function reviewStackSchedule(
  owner: string,
  stackId: string,
  input: {
    schedule: MedicationStackScheduleInput;
    effective_from?: string;
  },
  now = new Date()
): Promise<MedicationStackScheduleReview> {
  await assertWrite(owner);
  return transaction(owner, async (client) => {
    const prepared = await prepare(
      client,
      owner,
      stackId,
      input.schedule,
      input.effective_from,
      now
    );
    return medicationStackScheduleReviewSchema.parse({
      expected_version: prepared.existing?.version ?? 0,
      review_fingerprint: prepared.fingerprint,
      today: prepared.today,
      effective_from: prepared.effective,
      members: prepared.members.map((member) =>
        reviewMember(member, input.schedule)
      ),
      skipped_member_ids: prepared.skipped,
    });
  });
}

interface Applied {
  medication_id: string;
  action: StackMemberAction;
  course_id: string | null;
  revision_id: string | null;
  version: number | null;
}

/** Writes one follower's plan change and its binding; the caller owns the transaction. */
async function applyMember(
  client: PoolClient,
  owner: string,
  stackId: string,
  member: Member,
  version: number,
  now: Date
): Promise<Applied> {
  const applied: Applied = {
    medication_id: member.medication_id,
    action: member.action,
    course_id: member.course?.id ?? null,
    revision_id: null,
    version: null,
  };
  if (member.action === 'edit' && member.course && member.edit) {
    const result = await editCourseInTransaction(
      client,
      owner,
      member.course.id,
      member.edit
    );
    applied.revision_id = result.revision_id;
    applied.version = result.version;
  } else if (member.action === 'revise' && member.course && member.revise) {
    const result = await reviseCourseInTransaction(
      client,
      owner,
      member.course.id,
      member.revise,
      now
    );
    applied.revision_id = result.revision_id;
    applied.version = result.version;
  } else if (member.action === 'unchanged' && member.course) {
    const tipRevision = tip(member.course);
    applied.revision_id = tipRevision.id;
    applied.version = member.course.version;
  }
  if (
    member.action === 'unchanged' ||
    member.action === 'edit' ||
    member.action === 'revise'
  )
    await bindMedication(client, owner, stackId, member.medication_id, version);
  else if (member.action === 'pending' || member.action === 'skipped')
    await bindMedication(client, owner, stackId, member.medication_id, null);
  return applied;
}

const sameTiming = (
  a: MedicationStackScheduleInput,
  b: MedicationStackScheduleInput
) =>
  stackScheduleKey(a) === stackScheduleKey(b) &&
  a.start_date === b.start_date &&
  a.interval_days === b.interval_days;

/**
 * Creates or replaces the stack's schedule and applies it to every follower, or
 * nothing at all. A retry with the same operation id returns the first result.
 */
export async function saveStackSchedule(
  owner: string,
  stackId: string,
  input: MedicationStackScheduleSaveInput,
  now = new Date()
): Promise<{ result: MedicationStackScheduleResult; created: boolean }> {
  await assertWrite(owner);
  const hash = courseFingerprint({
    action: 'stack_schedule:set',
    input,
    context: { stack_id: stackId },
    actor: courseActor(owner),
  });
  return transaction(owner, async (client) => {
    const old = await courseOperationReceipt<Receipt>(
      client,
      owner,
      input.operation_id,
      hash
    );
    if (old) return { result: old.stack_schedule, created: false };

    const prepared = await prepare(
      client,
      owner,
      stackId,
      input.schedule,
      input.effective_from,
      now
    );
    if ((prepared.existing?.version ?? 0) !== input.expected_version)
      throw courseProblem(
        'The stack schedule changed. Refresh and review this draft again.'
      );
    if (prepared.fingerprint !== input.review_fingerprint)
      throw courseProblem(
        'The stack or its plans changed. Refresh the review while keeping this draft.'
      );
    const echoed = [...input.skipped_member_ids].sort();
    if (JSON.stringify(echoed) !== JSON.stringify(prepared.skipped))
      throw courseProblem(
        'The members left out of this save changed. Review the schedule again.'
      );
    for (const member of prepared.members)
      if (
        member.needs_ack &&
        !input.acknowledged_member_ids.includes(member.medication_id)
      )
        throw courseProblem(
          `Confirm that ${member.name}'s several slots are replaced by the stack schedule.`,
          422
        );

    const created = !prepared.existing;
    const stored = !prepared.existing
      ? await insertSchedule(client, owner, stackId, input.schedule)
      : sameTiming(prepared.existing, input.schedule)
        ? prepared.existing
        : await updateSchedule(client, owner, stackId, input.schedule);
    const applied: Applied[] = [];
    for (const member of prepared.members)
      applied.push(
        await applyMember(client, owner, stackId, member, stored.version, now)
      );
    const result: MedicationStackScheduleResult = {
      operation_id: input.operation_id,
      schedule: publicSchedule(stored) as MedicationStackSchedule,
      applied,
    };
    const receipt: Receipt = {
      course_id: applied.find((entry) => entry.course_id)?.course_id ?? stackId,
      revision_id: null,
      version: stored.version,
      operation_id: input.operation_id,
      stack_schedule: result,
    };
    await saveCourseReceipt(client, owner, 'stack_schedule:set', hash, receipt);
    return { result, created };
  });
}

/** Removes the schedule and its bindings. Every plan keeps the rules it has. */
export async function clearStackSchedule(
  owner: string,
  stackId: string,
  input: MedicationStackScheduleClearInput
): Promise<void> {
  await assertWrite(owner);
  const hash = courseFingerprint({
    action: 'stack_schedule:clear',
    input,
    context: { stack_id: stackId },
    actor: courseActor(owner),
  });
  await transaction(owner, async (client) => {
    const old = await courseOperationReceipt(
      client,
      owner,
      input.operation_id,
      hash
    );
    if (old) return;
    await lockStack(client, owner, stackId);
    const existing = await loadSchedule(client, owner, stackId);
    if (!existing) throw stackNotFound();
    if (existing.version !== input.expected_version)
      throw courseProblem(
        'The stack schedule changed. Refresh before removing it.'
      );
    await deleteSchedule(client, owner, stackId);
    await saveCourseReceipt(client, owner, 'stack_schedule:clear', hash, {
      course_id: stackId,
      revision_id: null,
      version: existing.version,
      operation_id: input.operation_id,
    });
  });
}

/**
 * Membership edits on a scheduled stack: each added medicine is bound, and its
 * plan takes the schedule when it has one. Runs inside the stack update's
 * transaction (the stack row is locked). A membership edit never fails because
 * of a schedule: a medicine that cannot follow stays an unbound member, and a
 * failing apply is rolled back to a savepoint and left unbound.
 */
export async function bindAddedStackMembers(
  client: PoolClient,
  owner: string,
  stackId: string,
  added: string[],
  now = new Date()
): Promise<void> {
  if (!added.length) return;
  const schedule = await loadSchedule(client, owner, stackId);
  if (!schedule) return;
  await assertWrite(owner);
  const prepared = await prepare(
    client,
    owner,
    stackId,
    schedule,
    undefined,
    now,
    added
  );
  for (const member of prepared.members) {
    // Several timed slots need the owner's confirmation, which a membership edit cannot ask for.
    if (member.action === 'blocked' || member.needs_ack) continue;
    await client.query('SAVEPOINT stack_member');
    try {
      await applyMember(client, owner, stackId, member, schedule.version, now);
      await client.query('RELEASE SAVEPOINT stack_member');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT stack_member');
      await client.query('RELEASE SAVEPOINT stack_member');
    }
  }
}
