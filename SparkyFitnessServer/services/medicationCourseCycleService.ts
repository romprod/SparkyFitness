import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  addDays,
  instantToDay,
  dayToUtcRange,
  courseSlotsForDay,
  coursePhaseFamilyId,
  coursePhaseFrequency,
  medicationCourseCycleStateSchema,
  medicationCourseCycleReviewSchema,
  medicationCourseCycleMutationResultSchema,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCourseCycleState,
  type MedicationCourseCycleReview,
  type MedicationCourseCycleReviewInput,
  type MedicationCourseCycleActionInput,
  type MedicationCourseCycleMutationResult,
} from '@workspace/shared';
import {
  courseTransaction,
  courseOperation,
  currentCourseTip,
  assertCourseVersion,
  assertCourseWrite,
} from './medicationCourseService.js';
import { courseCycleDates } from './medicationCourseCycleCalendar.js';
import { loadCourseDevice } from './medicationCourseDeviceService.js';
import {
  loadMedicationCourse,
  lockMedicationCourse,
  loadCourseActuals,
  loadCoursePhaseActuals,
  courseFingerprint,
  courseProblem,
  coursePlan,
  deliveredCourseInputs,
  insertCourseRevision,
  type CourseActual,
  type CoursePhaseActual,
} from '../models/medicationCourseRepository.js';

type StoredFact = Pick<
  CoursePhaseActual,
  'entry_date' | 'occurred_at' | 'scheduled_day' | 'scheduled_for'
