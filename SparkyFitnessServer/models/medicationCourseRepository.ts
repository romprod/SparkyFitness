import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  medicationCourseSchema,
  medicationCoursePlanInputSchema,
  courseSlotsForDay,
  normalizePurchaseDecimal,
  instantToDay,
  isValidTimeZone,
  dayToUtcRange,
  type MedicationCourse,
  type MedicationCourseRevision,
  type MedicationCourseRule,
  type MedicationCourseStep,
  type MedicationCoursePlanInput,
  type MedicationCourseAttributionInput,
  type MedicationCourseMutationResult,
  type MedicationCourseActual,
} from '@workspace/shared';
import { dbContextStorage } from '../db/poolManager.js';

export const courseProblem = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });
export const courseActor = (owner: string) =>
  dbContextStorage.getStore()?.authenticatedUserId ?? owner;
const iso = (value: Date | string): string => new Date(value).toISOString();
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export const courseFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

type StoredCourse = Omit<
  MedicationCourse,
  'revisions' | 'captured_at' | 'deleted_at'
> & { captured_at: Date | string; deleted_at: Date | string | null };
type StoredRevision = Omit<
  MedicationCourseRevision,
  'rules' | 'steps' | 'activity' | 'created_at' | 'deleted_at'
> & { created_at: Date | string; deleted_at: Date | string | null };
export async function loadMedicationCourse(
  client: PoolClient,
  owner: string,
  id: string
): Promise<MedicationCourse | null> {
  const root = await client.query<StoredCourse>(
    'SELECT * FROM medication_courses WHERE id=$1 AND user_id=$2',
    [id, owner]
  );
  const c = root.rows[0];
  if (!c) return null;
  const revisions = await client.query<StoredRevision>(
    'SELECT *,target_dose::text FROM medication_course_revisions WHERE course_id=$1 AND user_id=$2 ORDER BY revision_no,id',
    [id, owner]
  );
  const rules = await client.query<MedicationCourseRule>(
    'SELECT q.*,q.dose_amount::text FROM medication_course_rules q JOIN medication_course_revisions r ON r.id=q.revision_id AND r.user_id=q.user_id WHERE r.course_id=$1 AND q.user_id=$2 ORDER BY q.rule_index,q.id',
    [id, owner]
  );
  const steps = await client.query<MedicationCourseStep>(
    'SELECT s.*,s.dose::text FROM medication_course_steps s JOIN medication_course_revisions r ON r.id=s.revision_id AND r.user_id=s.user_id WHERE r.course_id=$1 AND s.user_id=$2 ORDER BY s.step_index,s.id',
    [id, owner]
  );
  const activity = await client.query<{
    id: string;
    user_id: string;
    revision_id: string;
    from_at: Date | string;
    until_at: Date | string | null;
  }>(
    'SELECT a.* FROM medication_course_activity a JOIN medication_course_revisions r ON r.id=a.revision_id AND r.user_id=a.user_id WHERE r.course_id=$1 AND a.user_id=$2 ORDER BY a.from_at,a.id',
    [id, owner]
  );
  return medicationCourseSchema.parse({
    ...c,
    captured_at: iso(c.captured_at),
    deleted_at: c.deleted_at ? iso(c.deleted_at) : null,
    revisions: revisions.rows.map((r) => ({
      ...r,
      created_at: iso(r.created_at),
      deleted_at: r.deleted_at ? iso(r.deleted_at) : null,
      rules: rules.rows.filter((q) => q.revision_id === r.id),
      steps: steps.rows.filter((s) => s.revision_id === r.id),
      activity: activity.rows
        .filter((a) => a.revision_id === r.id)
        .map((a) => ({
          ...a,
          from_at: iso(a.from_at),
          until_at: a.until_at ? iso(a.until_at) : null,
        })),
    })),
  });
}
export type CourseActual = Omit<
  MedicationCourseActual,
  'course_revision_id'
