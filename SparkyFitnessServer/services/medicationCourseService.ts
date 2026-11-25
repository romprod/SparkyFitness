import {
  assertPrescriptionOwner,
  validatePrescriptionLink,
  publicCoursePrescriptionEnvelope,
} from '../models/medicationPrescriptionRepository.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  addDays,
  dayToUtcRange,
  medicationCoursePlanInputSchema,
  courseMaterialChanges,
  coursePhaseActuals,
  coursePhaseFrequency,
  coursePhaseCarry,
  courseRevisionBoundary,
  courseCarryCyclicAnchors,
  courseSlotsForDay,
  courseEntryMatchesSlot,
  computeCourseAdherence,
  medicationCourseReviewSchema,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCoursePlanInput,
  type MedicationCourseCreateInput,
  type MedicationCourseReviewInput,
  type MedicationCourseReviseInput,
  type MedicationCourseEditInput,
  type MedicationCourseStatusInput,
  type MedicationCourseDeleteInput,
  type MedicationCourseMutationResult,
  type MedicationCourseReview,
  type MedicationCourseRuleInput,
  type MedicationCourseHandoffInput,
  type MedicationCourseHistory,
  type MedicationCourseDue,
} from '@workspace/shared';
import {
  courseWeeklyAnchor,
  courseCyclePlanPreview,
} from './medicationCourseCycleCalendar.js';
import { loadCourseDevice } from './medicationCourseDeviceService.js';
import { getClient } from '../db/poolManager.js';
import { canAccessUserData } from '../utils/permissionUtils.js';
import {
  courseActor,
  courseProblem,
  courseFingerprint,
  loadMedicationCourse,
  loadCourseActuals,
  loadCoursePhaseActuals,
  type CoursePhaseActual,
  courseAdministered,
  coursePlan,
  lockCourseMedication,
  lockMedicationCourse,
  loadCourseOwnerContext,
  deliveredCourseInputs,
  courseOperationReceipt,
  saveCourseReceipt,
  insertCourseRevision,
  storeCourseChildren,
  type CourseActual,
} from '../models/medicationCourseRepository.js';

