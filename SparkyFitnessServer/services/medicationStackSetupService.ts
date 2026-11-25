import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  courseBucket,
  medicationCourseCreateInputSchema,
  medicationPreparationInputSchema,
  stackComponentAmounts,
  type MedicationCourseMutationResult,
  type MedicationStackSetupInput,
  type MedicationStackSetupResult,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { createMedication } from '../models/medicationRepository.js';
import { createPen } from '../models/medicationPenRepository.js';
import { createStack, loadStack } from '../models/medicationStackRepository.js';
import {
  courseActor,
  courseFingerprint,
  courseOperationReceipt,
  courseProblem,
  loadCourseOwnerContext,
  saveCourseReceipt,
} from '../models/medicationCourseRepository.js';
import {
  assertWrite,
  createCourseInTransaction,
} from './medicationCourseService.js';
import type { CreatePenBody } from '../schemas/medicationSchemas.js';

/**
 * "Set up a premixed stack": for each component, the medicine (found by name or
 * created), its vials with a premixed preparation, and a daily plan dosed at
 * the chosen volume, then the stack that groups them. Everything runs on one
 * client in one transaction; any failure rolls all of it back.
 *
 * Retries are made safe by the course receipt table: the first result is stored
 * under the operation id (action `stack_setup`) and replayed for the same
 * request; the same id with a different request is refused.
 */

type SetupReceipt = MedicationCourseMutationResult & {
  setup: MedicationStackSetupResult;
};

const DUPLICATE_STACK = 'You already have a stack with that name.';

const activePlan = (name: string) =>
  courseProblem(
    `${name} already has an active plan. Add it to a stack from the stack list instead.`
  );

interface ResolvedMedicine {
  id: string | null;
  is_active: boolean;
}