> & { course_revision_id: string };
export async function loadCourseActuals(
  client: PoolClient,
  owner: string,
  courseId: string
): Promise<CourseActual[]> {
  type Stored = Omit<CourseActual, 'scheduled_for' | 'occurred_at'> & {
    scheduled_for: Date | string | null;
    occurred_at: Date | string;
    dose_input_unit?: string | null;
  };
  const result = await client.query<Stored>(
    `SELECT 'entry' AS source_kind,e.id,e.course_revision_id,e.course_rule_id,e.course_step_id,e.course_slot_key,e.scheduled_day,e.scheduled_for,e.entry_date,e.status,e.taken_at AS occurred_at,e.course_origin,
      e.med_name_snapshot AS medication_name,e.dose_amount_snapshot::text AS dose_amount,e.dose_unit_snapshot AS dose_unit,NULL::text AS dose_mg_exact,NULL::text AS volume_ml,NULL::text AS site,e.notes,NULL::text AS administration_route,NULL::text AS dose_input_unit
    FROM medication_entries e JOIN medication_course_revisions r ON r.id=e.course_revision_id AND r.user_id=e.user_id WHERE r.course_id=$1 AND e.user_id=$2
    UNION ALL SELECT 'injection',e.id,e.course_revision_id,e.course_rule_id,e.course_step_id,e.course_slot_key,e.scheduled_day,e.scheduled_for,e.entry_date,'taken',e.injected_at,e.course_origin,
      e.medication_name_snapshot,e.dose_mg::text,'mg',e.dose_mg::text,e.volume_ml::text,e.site,e.notes,e.administration_route,e.dose_input_unit
    FROM injection_entries e JOIN medication_course_revisions r ON r.id=e.course_revision_id AND r.user_id=e.user_id JOIN medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id WHERE r.course_id=$1 AND e.user_id=$2 ORDER BY entry_date,source_kind,id`,
    [courseId, owner]
  );
  return result.rows.map(({ dose_input_unit, ...r }) => {
    if (r.source_kind === 'injection') {
      const mass = r.dose_mg_exact?.trim()
        ? normalizePurchaseDecimal(r.dose_mg_exact)
        : null;
      if (
        mass === null ||
        (mass === '0' &&
          (r.volume_ml === null ||
            normalizePurchaseDecimal(r.volume_ml) === null ||
            dose_input_unit === null ||
            dose_input_unit === undefined))
      ) {
        r.dose_amount = null;
        r.dose_unit = null;
        r.dose_mg_exact = null;
      }
    }
    return {
      ...r,
      occurred_at: iso(r.occurred_at),
      scheduled_for: r.scheduled_for ? iso(r.scheduled_for) : null,
    };
  });
}
export const deliveredCourseInputs = (rows: CourseActual[]) =>
  rows.map((row) => ({ ...row, id: `${row.source_kind}:${row.id}` }));
export const courseAdministered = (actual: CourseActual) =>
  actual.status === 'taken' || actual.status === 'prn_taken';
export function coursePlan(
  revision: MedicationCourseRevision
): MedicationCoursePlanInput {
  return medicationCoursePlanInputSchema.parse({
    name: revision.name,
    notes: revision.notes,
    start_date: revision.start_date,
    end_date: revision.end_date,
    cycle_anchor_date: revision.cycle_anchor_date,
    target_dose: revision.target_dose,
    dose_unit: revision.dose_unit,
    dose_basis: revision.dose_basis,
    rules: revision.rules.map(
      ({
        id: _id,
        user_id: _user_id,
        revision_id: _revision_id,
        rule_index: _rule_index,
        ...rule
      }) => rule
    ),
    steps: revision.steps.map(
      ({
        id: _id,
        user_id: _user_id,
        revision_id: _revision_id,
        step_index: _step_index,
        ...step
      }) => step
    ),
  });
}
export async function lockCourseMedication(
  client: PoolClient,
  owner: string,
  medicationId: string
) {
  const result = await client.query<{
    id: string;
    name: string;
    is_active: boolean;
  }>(
    'SELECT id,COALESCE(display_name,name) AS name,is_active FROM medications WHERE user_id=$1 AND id=$2 FOR UPDATE',
    [owner, medicationId]
  );
  if (!result.rows[0]) throw courseProblem('Medication not found.', 404);
  return result.rows[0];
}
export async function lockMedicationCourse(
  client: PoolClient,
  owner: string,
  courseId: string
): Promise<MedicationCourse> {
  const target = await client.query<{ medication_id: string | null }>(
    'SELECT medication_id FROM medication_courses WHERE id=$1 AND user_id=$2',
    [courseId, owner]
  );
  if (!target.rows[0]) throw courseProblem('Course not found.', 404);
  if (target.rows[0].medication_id)
    await lockCourseMedication(client, owner, target.rows[0].medication_id);
  await client.query(
    'SELECT id FROM medication_courses WHERE id=$1 AND user_id=$2 FOR UPDATE',
    [courseId, owner]
  );
  await client.query(
    'SELECT id FROM medication_course_revisions WHERE course_id=$1 AND user_id=$2 ORDER BY revision_no,id FOR UPDATE',
    [courseId, owner]
  );
  const course = await loadMedicationCourse(client, owner, courseId);
  if (!course) throw courseProblem('Course not found.', 404);
  return course;
}