>;
function factDays(row: StoredFact, zone: string): string[] {
  const days = [row.entry_date];
  if (row.scheduled_day) days.push(row.scheduled_day);
  if (row.occurred_at && Number.isFinite(Date.parse(row.occurred_at)))
    days.push(instantToDay(row.occurred_at, zone));
  if (row.scheduled_for && Number.isFinite(Date.parse(row.scheduled_for)))
    days.push(instantToDay(row.scheduled_for, zone));
  return days;
}
function effectiveEnd(
  revision: MedicationCourseRevision,
  planned: string | null
): string | null {
  if (planned === null) return revision.end_date;
  return revision.end_date !== null && revision.end_date < planned
    ? revision.end_date
    : planned;
}
function originalStart(course: MedicationCourse): string {
  return [...course.revisions].sort((a, b) => a.revision_no - b.revision_no)[0]!
    .start_date;
}
function weeklyAnchor(
  course: MedicationCourse,
  revision: MedicationCourseRevision
): string | null {
  return revision.course_cycle_on_weeks === null
    ? null
    : (revision.course_cycle_anchor_date ?? originalStart(course));
}
function relevantStoredFacts(
  _course: MedicationCourse,
  revision: MedicationCourseRevision,
  actuals: CourseActual[],
  phase: CoursePhaseActual[]
): StoredFact[] {
  // Current original attribution plus retained detached facts; prior linked revisions keep their own boundaries.
  return [
    ...actuals.filter((row) => row.course_revision_id === revision.id),
    ...phase.filter(
      (row) =>
        row.course_revision_id === null &&
        row.phase_family_id === coursePhaseFamilyId(revision)
    ),
  ];
}
export function buildCourseCycleState(
  course: MedicationCourse,
  medicationActive: boolean,
  actuals: CourseActual[],
  phaseActuals: CoursePhaseActual[],
  now: Date
): MedicationCourseCycleState {
  const revision = currentCourseTip(course),
    today = instantToDay(now, course.timezone),
    anchor = weeklyAnchor(course, revision);
  const on = revision.course_cycle_on_weeks,
    off = revision.course_cycle_off_weeks;
  const dates = courseCycleDates(on, off, anchor),
    end = effectiveEnd(revision, dates.planned_stop_date);
  const endReasons: string[] = [],
    startReasons: string[] = [];
  const origin = course.revisions.find(
    (row) => row.id === coursePhaseFamilyId(revision)
  );
  if (
    !origin ||
    (origin.id !== revision.id && origin.phase_origin_context === null)
  ) {
    const reason =
      'The phase origin context is unavailable. Review the existing authored plan rather than resetting progression.';
    endReasons.push(reason);
    startReasons.push(reason);
  }
  if (on === null || anchor === null) {
    endReasons.push('Configure an optional weekly cycle plan first.');
    startReasons.push('Configure an optional weekly cycle plan first.');
  }
  if (revision.status !== 'active')
    endReasons.push(
      'Use the existing lifecycle controls to resume this current revision before marking its cycle complete.'
    );
  if (end === null || end >= today)
    endReasons.push(
      'The effective planned cycle stop must have passed. Use existing lifecycle controls for an earlier stop.'
    );
  if (end !== null && end < revision.start_date)
    endReasons.push(
      'The planned boundary precedes this revision start. Review the existing authored plan.'
    );
  if (revision.status === 'paused')
    startReasons.push(
      'Resume this paused current revision before starting the next cycle.'
    );
  if (!medicationActive)
    startReasons.push(
      'The medication is inactive. Enable it explicitly before starting a cycle.'
    );
  if (today <= revision.start_date)
    startReasons.push(
      'A new cycle must start on a day after the current revision start.'
    );
  if (off !== null) {
    if (dates.next_restart_date === null || today < dates.next_restart_date)
      startReasons.push('The configured break has not ended.');
  } else if (end === null || today <= end)
    startReasons.push(
      'The current effective cycle end must have passed before a manual next cycle.'
    );
  const facts = relevantStoredFacts(course, revision, actuals, phaseActuals);
  if (
    end !== null &&
    facts.some((row) => factDays(row, course.timezone).some((day) => day > end))
  )
    endReasons.push(
      'Later stored dose, skip, snooze or timing facts would be contradicted. Keep this history and use an existing-plan or prospective lifecycle correction.'
    );
  if (
    facts.some((row) =>
      factDays(row, course.timezone).some((day) => day >= today)
    )
  )
    startReasons.push(
      'Same-day or future stored history would be contradicted by the new revision boundary. Keep the recorded facts and review the existing plan.'
    );
  let cyclePhase: MedicationCourseCycleState['phase'] = 'none';
  if (on !== null && anchor !== null) {
    if (today < anchor) cyclePhase = 'scheduled';
    else if (
      dates.next_restart_date !== null &&
      today >= dates.next_restart_date
    )
      cyclePhase = 'restart_due';
    else if (
      dates.planned_stop_date !== null &&
      today <= dates.planned_stop_date
    )
      cyclePhase = 'on';
    else cyclePhase = off === null ? 'ended' : 'off';
  }
  return medicationCourseCycleStateSchema.parse({
    course_id: course.id,
    revision_id: revision.id,
    version: course.version,
    timezone: course.timezone,
    today,
    original_start_date: originalStart(course),
    on_weeks: on,
    off_weeks: off,
    anchor_date: anchor,
    phase: cyclePhase,
    ...dates,
    end_cycle: { allowed: endReasons.length === 0, reasons: endReasons },
    start_next_cycle: {
      allowed: startReasons.length === 0,
      reasons: startReasons,
    },
    advisory: true,
  });
}
function originContextCourse(
  course: MedicationCourse,
  revision: MedicationCourseRevision
): MedicationCourse {
  const rootId = coursePhaseFamilyId(revision);
  return {
    ...course,
    revisions: course.revisions.map((row) =>
      row.id === rootId &&
      row.id === revision.id &&
      row.phase_origin_context === null
        ? {
            ...row,
            phase_origin_context: {
              start_date: row.start_date,
              end_date: row.end_date,
            },
          }
        : row
    ),
  };
}
function startPlan(revision: MedicationCourseRevision, today: string) {
  const plan = coursePlan(revision);
  return {
    ...plan,
    start_date: today,
    end_date: courseCycleDates(revision.course_cycle_on_weeks, null, today)
      .planned_stop_date!,
    rules: plan.rules.map((rule) => {
      if (
        rule.schedule_type_id !== 'cyclic' &&
        rule.schedule_type_id !== 'every_n_days'
      )
        return rule;
      if (
        (rule.anchor_date !== null && rule.anchor_date !== undefined) ||
        (rule.start_date !== null && rule.start_date !== undefined) ||
        (rule.schedule_type_id === 'cyclic' &&
          revision.cycle_anchor_date !== null)
      )
        return rule;
      return { ...rule, anchor_date: revision.start_date };
    }),
  };
}
function previewRevisionId(revision: MedicationCourseRevision): string {
  const value = courseFingerprint({
    purpose: 'course-cycle-preview',
    revision: revision.id,
  });
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function firstDue(
  course: MedicationCourse,
  revision: MedicationCourseRevision,
  phaseActuals: CoursePhaseActual[],
  now: Date
): MedicationCourseCycleReview['first_due'] {
  const today = instantToDay(now, course.timezone),
    plan = startPlan(revision, today),
    id = previewRevisionId(revision);
  const successor: MedicationCourseRevision = {
    ...revision,
    ...plan,
    id,
    predecessor_id: revision.id,
    revision_no: revision.revision_no + 1,
    status: 'active',
    closed_date: null,
    course_cycle_anchor_date: today,
    phase_family_id: coursePhaseFamilyId(revision),
    phase_origin_context: null,
    activity: [
      {
        id,
        revision_id: id,
        user_id: course.user_id,
        from_at: now.toISOString(),
        until_at: null,
      },
    ],
    rules: revision.rules.map((rule, index) => ({
      ...rule,
      ...plan.rules[index],
      revision_id: id,
    })),
    steps: revision.steps.map((step) => ({ ...step, revision_id: id })),
  };
  const preview = {
    ...originContextCourse(course, revision),
    current_revision_id: id,
    revisions: [...originContextCourse(course, revision).revisions, successor],
  };
  for (let day = today; day <= plan.end_date; day = addDays(day, 1)) {
    const slot = courseSlotsForDay({
      course: preview,
      day,
      today,
      nowInstant: now.toISOString(),
      medicationActive: true,
      delivered: [],
      phaseDelivered: deliveredCourseInputs(phaseActuals),
    }).find((row) => row.course_revision_id === id);
    if (slot)
      return {
        scheduled_day: slot.scheduled_day,
        scheduled_for: slot.scheduled_for,
        time_of_day: slot.time_of_day,
      };
  }
  return null;
}
export function buildCourseCycleReview(
  course: MedicationCourse,
  medicationActive: boolean,
  actuals: CourseActual[],
  phaseActuals: CoursePhaseActual[],
  input: MedicationCourseCycleReviewInput,
  deviceProof: unknown,
  now: Date
): MedicationCourseCycleReview {
  assertCourseVersion(course, input.expected_version);
  const revision = currentCourseTip(course),
    cycle = buildCourseCycleState(
      course,
      medicationActive,
      actuals,
      phaseActuals,
      now
    ),
    start = input.action === 'start';
  const reasons = start
    ? cycle.start_next_cycle.reasons
    : cycle.end_cycle.reasons;
  const due =
    start && reasons.length === 0
      ? firstDue(course, revision, phaseActuals, now)
      : null;
  const continuity =
    revision.steps.length === 0
      ? 'not_applicable'
      : coursePhaseFrequency({
            course: originContextCourse(course, revision),
            revision,
          }) === null
        ? 'unknown'
        : 'retained';
  const result = {
    action: input.action,
    cycle,
    effective_day: cycle.today,
    candidate_end_date: start
      ? null
      : effectiveEnd(revision, cycle.planned_stop_date),
    new_start_date: start ? cycle.today : null,
    new_end_date:
      start && revision.course_cycle_on_weeks !== null
        ? courseCycleDates(revision.course_cycle_on_weeks, null, cycle.today)
            .planned_stop_date
        : null,
    first_due: due,
    phase_continuity: continuity,
    can_commit: reasons.length === 0,
    conflicts: reasons.map((message) => ({
      code: start ? 'cycle_start_conflict' : 'cycle_end_conflict',
      message,
    })),
  };
  return medicationCourseCycleReviewSchema.parse({
    ...result,
    review_fingerprint: courseFingerprint({
      result,
      proposed_plan: start ? startPlan(revision, cycle.today) : null,
      course,
      actuals: actuals.map(
        ({
          id,
          source_kind,
          status,
          entry_date,
          occurred_at,
          scheduled_day,
          scheduled_for,
          course_revision_id,
          course_rule_id,
          course_step_id,
          course_slot_key,
        }) => ({
          id,
          source_kind,
          status,
          entry_date,
          occurred_at,
          scheduled_day,
          scheduled_for,
          course_revision_id,
          course_rule_id,
          course_step_id,
          course_slot_key,
        })
      ),
      phase_actuals: phaseActuals,
      device: deviceProof,
    }),
  });
}
async function medicationActive(
  client: PoolClient,
  owner: string,
  course: MedicationCourse
): Promise<boolean> {
  if (!course.medication_id) return false;
  const result = await client.query<{ is_active: boolean }>(
    'SELECT is_active FROM medications WHERE user_id=$1 AND id=$2',
    [owner, course.medication_id]
  );
  return result.rows[0]?.is_active ?? false;
}
async function loadReview(
  client: PoolClient,
  owner: string,
  course: MedicationCourse,
  input: MedicationCourseCycleReviewInput,
  now: Date
) {
  const revision = currentCourseTip(course),
    device = await loadCourseDevice(
      client,
      owner,
      course.medication_id,
      {},
      revision
    );
  return buildCourseCycleReview(
    course,
    await medicationActive(client, owner, course),
    await loadCourseActuals(client, owner, course.id),
    await loadCoursePhaseActuals(client, owner, course.id),
    input,
    device.proof,
    now
  );
}
export async function getMedicationCourseCycle(
  owner: string,
  id: string,
  now = new Date()
): Promise<MedicationCourseCycleState> {
  return courseTransaction(
    owner,
    async (client) => {
      const course = await loadMedicationCourse(client, owner, id);
      if (!course) throw courseProblem('Course not found.', 404);
      return buildCourseCycleState(
        course,
        await medicationActive(client, owner, course),
        await loadCourseActuals(client, owner, id),
        await loadCoursePhaseActuals(client, owner, id),
        now
      );
    },
    true
  );
}
export async function reviewMedicationCourseCycle(
  owner: string,
  id: string,
  input: MedicationCourseCycleReviewInput,
  now = new Date()
): Promise<MedicationCourseCycleReview> {
  await assertCourseWrite(owner);
  return courseTransaction(owner, async (client) =>
    loadReview(
      client,
      owner,
      await lockMedicationCourse(client, owner, id),
      input,
      now
    )
  );
}
async function captureOrigin(
  client: PoolClient,
  owner: string,
  course: MedicationCourse,
  revision: MedicationCourseRevision
) {
  const origin = course.revisions.find(
    (row) => row.id === coursePhaseFamilyId(revision)
  );
  if (!origin)
    throw courseProblem(
      'The phase origin is unavailable. Review the existing plan.'
    );
  if (origin.phase_origin_context === null && origin.id !== revision.id)
    throw courseProblem(
      'The phase origin context is unavailable. Review the existing authored plan.'
    );
  if (origin.phase_origin_context === null)
    await client.query(
      'UPDATE medication_course_revisions SET phase_origin_context=$3::jsonb WHERE user_id=$1 AND id=$2 AND phase_origin_context IS NULL',
      [
        owner,
        origin.id,
        JSON.stringify({
          start_date: origin.start_date,
          end_date: origin.end_date,
        }),
      ]
    );
}
const boundary = (revision: MedicationCourseRevision) => ({
  revision_id: revision.id,
  status: revision.status,
  start_date: revision.start_date,
  end_date: revision.end_date,
  weekly_anchor_date: revision.course_cycle_anchor_date,
});
async function mutateCycle(
  owner: string,
  id: string,
  input: MedicationCourseCycleActionInput,
  action: 'end' | 'start',
  now: Date
): Promise<MedicationCourseCycleMutationResult> {
  return courseOperation(
    owner,
    `cycle:${action}`,
    input,
    { id },
    async (client) => {
      const course = await lockMedicationCourse(client, owner, id),
        old = currentCourseTip(course);
      const review = await loadReview(
        client,
        owner,
        course,
        { action, expected_version: input.expected_version },
        now
      );
      if (review.review_fingerprint !== input.review_fingerprint)
        throw courseProblem(
          'The cycle review changed. Keep the draft and refresh the review.'
        );
      if (!review.can_commit)
        throw courseProblem(
          review.conflicts.map((row) => row.message).join(' ')
        );
      await captureOrigin(client, owner, course, old);
      let revisionId = old.id;
      let after: MedicationCourseRevision;
      if (action === 'end') {
        const end = review.candidate_end_date!;
        const cutoff = dayToUtcRange(
          addDays(end, 1),
          course.timezone
        ).start.toISOString();
        await client.query(
          'UPDATE medication_course_activity SET until_at=GREATEST(from_at,$3::timestamptz) WHERE user_id=$1 AND revision_id=$2 AND (until_at IS NULL OR until_at>$3::timestamptz)',
          [owner, old.id, cutoff]
        );
        await client.query(
          "UPDATE medication_course_revisions SET status='completed',end_date=$3,closed_date=$3 WHERE user_id=$1 AND id=$2",
          [owner, old.id, end]
        );
        after = {
          ...old,
          status: 'completed',
          end_date: end,
          closed_date: end,
        };
      } else {
        const today = review.effective_day,
          plan = startPlan(old, today),
          device = await loadCourseDevice(
            client,
            owner,
            course.medication_id,
            {},
            old
          );
        const closed =
          old.end_date !== null && old.end_date < today
            ? old.end_date
            : addDays(today, -1);
        await client.query(
          'UPDATE medication_course_activity a SET until_at=GREATEST(a.from_at,$3::timestamptz) FROM medication_course_revisions r WHERE r.id=a.revision_id AND r.user_id=a.user_id AND r.course_id=$2 AND a.user_id=$1 AND (a.until_at IS NULL OR a.until_at>$3::timestamptz)',
          [owner, id, now]
        );
        await client.query(
          "UPDATE medication_course_revisions SET status='completed',closed_date=$3 WHERE user_id=$1 AND id=$2",
          [owner, old.id, closed]
        );
        revisionId = randomUUID();
        await insertCourseRevision(
          client,
          owner,
          id,
          revisionId,
          old.revision_no + 1,
          old.id,
          plan,
          now,
          now.toISOString(),
          device.choice,
          {
            weekly_anchor_date: today,
            phase_family_id: coursePhaseFamilyId(old),
            phase_origin_context: null,
          }
        );
        await client.query(
          'UPDATE medication_courses SET current_revision_id=$3 WHERE user_id=$1 AND id=$2',
          [owner, id, revisionId]
        );
        after = {
          ...old,
          start_date: plan.start_date,
          end_date: plan.end_date,
          id: revisionId,
          status: 'active',
          course_cycle_anchor_date: today,
        };
      }
      await client.query(
        'UPDATE medication_courses SET version=version+1 WHERE user_id=$1 AND id=$2',
        [owner, id]
      );
      return medicationCourseCycleMutationResultSchema.parse({
        course_id: id,
        revision_id: revisionId,
        version: course.version + 1,
        operation_id: input.operation_id,
        action,
        effective_day: review.effective_day,
        activated_at: action === 'start' ? now.toISOString() : null,
        boundary_audit: {
          at: now.toISOString(),
          timezone: course.timezone,
          before: boundary(old),
          after: boundary(after),
        },
      });
    }
  );
}
export const endMedicationCourseCycle = (
  owner: string,
  id: string,
  input: MedicationCourseCycleActionInput,
  now = new Date()
) => mutateCycle(owner, id, input, 'end', now);
export const startMedicationCourseCycle = (
  owner: string,
  id: string,
  input: MedicationCourseCycleActionInput,
  now = new Date()
) => mutateCycle(owner, id, input, 'start', now);

export { startPlan as courseCycleStartPlan };