/** The owner's medicine whose name or display name matches, ignoring case and outer spaces; locked for the transaction. */
async function findMedicine(
  client: PoolClient,
  owner: string,
  name: string
): Promise<ResolvedMedicine | null> {
  const { rows } = await client.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM medications
     WHERE user_id = $1
       AND (lower(btrim(name)) = lower(btrim($2)) OR lower(btrim(display_name)) = lower(btrim($2)))
     ORDER BY is_active DESC, created_at, id
     LIMIT 1
     FOR UPDATE`,
    [owner, name]
  );
  return rows[0] ?? null;
}

async function work(
  client: PoolClient,
  owner: string,
  input: MedicationStackSetupInput,
  now: Date
): Promise<MedicationStackSetupResult> {
  const context = await loadCourseOwnerContext(client, owner, now);
  const startDate = input.start_date ?? context.today;

  // Refuse before writing anything.
  const taken = await client.query(
    'SELECT 1 FROM medication_stacks WHERE user_id = $1 AND lower(btrim(name)) = lower(btrim($2))',
    [owner, input.name]
  );
  if (taken.rows.length) throw courseProblem(DUPLICATE_STACK);

  const found: (ResolvedMedicine | null)[] = [];
  for (const component of input.components)
    found.push(await findMedicine(client, owner, component.medication_name));
  const foundIds = found.flatMap((item) => (item ? [item.id!] : []));
  if (new Set(foundIds).size !== foundIds.length)
    throw courseProblem(
      'Two components are the same medicine. Use one component for it.',
      400
    );
  found.forEach((item, index) => {
    if (item && !item.is_active)
      throw courseProblem(
        `${input.components[index]!.medication_name} is archived. Restore it first, or use a different name.`
      );
  });
  if (foundIds.length) {
    const plans = await client.query<{
      medication_id: string;
      status: 'active' | 'paused' | 'completed';
      start_date: string;
      end_date: string | null;
    }>(
      `SELECT c.medication_id, r.status, r.start_date::text AS start_date, r.end_date::text AS end_date
       FROM medication_courses c
       JOIN medication_course_revisions r ON r.id = c.current_revision_id AND r.user_id = c.user_id
       WHERE c.user_id = $1 AND c.medication_id = ANY($2::uuid[])
         AND c.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [owner, foundIds]
    );
    for (const plan of plans.rows) {
      const bucket = courseBucket(plan, context.today);
      if (bucket === 'active' || bucket === 'scheduled' || bucket === 'paused')
        throw activePlan(
          input.components[
            found.findIndex((item) => item?.id === plan.medication_id)
          ]!.medication_name
        );
    }
  }

  if (foundIds.length) {
    // A legacy schedule rule still running would make a second plan for the same medicine.
    const legacy = await client.query<{ medication_id: string }>(
      `SELECT DISTINCT medication_id FROM medication_schedules
       WHERE user_id = $1 AND medication_id = ANY($2::uuid[]) AND active = true
         AND (end_date IS NULL OR end_date >= $3::date)`,
      [owner, foundIds, context.today]
    );
    for (const row of legacy.rows)
      throw courseProblem(
        `${
          input.components[
            found.findIndex((item) => item?.id === row.medication_id)
          ]!.medication_name
        } already has a schedule. Add it to a stack from the stack list instead.`
      );
  }

  const components: MedicationStackSetupResult['components'] = [];
  const stackMedicationIds: string[] = [];
  for (const [index, component] of input.components.entries()) {
    const amounts = stackComponentAmounts(component);
    if (!amounts)
      throw courseProblem('Check the concentration and dose volume.', 400);
    const existing = found[index];
    const created = !existing;
    const medicationId = existing
      ? existing.id!
      : (
          (await createMedication(
            owner,
            { name: component.medication_name, type_id: 'injection' },
            client
          )) as { id: string }
        ).id;

    const preparation = medicationPreparationInputSchema.parse({
      mode: 'premixed',
      label_concentration_value: amounts.concentration_mg_ml,
      label_concentration_unit: 'mg/ml',
      final_volume_ml: String(component.vial_volume_ml),
      prepared_date: context.today,
    });
    // Sparky records a preparation on each vial (stock reads its concentration
    // and volume from it, and a vial without one is queued as "needs
    // preparation"), so premixed stock gets one on every vial it creates.
    const vialIds: string[] = [];
    for (let n = 0; n < component.quantity; n++) {
      const vial = await createPen(
        owner,
        medicationId,
        {
          kind: 'vial',
          status: n === 0 ? 'in_use' : 'sealed',
          ...(n === 0 ? { opened_at: context.today } : {}),
          preparation,
        } as CreatePenBody,
        client
      );
      vialIds.push(vial.id as string);
    }

    const steps = component.steps ?? [];
    const course = await createCourseInTransaction(
      client,
      owner,
      medicationCourseCreateInputSchema.parse({
        name: component.medication_name,
        notes: null,
        start_date: startDate,
        end_date: null,
        target_dose: amounts.dose.value,
        dose_unit: amounts.dose.unit,
        dose_basis: 'per_injection',
        rules: [
          {
            schedule_type_id: 'daily',
            time_of_day: input.time_of_day ?? null,
            dose_amount: steps.length ? null : amounts.dose.value,
          },
        ],
        steps,
        operation_id: randomUUID(),
        expected_version: 0,
        medication_id: medicationId,
        native_reminder_limitation_acknowledged: false,
      }),
      now
    );

    stackMedicationIds.push(medicationId);
    components.push({
      medication_id: medicationId,
      medication_name: component.medication_name,
      medication_created: created,
      vial_ids: vialIds,
      course_id: course.course_id,
      dose_amount: amounts.dose.value,
      dose_unit: amounts.dose.unit,
    });
  }

  const stackId = await createStack(
    owner,
    {
      name: input.name,
      notes: input.notes ?? null,
      medication_ids: stackMedicationIds,
    },
    client
  );
  const stack = await loadStack(client, owner, stackId);
  if (!stack) throw courseProblem('The stack could not be read back.', 500);
  return { operation_id: input.operation_id, stack, components };
}

export async function setupPremixedStack(
  owner: string,
  input: MedicationStackSetupInput,
  now = new Date()
): Promise<MedicationStackSetupResult> {
  await assertWrite(owner);
  const hash = courseFingerprint({
    action: 'stack_setup',
    input,
    actor: courseActor(owner),
  });
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN');
    const old = await courseOperationReceipt<SetupReceipt>(
      client,
      owner,
      input.operation_id,
      hash
    );
    if (old) {
      await client.query('COMMIT');
      return old.setup;
    }
    const setup = await work(client, owner, input, now);
    const receipt: SetupReceipt = {
      course_id: setup.components[0]!.course_id,
      revision_id: null,
      version: 1,
      operation_id: input.operation_id,
      setup,
    };
    await saveCourseReceipt(client, owner, 'stack_setup', hash, receipt);
    await client.query('COMMIT');
    return setup;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