export async function loadCourseOwnerContext(
  client: PoolClient,
  owner: string,
  now = new Date()
): Promise<{ today: string; timezone: string }> {
  const pref = await client.query<{ timezone: string | null }>(
    'SELECT timezone FROM user_preferences WHERE user_id=$1',
    [owner]
  );
  const saved = pref.rows[0]?.timezone;
  const timezone = saved && isValidTimeZone(saved) ? saved : 'UTC';
  return { timezone, today: instantToDay(now, timezone) };
}
/** Caller holds the medication row lock. Archive/unarchive gates instant activity without rewriting course plans. */
export async function transitionCourseMedicationActivity(
  client: PoolClient,
  owner: string,
  medicationId: string,
  beforeActive: boolean,
  afterActive: boolean,
  now = new Date()
): Promise<void> {
  if (beforeActive === afterActive) return;
  const rows = await client.query<{ id: string }>(
    'SELECT id FROM medication_courses WHERE user_id=$1 AND medication_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE',
    [owner, medicationId]
  );
  for (const row of rows.rows) {
    await client.query(
      'SELECT id FROM medication_course_revisions WHERE user_id=$1 AND course_id=$2 ORDER BY revision_no,id FOR UPDATE',
      [owner, row.id]
    );
    const course = await loadMedicationCourse(client, owner, row.id);
    if (!course) continue;
    await client.query(
      'UPDATE medication_courses SET version=version+1 WHERE user_id=$1 AND id=$2',
      [owner, course.id]
    );
    for (const revision of course.revisions) {
      if (!afterActive) {
        await client.query(
          'UPDATE medication_course_activity SET until_at=GREATEST(from_at,$3::timestamptz) WHERE user_id=$1 AND revision_id=$2 AND (until_at IS NULL OR until_at>$3::timestamptz)',
          [owner, revision.id, now]
        );
        continue;
      }
      if (revision.deleted_at) continue;
      const successor = course.revisions.find(
        (r) => r.predecessor_id === revision.id
      );
      const ownsBeforeFutureCut =
        revision.status === 'completed' &&
        successor !== undefined &&
        successor.deleted_at === null &&
        now.getTime() <
          dayToUtcRange(successor.start_date, course.timezone).start.getTime();
      const liveTip = course.revisions.some(
        (r) => r.id === course.current_revision_id && r.deleted_at === null
      );
      const eligible =
        liveTip &&
        ((revision.id === course.current_revision_id &&
          revision.status === 'active') ||
          ownsBeforeFutureCut);
      if (eligible && !revision.activity.some((a) => a.until_at === null))
        await client.query(
          'INSERT INTO medication_course_activity(id,user_id,revision_id,from_at,until_at) VALUES($1,$2,$3,$4,$5)',
          [
            randomUUID(),
            owner,
            revision.id,
            now,
            ownsBeforeFutureCut && successor
              ? dayToUtcRange(
                  successor.start_date,
                  course.timezone
                ).start.toISOString()
              : null,
          ]
        );
    }
  }
}