export async function assertWrite(owner: string) {
  if (
    courseActor(owner) !== owner &&
    !(await canAccessUserData(owner, 'medications', courseActor(owner)))
  )
    throw courseProblem('Medication management permission is required.', 403);
}
async function transaction<T>(
  owner: string,
  work: (client: PoolClient) => Promise<T>,
  readOnly = false
): Promise<T> {
  const client: PoolClient = await getClient(owner);
  try {
    await client.query(
      readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'
    );
    const value = await work(client);
    await client.query('COMMIT');
    return publicCoursePrescriptionEnvelope(value, owner);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
function authoredPlan(
  input: MedicationCoursePlanInput,
  previous?: MedicationCourseRevision
): MedicationCoursePlanInput {
  const plan = medicationCoursePlanInputSchema.parse({
    name: input.name,
    notes: input.notes,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    cycle_anchor_date: input.cycle_anchor_date ?? null,
    target_dose: input.target_dose ?? null,
    dose_unit: input.dose_unit,
    dose_basis: input.dose_basis,
    rules: input.rules.map((r) => ({
      ...r,
      days_of_week: r.days_of_week
        ? [...new Set(r.days_of_week)].sort((a, b) => a - b)
        : r.days_of_week,
    })),
    steps: input.steps,
    device_id: input.device_id,
    prescription_id: input.prescription_id,
    course_cycle_on_weeks:
      input.course_cycle_on_weeks === undefined
        ? (previous?.course_cycle_on_weeks ?? null)
        : input.course_cycle_on_weeks,
    course_cycle_off_weeks:
      input.course_cycle_on_weeks === null
        ? null
        : input.course_cycle_off_weeks === undefined
          ? (previous?.course_cycle_off_weeks ?? null)
          : input.course_cycle_off_weeks,
  });
  if (
    plan.course_cycle_off_weeks !== null &&
    plan.course_cycle_off_weeks !== undefined &&
    (plan.course_cycle_on_weeks === null ||
      plan.course_cycle_on_weeks === undefined)
  )
    throw courseProblem(
      'A weekly break requires an effective on-cycle duration.',
      422
    );
  if (plan.end_date && plan.end_date < plan.start_date)
    throw courseProblem('The authored end must not precede the start.', 422);
  for (const rule of plan.rules)
    if (rule.start_date && rule.end_date && rule.end_date < rule.start_date)
      throw courseProblem('A rule end must not precede its start.', 422);
  return plan;
}
/** Older non-cycle clients have a strict authored-plan parser. Explicit new clear intent remains visible. */
export function publicCourseReviewPlan(
  plan: MedicationCoursePlanInput,
  input: MedicationCoursePlanInput
): MedicationCoursePlanInput {
  if (
    input.prescription_id === undefined &&
    (plan.prescription_id === null || plan.prescription_id === undefined)
  ) {
    const { prescription_id: _prescription, ...legacy } = plan;
    plan = legacy;
  }
  if (
    input.course_cycle_on_weeks === undefined &&
    input.course_cycle_off_weeks === undefined &&
    plan.course_cycle_on_weeks === null &&
    plan.course_cycle_off_weeks === null
  ) {
    const {
      course_cycle_on_weeks: _on,
      course_cycle_off_weeks: _off,
      ...legacy
    } = plan;
    return legacy;
  }
  return plan;
}

function tip(course: MedicationCourse): MedicationCourseRevision {
  const current = course.revisions.find(
    (r) => r.id === course.current_revision_id && !r.deleted_at
  );
  if (course.deleted_at || !current)
    throw courseProblem('This course has no current revision.', 404);
  return current;
}
function expectedVersion(course: MedicationCourse, version: number) {
  if (course.version !== version)
    throw courseProblem(
      'The course changed. Refresh and review this draft again.'
    );
}
const relevantActuals = (rows: CourseActual[]) =>
  rows.map((r) => ({
    id: r.id,
    source_kind: r.source_kind,
    course_revision_id: r.course_revision_id,
    course_rule_id: r.course_rule_id,
    course_step_id: r.course_step_id,
    course_slot_key: r.course_slot_key,
    scheduled_day: r.scheduled_day,
    scheduled_for: r.scheduled_for,
    entry_date: r.entry_date,
    occurred_at: r.occurred_at,
    status: r.status,
  }));
function reviewFingerprint(
  course: MedicationCourse | null,
  plan: MedicationCoursePlanInput,
  actuals: CourseActual[],
  handoff: unknown = null,
  phaseActuals: CoursePhaseActual[] = []
) {
  return courseFingerprint({
    course,
    plan,
    actuals: relevantActuals(actuals),
    handoff,
    phase_actuals: phaseActuals,
  });
}
async function revisionReview(
  client: PoolClient,
  owner: string,
  course: MedicationCourse,
  input: MedicationCourseReviewInput,
  actuals: CourseActual[],
  phaseActuals: CoursePhaseActual[],
  today: string
): Promise<MedicationCourseReview> {
  if (input.prescription_id !== undefined) assertPrescriptionOwner(owner);
  expectedVersion(course, input.expected_version);
  const old = tip(course),
    plan = authoredPlan(
      courseCarryCyclicAnchors(old, authoredPlan(input, old)),
      old
    );
  const device = await loadCourseDevice(
    client,
    owner,
    course.medication_id,
    plan,
    old
  );
  await validatePrescriptionLink(
    client,
    owner,
    course.medication_id,
    input,
    old.prescription_id ?? null
  );
  const changes = courseMaterialChanges(coursePlan(old), plan);
  const oldActuals = coursePhaseActuals({
    course,
    revision: old,
    delivered: phaseActuals,
  });
  const carry = coursePhaseCarry({
    steps: old.steps,
    oldInjectionsPerWeek: coursePhaseFrequency({ course, revision: old }),
    deliveredDayKeys: oldActuals.map((a) => a.entry_date),
    today,
  });
  const warnings: string[] = [];
  if (old.status !== 'active' && changes.length && oldActuals.length)
    warnings.push(
      'Resume or reopen this current revision before revising its authored history.'
    );
  if (!carry.progress_known && old.steps.length)
    warnings.push(
      'Phase progress is unknown for this cadence; steps are copied without inferred progress.'
    );
  warnings.push(
    'Historical managed adherence before course capture is unavailable. Unassigned legacy doses are not course credits.'
  );
  if (plan.start_date < today)
    warnings.push(
      'This authored start is backdated. Existing actuals keep their original revision and tracking day.'
    );
  return medicationCourseReviewSchema.parse({
    expected_version: course.version,
    timezone: course.timezone,
    review_fingerprint: reviewFingerprint(
      course,
      plan,
      actuals,
      device.proof,
      phaseActuals
    ),
    device_binding: device.binding,
    cycle_plan_preview: courseCyclePlanPreview(
      plan,
      courseWeeklyAnchor(plan, old),
      course.timezone
    ),
    material_changes: changes,
    requires_revision:
      changes.length > 0 &&
      (oldActuals.length > 0 || old.phase_family_id !== null),
    plan: publicCourseReviewPlan(plan, input),
    warnings,
    resumed_dose: carry.steps[0]?.dose ?? old.target_dose,
    resumed_dose_unit: carry.steps[0]?.dose_unit ?? old.dose_unit,
    carried_steps: carry.steps.map((step) => ({
      dose: step.dose,
      dose_unit: step.dose_unit,
      duration_days: step.duration_days,
      notes: step.notes ?? null,
    })),
    phase_progress_known: carry.progress_known,
  });
}
const legacyCols =
  'id,user_id,medication_id,schedule_type_id,time_of_day::text,dose_amount::text,days_of_week,interval_days,day_of_month,cycle_on_days,cycle_off_days,with_meal,prn_reason,prn_max_per_day,start_date::text,end_date::text,active,source,custom_fields';
type LegacyRule = Record<string, unknown> & {
  id: string;
  user_id: string;
  medication_id: string;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
};
function legacyAuthoredRule(row: LegacyRule): MedicationCourseRuleInput {
  const {
    id: _id,
    user_id: _user_id,
    medication_id: _medication_id,
    active: _active,
    source: _source,
    custom_fields: _custom_fields,
    ...rule
  } = row;
  return medicationCoursePlanInputSchema.shape.rules.element.parse({
    ...rule,
    // Preserve the established legacy cyclic engine fallback when its start is absent.
    anchor_date:
      row.start_date ??
      (row.schedule_type_id === 'cyclic' ? '2020-01-01' : null),
  });
}
async function selectedHandoff(
  client: PoolClient,
  owner: string,
  medicationId: string,
  handoff: MedicationCourseHandoffInput
): Promise<LegacyRule[]> {
  const ids = handoff.selected_rules.map((r) => r.schedule_id);
  if (new Set(ids).size !== ids.length)
    throw courseProblem('Select each legacy rule only once.', 422);
  const rows = await client.query<LegacyRule>(
    `SELECT ${legacyCols} FROM medication_schedules WHERE user_id=$1 AND medication_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`,
    [owner, medicationId, ids]
  );
  if (rows.rows.length !== ids.length)
    throw courseProblem('A selected legacy rule is unavailable.', 404);
  const used = await client.query(
    'SELECT id FROM medication_course_handoffs WHERE user_id=$1 AND original_schedule_id=ANY($2::uuid[])',
    [owner, ids]
  );
  if (used.rows.length)
    throw courseProblem('A selected legacy rule has already been handed over.');
  for (const selected of handoff.selected_rules) {
    const row = rows.rows.find((r) => r.id === selected.schedule_id)!;
    if (courseFingerprint(row) !== selected.fingerprint)
      throw courseProblem(
        'A selected legacy rule changed. Review the handoff again.'
      );
  }
  return rows.rows;
}
async function createReviewState(
  client: PoolClient,
  owner: string,
  medicationId: string,
  input: MedicationCourseReviewInput,
  now = new Date()
) {
  if (input.prescription_id !== undefined) assertPrescriptionOwner(owner);
  const medication = await lockCourseMedication(client, owner, medicationId);
  await validatePrescriptionLink(client, owner, medicationId, input);
  if (input.expected_version !== 0)
    throw courseProblem('New course creation expects version zero.');
  const selected = input.handoff
    ? await selectedHandoff(client, owner, medicationId, input.handoff)
    : [];
  let plan = authoredPlan(input);
  if (input.handoff) {
    plan = authoredPlan({
      ...plan,
      start_date: input.handoff.cutover_day,
      rules: selected.map(legacyAuthoredRule),
    });
  }
  const context = await loadCourseOwnerContext(client, owner, now);
  const device = await loadCourseDevice(client, owner, medicationId, plan);
  const fingerprint = reviewFingerprint(null, plan, [], {
    device: device.proof,
    context,
    medication,
    selected,
    input: input.handoff ?? null,
  });
  const warnings = [
    'Capturing a course does not backfill legacy dose attribution. Earlier managed adherence is unavailable.',
  ];
  if (input.handoff)
    warnings.push(
      'Selected legacy rules retain their original recurrence and end at the saved cutover cap. Old native reminders do not load managed courses; no new native binary is included.'
    );
  return {
    medication,
    selected,
    device,
    review: medicationCourseReviewSchema.parse({
      expected_version: 0,
      device_binding: device.binding,
      cycle_plan_preview: courseCyclePlanPreview(
        plan,
        courseWeeklyAnchor(plan),
        context.timezone
      ),
      timezone: context.timezone,
      review_fingerprint: fingerprint,
      material_changes: [],
      requires_revision: false,
      plan: publicCourseReviewPlan(plan, input),
      warnings,
      resumed_dose: plan.steps[0]?.dose ?? plan.target_dose ?? null,
      resumed_dose_unit: plan.steps[0]?.dose_unit ?? plan.dose_unit,
      carried_steps: plan.steps,
      phase_progress_known: false,
    }),
  };
}
export async function listCourseHandoffRules(
  owner: string,
  medicationId: string,
  now = new Date()
) {
  return transaction(
    owner,
    async (client) => {
      const med = await client.query(
        'SELECT id FROM medications WHERE user_id=$1 AND id=$2',
        [owner, medicationId]
      );
      if (!med.rows.length) throw courseProblem('Medication not found.', 404);
      const context = await loadCourseOwnerContext(client, owner, now);
      const rows = await client.query<LegacyRule>(
        `SELECT ${legacyCols} FROM medication_schedules WHERE user_id=$1 AND medication_id=$2 ORDER BY id`,
        [owner, medicationId]
      );
      const used = await client.query<{ original_schedule_id: string }>(
        'SELECT original_schedule_id FROM medication_course_handoffs WHERE user_id=$1',
        [owner]
      );
      return {
        ...context,
        rules: rows.rows.map((row) => ({
          schedule_id: row.id,
          rule: legacyAuthoredRule(row),
          fingerprint: courseFingerprint(row),
          already_handed_off: used.rows.some(
            (h) => h.original_schedule_id === row.id
          ),
        })),
      };
    },
    true
  );
}
export async function reviewMedicationCourseCreate(
  owner: string,
  medicationId: string,
  input: MedicationCourseReviewInput,
  now = new Date()
) {
  await assertWrite(owner);
  return transaction(owner, async (client) => {
    await loadCourseOwnerContext(client, owner, now);
    return (await createReviewState(client, owner, medicationId, input, now))
      .review;
  });
}
export async function reviewMedicationCourse(
  owner: string,
  id: string,
  input: MedicationCourseReviewInput,
  now = new Date()
) {
  await assertWrite(owner);
  return transaction(owner, async (client) => {
    const course = await lockMedicationCourse(client, owner, id);
    const context = await loadCourseOwnerContext(client, owner, now);
    return revisionReview(
      client,
      owner,
      course,
      input,
      await loadCourseActuals(client, owner, id),
      await loadCoursePhaseActuals(client, owner, id),
      context.today
    );
  });
}
async function operation<T extends MedicationCourseMutationResult>(
  owner: string,
  action: string,
  input: { operation_id: string },
  context: unknown,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  await assertWrite(owner);
  const hash = courseFingerprint({
    action,
    input,
    context,
    actor: courseActor(owner),
  });
  return transaction(owner, async (client) => {
    const old = await courseOperationReceipt<T>(
      client,
      owner,
      input.operation_id,
      hash
    );
    if (old) return old;
    const result = await work(client);
    await saveCourseReceipt(client, owner, action, hash, result);
    return result;
  });
}
export async function createMedicationCourse(
  owner: string,
  input: MedicationCourseCreateInput,
  now = new Date()
): Promise<MedicationCourseMutationResult> {
  return operation(
    owner,
    'create',
    input,
    { medication_id: input.medication_id },
    (client) => createCourseInTransaction(client, owner, input, now)
  );
}
/** The create work itself, on a client whose transaction (and receipt, if any) the caller owns. */
export async function createCourseInTransaction(
  client: PoolClient,
  owner: string,
  input: MedicationCourseCreateInput,
  now = new Date()
): Promise<MedicationCourseMutationResult> {
  const state = await createReviewState(
    client,
    owner,
    input.medication_id,
    input,
    now
  );
  const plan = state.review.plan;
  const context = await loadCourseOwnerContext(client, owner, now);
  if (
    input.handoff &&
    (!input.native_reminder_limitation_acknowledged ||
      !input.review_fingerprint)
  )
    throw courseProblem(
      'Review and acknowledge the legacy handoff and native reminder limitation.',
      422
    );
  if (
    input.review_fingerprint &&
    input.review_fingerprint !== state.review.review_fingerprint
  )
    throw courseProblem(
      'The handoff or authored draft changed. Review it again.'
    );
  const id = randomUUID(),
    revisionId = randomUUID();
  await client.query(
    'INSERT INTO medication_courses(id,user_id,medication_id,medication_name_snapshot,current_revision_id,version,captured_at,capture_day,timezone) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',
    [
      id,
      owner,
      input.medication_id,
      state.medication.name,
      revisionId,
      now,
      context.today,
      context.timezone,
    ]
  );
  await insertCourseRevision(
    client,
    owner,
    id,
    revisionId,
    1,
    null,
    plan,
    now,
    state.medication.is_active
      ? dayToUtcRange(plan.start_date, context.timezone).start.toISOString()
      : null,
    state.device.choice
  );
  if (input.handoff) {
    for (const row of state.selected) {
      const capped =
        row.end_date && row.end_date < addDays(input.handoff.cutover_day, -1)
          ? row.end_date
          : addDays(input.handoff.cutover_day, -1);
      await client.query(
        'UPDATE medication_schedules SET end_date=$3 WHERE user_id=$1 AND id=$2',
        [owner, row.id, capped]
      );
      await client.query(
        'INSERT INTO medication_course_handoffs(user_id,course_id,revision_id,schedule_id,original_schedule_id,original_rule,original_fingerprint,cutover_day,capped_end_date) VALUES($1,$2,$3,$4,$4,$5::jsonb,$6,$7,$8)',
        [
          owner,
          id,
          revisionId,
          row.id,
          JSON.stringify(row),
          courseFingerprint(row),
          input.handoff.cutover_day,
          capped,
        ]
      );
    }
  }
  return {
    course_id: id,
    revision_id: revisionId,
    version: 1,
    operation_id: input.operation_id,
  };
}
export async function editMedicationCourse(
  owner: string,
  id: string,
  input: MedicationCourseEditInput,
  _now = new Date()
): Promise<MedicationCourseMutationResult> {
  if (input.prescription_id !== undefined) assertPrescriptionOwner(owner);
  return operation(owner, 'edit', input, { id }, async (client) => {
    const course = await lockMedicationCourse(client, owner, id);
    expectedVersion(course, input.expected_version);
    const old = tip(course),
      plan = authoredPlan(
        courseCarryCyclicAnchors(old, authoredPlan(input, old)),
        old
      );
    const device = await loadCourseDevice(
      client,
      owner,
      course.medication_id,
      plan,
      old
    );
    const phaseActuals = await loadCoursePhaseActuals(client, owner, id);
    const hasPhaseHistory =
      coursePhaseActuals({ course, revision: old, delivered: phaseActuals })
        .length > 0;
    if (courseMaterialChanges(coursePlan(old), plan).length && hasPhaseHistory)
      throw courseProblem(
        'This authored history needs a reviewed successor revision; resume or reopen the current tip first if needed.'
      );
    const prescriptionId = await validatePrescriptionLink(
      client,
      owner,
      course.medication_id,
      input,
      old.prescription_id ?? null
    );
    await client.query(
      'UPDATE medication_course_revisions SET name=$3,notes=$4,start_date=$5,end_date=$6,cycle_anchor_date=$7,target_dose=$8,dose_unit=$9,dose_basis=$10,device_id=$11,device_choice=$12,course_cycle_on_weeks=$13,course_cycle_off_weeks=$14,course_cycle_anchor_date=$15,phase_origin_context=$16::jsonb,prescription_id=$17 WHERE user_id=$1 AND id=$2',
      [
        owner,
        old.id,
        plan.name,
        plan.notes ?? null,
        plan.start_date,
        plan.end_date ?? null,
        plan.cycle_anchor_date ?? null,
        plan.target_dose ?? null,
        plan.dose_unit,
        plan.dose_basis,
        device.choice.device_id,
        device.choice.device_choice,
        plan.course_cycle_on_weeks ?? null,
        plan.course_cycle_off_weeks ?? null,
        courseWeeklyAnchor(plan, old),
        !hasPhaseHistory && courseMaterialChanges(coursePlan(old), plan).length
          ? JSON.stringify({
              start_date: plan.start_date,
              end_date: plan.end_date ?? null,
            })
          : old.phase_origin_context === null
            ? null
            : JSON.stringify(old.phase_origin_context),
        prescriptionId,
      ]
    );
    await storeCourseChildren(client, owner, old.id, plan, old);
    await client.query(
      'UPDATE medication_courses SET version=version+1 WHERE user_id=$1 AND id=$2',
      [owner, id]
    );
    return {
      course_id: id,
      revision_id: old.id,
      version: course.version + 1,
      operation_id: input.operation_id,
    };
  });
}
export async function reviseMedicationCourse(
  owner: string,
  id: string,
  input: MedicationCourseReviseInput,
  now = new Date()
): Promise<MedicationCourseMutationResult> {
  return operation(owner, 'revise', input, { id }, async (client) => {
    const course = await lockMedicationCourse(client, owner, id);
    expectedVersion(course, input.expected_version);
    const old = tip(course);
    if (old.status !== 'active')
      throw courseProblem(
        'Resume or reopen the current revision before revising it.'
      );
    const context = await loadCourseOwnerContext(client, owner, now);
    const actuals = await loadCourseActuals(client, owner, id);
    const reviewed = await revisionReview(
      client,
      owner,
      course,
      input,
      actuals,
      await loadCoursePhaseActuals(client, owner, id),
      context.today
    );
    if (reviewed.review_fingerprint !== input.review_fingerprint)
      throw courseProblem(
        'The course or its attributed actuals changed. Refresh the review while keeping this draft.'
      );
    const delivered = actuals.filter(
      (a) => a.course_revision_id === old.id && courseAdministered(a)
    );
    const last =
      delivered
        .map((a) => a.entry_date)
        .sort()
        .at(-1) ?? null;
    let boundary: ReturnType<typeof courseRevisionBoundary>;
    try {
      boundary = courseRevisionBoundary({
        predecessor: old,
        newStart: input.start_date,
        replacementEnd: input.end_date,
        lastDeliveredDay: last,
      });
    } catch {
      throw courseProblem(
        'The successor start must follow the predecessor start and its inherited or authored end must follow the new start.',
        422
      );
    }
    const plan = authoredPlan({
      ...reviewed.plan,
      end_date: boundary.successor_end_date,
    });
    const nextId = randomUUID();
    const cutoff = dayToUtcRange(
      plan.start_date,
      course.timezone
    ).start.toISOString();
    await client.query(
      "UPDATE medication_course_revisions SET status='completed',closed_date=$3 WHERE user_id=$1 AND id=$2",
      [owner, old.id, boundary.predecessor_end_date]
    );
    await client.query(
      'UPDATE medication_course_activity SET until_at=GREATEST(from_at,$3::timestamptz) WHERE user_id=$1 AND revision_id=$2 AND until_at IS NULL',
      [owner, old.id, cutoff]
    );
    const med = course.medication_id
      ? await client.query<{ is_active: boolean }>(
          'SELECT is_active FROM medications WHERE user_id=$1 AND id=$2',
          [owner, course.medication_id]
        )
      : null;
    await insertCourseRevision(
      client,
      owner,
      id,
      nextId,
      old.revision_no + 1,
      old.id,
      plan,
      now,
      med?.rows[0]?.is_active ? cutoff : null,
      (await loadCourseDevice(client, owner, course.medication_id, plan, old))
        .choice,
      {
        weekly_anchor_date: courseWeeklyAnchor(plan, old),
        phase_family_id: null,
        phase_origin_context: {
          start_date: plan.start_date,
          end_date: plan.end_date ?? null,
        },
      }
    );
    await client.query(
      'UPDATE medication_courses SET current_revision_id=$3,version=version+1 WHERE user_id=$1 AND id=$2',
      [owner, id, nextId]
    );
    return {
      course_id: id,
      revision_id: nextId,
      version: course.version + 1,
      operation_id: input.operation_id,
    };
  });
}
export async function setMedicationCourseStatus(
  owner: string,
  id: string,
  input: MedicationCourseStatusInput,
  now = new Date()
): Promise<MedicationCourseMutationResult> {
  return operation(
    owner,
    `status:${input.status}`,
    input,
    { id },
    async (client) => {
      const course = await lockMedicationCourse(client, owner, id);
      expectedVersion(course, input.expected_version);
      const old = tip(course);
      const context = await loadCourseOwnerContext(client, owner, now);
      if (old.status !== input.status) {
        if (input.status !== 'active')
          await client.query(
            'UPDATE medication_course_activity SET until_at=GREATEST(from_at,$3::timestamptz) WHERE user_id=$1 AND revision_id=$2 AND until_at IS NULL',
            [owner, old.id, now]
          );
        else {
          const med = course.medication_id
            ? await client.query<{ is_active: boolean }>(
                'SELECT is_active FROM medications WHERE user_id=$1 AND id=$2',
                [owner, course.medication_id]
              )
            : null;
          if (med?.rows[0]?.is_active)
            await client.query(
              'INSERT INTO medication_course_activity(id,user_id,revision_id,from_at) VALUES($1,$2,$3,$4)',
              [randomUUID(), owner, old.id, now]
            );
        }
        const closed =
          input.status === 'completed'
            ? old.end_date && old.end_date < context.today
              ? old.end_date
              : context.today
            : input.status === 'active'
              ? null
              : old.closed_date;
        await client.query(
          "UPDATE medication_course_revisions SET status=$3,closed_date=$4,end_date=CASE WHEN $3='completed' THEN $4::date ELSE end_date END WHERE user_id=$1 AND id=$2",
          [owner, old.id, input.status, closed]
        );
      }
      await client.query(
        'UPDATE medication_courses SET version=version+1 WHERE user_id=$1 AND id=$2',
        [owner, id]
      );
      return {
        course_id: id,
        revision_id: old.id,
        version: course.version + 1,
        operation_id: input.operation_id,
      };
    }
  );
}
export async function deleteMedicationCourseRevision(
  owner: string,
  id: string,
  revisionId: string | null,
  input: MedicationCourseDeleteInput,
  now = new Date()
): Promise<MedicationCourseMutationResult> {
  return operation(
    owner,
    'delete',
    input,
    { id, revisionId },
    async (client) => {
      const course = await lockMedicationCourse(client, owner, id);
      expectedVersion(course, input.expected_version);
      const selected = revisionId ?? course.current_revision_id;
      const revision = course.revisions.find(
        (r) => r.id === selected && !r.deleted_at
      );
      if (!revision) throw courseProblem('Revision not found.', 404);
      for (const table of ['medication_entries', 'injection_entries'])
        await client.query(
          `UPDATE ${table} SET course_revision_id=NULL,course_rule_id=NULL,course_step_id=NULL,course_slot_key=NULL WHERE user_id=$1 AND course_revision_id=$2`,
          [owner, selected]
        );
      await client.query(
        'UPDATE medication_course_activity SET until_at=GREATEST(from_at,$3::timestamptz) WHERE user_id=$1 AND revision_id=$2 AND (until_at IS NULL OR until_at>$3::timestamptz)',
        [owner, selected, now]
      );
      if (selected === course.current_revision_id)
        await client.query(
          'UPDATE medication_course_activity a SET until_at=GREATEST(a.from_at,$3::timestamptz) FROM medication_course_revisions r WHERE r.id=a.revision_id AND r.user_id=a.user_id AND r.course_id=$2 AND a.user_id=$1 AND (a.until_at IS NULL OR a.until_at>$3::timestamptz)',
          [owner, id, now]
        );
      await client.query(
        'UPDATE medication_course_revisions SET deleted_at=$3 WHERE user_id=$1 AND id=$2',
        [owner, selected, now]
      );
      const current =
        selected === course.current_revision_id
          ? null
          : course.current_revision_id;
      await client.query(
        'UPDATE medication_courses SET current_revision_id=$3,version=version+1,deleted_at=CASE WHEN NOT EXISTS(SELECT 1 FROM medication_course_revisions r WHERE r.course_id=$2 AND r.user_id=$1 AND r.deleted_at IS NULL) THEN $4::timestamptz ELSE NULL END WHERE user_id=$1 AND id=$2',
        [owner, id, current, now]
      );
      return {
        course_id: id,
        revision_id: current,
        version: course.version + 1,
        operation_id: input.operation_id,
      };
    }
  );
}
export async function listMedicationCourses(
  owner: string,
  medicationId?: string,
  now = new Date()
) {
  return transaction(
    owner,
    async (client) => {
      const context = await loadCourseOwnerContext(client, owner, now);
      const ids = await client.query<{ id: string }>(
        'SELECT id FROM medication_courses WHERE user_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR medication_id=$2) ORDER BY captured_at,id',
        [owner, medicationId ?? null]
      );
      const courses: MedicationCourse[] = [];
      for (const row of ids.rows) {
        const course = await loadMedicationCourse(client, owner, row.id);
        if (course) courses.push(course);
      }
      return { ...context, courses };
    },
    true
  );
}
export async function getMedicationCourse(owner: string, id: string) {
  return transaction(
    owner,
    async (client) => {
      const course = await loadMedicationCourse(client, owner, id);
      if (!course) throw courseProblem('Course not found.', 404);
      return { course };
    },
    true
  );
}
export async function getMedicationCourseDue(
  owner: string,
  date?: string,
  now = new Date()
): Promise<MedicationCourseDue> {
  return transaction(
    owner,
    async (client) => {
      const context = await loadCourseOwnerContext(client, owner, now);
      const day = date ?? context.today;
      const ids = await client.query<{ id: string; is_active: boolean }>(
        'SELECT c.id,COALESCE(m.is_active,false) AS is_active FROM medication_courses c LEFT JOIN medications m ON m.id=c.medication_id AND m.user_id=c.user_id WHERE c.user_id=$1 AND c.deleted_at IS NULL ORDER BY c.id',
        [owner]
      );
      const courses: MedicationCourse[] = [];
      const slots: MedicationCourseDue['slots'] = [];
      const fulfilled_slots: MedicationCourseDue['fulfilled_slots'] = [];
      for (const row of ids.rows) {
        const course = await loadMedicationCourse(client, owner, row.id);
        if (!course) continue;
        courses.push(course);
        const actuals = await loadCourseActuals(client, owner, course.id);
        const expected = courseSlotsForDay({
          course,
          day,
          today: context.today,
          nowInstant: now.toISOString(),
          medicationActive: row.is_active,
          delivered: deliveredCourseInputs(actuals),
          phaseDelivered: deliveredCourseInputs(
            await loadCoursePhaseActuals(client, owner, course.id)
          ),
        });
        slots.push(...expected);
        for (const slot of expected) {
          const matches = actuals.filter((actual) =>
            courseEntryMatchesSlot(actual, slot)
          );
          const actual =
            matches.find((row) => row.status === 'skipped') ??
            matches.find(courseAdministered);
          if (actual)
            fulfilled_slots.push({
              course_revision_id: slot.course_revision_id,
              course_rule_id: slot.course_rule_id,
              course_slot_key: slot.course_slot_key,
              scheduled_day: slot.scheduled_day,
              status: actual.status === 'skipped' ? 'skipped' : 'taken',
              source_kind: actual.source_kind,
              entry_id: actual.id,
              occurred_at: actual.occurred_at,
              entry_date: actual.entry_date,
            });
        }
      }
      return { ...context, courses, slots, fulfilled_slots };
    },
    true
  );
}
export async function getMedicationCourseHistory(
  owner: string,
  id: string,
  from?: string,
  to?: string,
  now = new Date()
): Promise<MedicationCourseHistory> {
  return transaction(
    owner,
    async (client) => {
      const course = await loadMedicationCourse(client, owner, id);
      if (!course) throw courseProblem('Course not found.', 404);
      const context = await loadCourseOwnerContext(client, owner, now);
      const actuals = await loadCourseActuals(client, owner, id);
      const fromDay =
        from ??
        [course.capture_day, ...actuals.map((a) => a.entry_date)].sort()[0]!;
      const toDay =
        to ??
        [context.today, ...actuals.map((a) => a.entry_date)].sort().at(-1)!;
      if (fromDay > toDay)
        throw courseProblem('History start must not follow its end.', 422);
      const med = course.medication_id
        ? await client.query<{ is_active: boolean }>(
            'SELECT is_active FROM medications WHERE user_id=$1 AND id=$2',
            [owner, course.medication_id]
          )
        : null;
      return {
        course,
        from_date: fromDay,
        to_date: toDay,
        ...context,
        adherence: computeCourseAdherence({
          course,
          entries: deliveredCourseInputs(actuals),
          phaseEntries: deliveredCourseInputs(
            await loadCoursePhaseActuals(client, owner, id)
          ),
          fromDay,
          toDay,
          today: context.today,
          now: now.toISOString(),
          medicationActive: med?.rows[0]?.is_active ?? false,
        }),
        actuals: actuals.filter(
          (a) => a.entry_date >= fromDay && a.entry_date <= toDay
        ),
      };
    },
    true
  );
}

export {
  transaction as courseTransaction,
  operation as courseOperation,
  tip as currentCourseTip,
  expectedVersion as assertCourseVersion,
  assertWrite as assertCourseWrite,
};