/** Caller owns the medication lock; this locks course then revision before physical stock. */
export async function lockCourseAttribution(
  client: PoolClient,
  owner: string,
  medicationId: string | null,
  attribution: MedicationCourseAttributionInput & { status?: string },
  _trackingDay: string,
  now = new Date(),
  existingActual?: { id: string; source_kind: 'entry' | 'injection' }
): Promise<void> {
  if (!attribution.course_revision_id) return;
  const target = await client.query<{ course_id: string }>(
    'SELECT course_id FROM medication_course_revisions WHERE id=$1 AND user_id=$2',
    [attribution.course_revision_id, owner]
  );
  if (!target.rows[0]) throw courseProblem('Course revision not found.', 404);
  await client.query(
    'SELECT id FROM medication_courses WHERE id=$1 AND user_id=$2 FOR UPDATE',
    [target.rows[0].course_id, owner]
  );
  await client.query(
    'SELECT id FROM medication_course_revisions WHERE id=$1 AND user_id=$2 FOR UPDATE',
    [attribution.course_revision_id, owner]
  );
  const course = await loadMedicationCourse(
    client,
    owner,
    target.rows[0].course_id
  );
  const revision = course?.revisions.find(
    (r) => r.id === attribution.course_revision_id
  );
  if (
    !course ||
    course.deleted_at ||
    !revision ||
    revision.deleted_at ||
    course.medication_id !== medicationId
  )
    throw courseProblem(
      'Course attribution does not match this medication.',
      404
    );
  if (
    attribution.course_expected_version !== undefined &&
    course.version !== attribution.course_expected_version
  )
    throw courseProblem('Course changed. Refresh the selected course.');
  if (
    attribution.course_rule_id &&
    !revision.rules.some((r) => r.id === attribution.course_rule_id)
  )
    throw courseProblem('Course rule does not match this revision.', 422);
  if (
    attribution.course_step_id &&
    !revision.steps.some((s) => s.id === attribution.course_step_id)
  )
    throw courseProblem('Course step does not match this revision.', 422);
  if (
    (attribution.scheduled_for || attribution.scheduled_day) &&
    !attribution.course_slot_key
  )
    throw courseProblem(
      'A recorded course schedule instant requires a selected course slot.',
      422
    );
  if (attribution.course_slot_key) {
    const actuals = await loadCourseActuals(client, owner, course.id);
    const incomingStatus = attribution.status ?? 'taken';
    const incomingFulfilled = ['taken', 'prn_taken', 'skipped'].includes(
      incomingStatus
    );
    if (
      incomingFulfilled &&
      actuals.some(
        (a) =>
          a.course_revision_id === revision.id &&
          a.course_rule_id === attribution.course_rule_id &&
          a.course_slot_key === attribution.course_slot_key &&
          a.scheduled_day === attribution.scheduled_day &&
          (courseAdministered(a) || a.status === 'skipped') &&
          !(
            existingActual &&
            a.id === existingActual.id &&
            a.source_kind === existingActual.source_kind
          )
      )
    )
      throw courseProblem(
        'This scheduled course slot already has a recorded taken or skipped entry. Refresh or edit that entry.'
      );
    const saved = existingActual
      ? actuals.find(
          (a) =>
            a.id === existingActual.id &&
            a.source_kind === existingActual.source_kind
        )
      : undefined;
    const unchangedSavedSlot =
      saved !== undefined &&
      saved.course_revision_id === revision.id &&
      saved.course_rule_id === (attribution.course_rule_id ?? null) &&
      saved.course_slot_key === attribution.course_slot_key &&
      saved.scheduled_day === (attribution.scheduled_day ?? null) &&
      saved.scheduled_for ===
        (attribution.scheduled_for ? iso(attribution.scheduled_for) : null);
    if (unchangedSavedSlot) return;
    if (course.current_revision_id === null)
      throw courseProblem(
        'This course has no running revision. Use explicit historical logging instead.'
      );
    if (medicationId === null)
      throw courseProblem(
        'A deleted medication has no current scheduled course slots.'
      );
    if (
      attribution.course_expected_version === undefined ||
      !attribution.scheduled_day ||
      !attribution.course_rule_id
    )
      throw courseProblem(
        'Refresh and select a current scheduled course slot.'
      );
    const med = await client.query<{ is_active: boolean }>(
      'SELECT is_active FROM medications WHERE user_id=$1 AND id=$2',
      [owner, medicationId]
    );
    const context = await loadCourseOwnerContext(client, owner, now);
    const slots = courseSlotsForDay({
      course,
      day: attribution.scheduled_day,
      today: context.today,
      nowInstant: now.toISOString(),
      medicationActive: med.rows[0]?.is_active === true,
      delivered: deliveredCourseInputs(actuals),
    });
    const slot = slots.find(
      (s) =>
        s.course_revision_id === revision.id &&
        s.course_rule_id === attribution.course_rule_id &&
        s.course_slot_key === attribution.course_slot_key
    );
    if (
      !slot ||
      (attribution.scheduled_for ? iso(attribution.scheduled_for) : null) !==
        (slot.scheduled_for ?? null)
    )
      throw courseProblem(
        'The selected scheduled course slot changed. Refresh the course.'
      );
  }
}
const legacyRuleFields = [
  'schedule_type_id',
  'time_of_day',
  'dose_amount',
  'days_of_week',
  'interval_days',
  'day_of_month',
  'cycle_on_days',
  'cycle_off_days',
  'with_meal',
  'prn_reason',
  'prn_max_per_day',
  'start_date',
  'active',
  'medication_id',
  'user_id',
];
/** Caller locks the medication and selected legacy rule first. A handoff keeps its legacy denominator bounded. */
export async function guardLegacyScheduleMutation(
  client: PoolClient,
  owner: string,
  scheduleId: string,
  patch: Record<string, unknown> | null
): Promise<void> {
  const handoff = await client.query<{ capped_end_date: string }>(
    'SELECT capped_end_date FROM medication_course_handoffs WHERE user_id=$1 AND schedule_id=$2',
    [owner, scheduleId]
  );
  if (!handoff.rows[0]) return;
  if (patch === null)
    throw courseProblem(
      'This handed-over legacy rule is retained for history and cannot be deleted.'
    );
  const old = await client.query<Record<string, unknown>>(
    'SELECT *,dose_amount::text FROM medication_schedules WHERE user_id=$1 AND id=$2',
    [owner, scheduleId]
  );
  const before = old.rows[0];
  if (!before) throw courseProblem('Schedule not found.', 404);
  const compare = (field: string, value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (field === 'dose_amount') return normalizePurchaseDecimal(String(value));
    if (field === 'time_of_day') {
      const time = String(value);
      return time.length === 5 ? time + ':00' : time;
    }
    if (field === 'days_of_week' && Array.isArray(value))
      return [...new Set(value)].sort();
    if (field === 'start_date') return String(value).slice(0, 10);
    return value;
  };
  for (const field of legacyRuleFields)
    if (
      patch[field] !== undefined &&
      courseFingerprint(compare(field, patch[field])) !==
        courseFingerprint(compare(field, before[field]))
    )
      throw courseProblem(
        'This handed-over legacy rule is retained for history. Edit the course instead.'
      );
  if (
    patch.end_date !== undefined &&
    (patch.end_date === null ||
      String(patch.end_date) > handoff.rows[0].capped_end_date)
  )
    throw courseProblem(
      'This handed-over legacy rule cannot be expanded past its saved end cap.'
    );
}

export async function courseOperationReceipt(
  client: PoolClient,
  owner: string,
  operationId: string,
  hash: string
): Promise<MedicationCourseMutationResult | null> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${owner}:${operationId}`,
  ]);
  const old = await client.query<{
    request_hash: string;
    actor_id: string;
    result: MedicationCourseMutationResult;
  }>(
    'SELECT request_hash,actor_id,result FROM medication_course_operations WHERE user_id=$1 AND operation_id=$2',
    [owner, operationId]
  );
  if (!old.rows[0]) return null;
  if (
    old.rows[0].request_hash !== hash ||
    old.rows[0].actor_id !== courseActor(owner)
  )
    throw courseProblem(
      'This operation ID was already used for a different request.'
    );
  return old.rows[0].result;
}
export async function saveCourseReceipt(
  client: PoolClient,
  owner: string,
  action: string,
  hash: string,
  result: MedicationCourseMutationResult
): Promise<void> {
  await client.query(
    'INSERT INTO medication_course_operations(user_id,operation_id,actor_id,request_hash,course_id,action,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [
      owner,
      result.operation_id,
      courseActor(owner),
      hash,
      result.course_id,
      action,
      JSON.stringify(result),
    ]
  );
}

const ruleFields = [
  'schedule_type_id',
  'time_of_day',
  'dose_amount',
  'days_of_week',
  'interval_days',
  'day_of_month',
  'cycle_on_days',
  'cycle_off_days',
  'with_meal',
  'prn_reason',
  'prn_max_per_day',
  'start_date',
  'end_date',
  'anchor_date',
] as const;
export async function storeCourseChildren(
  client: PoolClient,
  owner: string,
  revisionId: string,
  plan: MedicationCoursePlanInput,
  existing?: MedicationCourseRevision
): Promise<void> {
  for (let i = 0; i < plan.rules.length; i++) {
    const rule = plan.rules[i]!;
    const old = existing?.rules.find((r) => r.rule_index === i);
    const values = ruleFields.map((k) => rule[k] ?? null);
    if (old)
      await client.query(
        `UPDATE medication_course_rules SET ${ruleFields.map((k, n) => `${k}=$${n + 4}`).join(',')} WHERE id=$1 AND user_id=$2 AND revision_id=$3`,
        [old.id, owner, revisionId, ...values]
      );
    else
      await client.query(
        `INSERT INTO medication_course_rules(id,user_id,revision_id,rule_index,${ruleFields.join(',')}) VALUES(${Array.from({ length: ruleFields.length + 4 }, (_, n) => `$${n + 1}`).join(',')})`,
        [randomUUID(), owner, revisionId, i, ...values]
      );
  }
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const old = existing?.steps.find((s) => s.step_index === i);
    if (old)
      await client.query(
        'UPDATE medication_course_steps SET dose=$4,dose_unit=$5,duration_days=$6,notes=$7 WHERE id=$1 AND user_id=$2 AND revision_id=$3',
        [
          old.id,
          owner,
          revisionId,
          step.dose,
          step.dose_unit,
          step.duration_days,
          step.notes ?? null,
        ]
      );
    else
      await client.query(
        'INSERT INTO medication_course_steps(id,user_id,revision_id,step_index,dose,dose_unit,duration_days,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          owner,
          revisionId,
          i,
          step.dose,
          step.dose_unit,
          step.duration_days,
          step.notes ?? null,
        ]
      );
  }
  const removedRules =
    existing?.rules
      .filter((r) => r.rule_index >= plan.rules.length)
      .map((r) => r.id) ?? [];
  const removedSteps =
    existing?.steps
      .filter((s) => s.step_index >= plan.steps.length)
      .map((s) => s.id) ?? [];
  if (removedRules.length) {
    for (const table of ['medication_entries', 'injection_entries'])
      await client.query(
        `UPDATE ${table} SET course_rule_id=NULL,course_slot_key=NULL WHERE user_id=$1 AND course_rule_id=ANY($2::uuid[])`,
        [owner, removedRules]
      );
    await client.query(
      'DELETE FROM medication_course_rules WHERE user_id=$1 AND id=ANY($2::uuid[])',
      [owner, removedRules]
    );
  }
  if (removedSteps.length) {
    for (const table of ['medication_entries', 'injection_entries'])
      await client.query(
        `UPDATE ${table} SET course_step_id=NULL WHERE user_id=$1 AND course_step_id=ANY($2::uuid[])`,
        [owner, removedSteps]
      );
    await client.query(
      'DELETE FROM medication_course_steps WHERE user_id=$1 AND id=ANY($2::uuid[])',
      [owner, removedSteps]
    );
  }
}
export async function insertCourseRevision(
  client: PoolClient,
  owner: string,
  courseId: string,
  revisionId: string,
  revisionNo: number,
  predecessorId: string | null,
  plan: MedicationCoursePlanInput,
  now: Date,
  initialActivityAt: string | null,
  device: Pick<MedicationCourseRevision, 'device_id' | 'device_choice'> = {
    device_id: plan.device_id ?? null,
    device_choice: plan.device_id ? 'explicit' : 'preferred',
  }
): Promise<void> {
  await client.query(
    'INSERT INTO medication_course_revisions(id,user_id,course_id,predecessor_id,revision_no,name,notes,start_date,end_date,cycle_anchor_date,target_dose,dose_unit,dose_basis,created_at,device_id,device_choice) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
    [
      revisionId,
      owner,
      courseId,
      predecessorId,
      revisionNo,
      plan.name,
      plan.notes ?? null,
      plan.start_date,
      plan.end_date ?? null,
      plan.cycle_anchor_date ?? null,
      plan.target_dose ?? null,
      plan.dose_unit,
      plan.dose_basis,
      now,
      device.device_id,
      device.device_choice,
    ]
  );
  await storeCourseChildren(client, owner, revisionId, plan);
  if (initialActivityAt !== null)
    await client.query(
      'INSERT INTO medication_course_activity(id,user_id,revision_id,from_at) VALUES($1,$2,$3,$4)',
      [randomUUID(), owner, revisionId, initialActivityAt]
    );
}
