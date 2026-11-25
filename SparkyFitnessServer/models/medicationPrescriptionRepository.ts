import {
  prescriptionCostBasis,
  type PrescriptionCostBasis,
} from '../services/medicationPrescriptionCostBasis.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  medicationPrescriptionCreateSchema,
  medicationPrescriptionUpdateSchema,
  medicationPrescriptionDeleteSchema,
  type MedicationPrescription,
  type MedicationPrescriptionCreate,
  type MedicationPrescriptionUpdate,
  type MedicationPrescriptionDelete,
  type MedicationPrescriptionMutationResult,
} from '@workspace/shared';
import { getClient, dbContextStorage } from '../db/poolManager.js';
import { encrypt, decrypt, ENCRYPTION_KEY } from '../security/encryption.js';
const problem = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });
export const prescriptionActor = (owner: string) =>
  dbContextStorage.getStore()?.authenticatedUserId ?? owner;
export function assertPrescriptionOwner(owner: string, expected?: string) {
  if (
    prescriptionActor(owner) !== owner ||
    (expected !== undefined && expected !== owner)
  )
    throw problem(
      'Prescriptions are private to the expected signed-in owner.',
      403
    );
}
interface Envelope {
  encryptedText: string | null;
  iv: string | null;
  tag: string | null;
}
interface LockedPrescriptionCost {
  medication_id: string | null;
  version: number;
  cost: string | null;
  currency: string;
  cost_basis: PrescriptionCostBasis;
}
const privateFields = [
  'source',
  'prescriber',
  'pharmacy',
  'dose_instructions',
] as const;
const publicFields = [
  'cost',
  'currency',
  'quantity',
  'refills_authorized',
  'refills_remaining',
  'date_written',
  'next_refill',
  'expiration',
  'lead_time_days',
  'status',
] as const;
type PrivateField = (typeof privateFields)[number];
type Stored = Omit<MedicationPrescription, PrivateField | 'medication_name'> & {
  medication_name: string;
  source_encrypted: Envelope | null;
  prescriber_encrypted: Envelope | null;
  pharmacy_encrypted: Envelope | null;
  dose_instructions_encrypted: Envelope | null;
};
const cols =
  'p.id,p.user_id,p.medication_id,p.cost_basis,COALESCE(CASE WHEN length(m.display_name)>0 THEN m.display_name END,m.name,p.medication_name_snapshot) AS medication_name,p.source_encrypted,p.prescriber_encrypted,p.pharmacy_encrypted,p.dose_instructions_encrypted,p.cost::text,p.currency,p.quantity,p.refills_authorized,p.refills_remaining,p.date_written::text,p.next_refill::text,p.expiration::text,p.lead_time_days,p.status,p.version,p.created_at::text,p.updated_at::text';
const encode = async (value: string | null): Promise<Envelope | null> =>
  value ? ((await encrypt(value, ENCRYPTION_KEY)) as Envelope) : null;
const decode = async (value: Envelope | null): Promise<string | null> =>
  value
    ? ((await decrypt(
        value.encryptedText,
        value.iv,
        value.tag,
        ENCRYPTION_KEY
      )) as string | null)
    : null;
async function read(
  client: PoolClient,
  owner: string,
  id?: string
): Promise<MedicationPrescription[]> {
  const result = await client.query<Stored>(
    `SELECT ${cols} FROM medication_prescriptions p LEFT JOIN medications m ON m.id=p.medication_id AND m.user_id=p.user_id WHERE p.user_id=$1${id ? ' AND p.id=$2' : ''} ORDER BY p.status,p.expiration,p.id`,
    id ? [owner, id] : [owner]
  );
  return Promise.all(
    result.rows.map(async (row) => {
      const {
        source_encrypted,
        cost_basis,
        prescriber_encrypted,
        pharmacy_encrypted,
        dose_instructions_encrypted,
        ...visible
      } = row;
      return {
        ...visible,
        ...(cost_basis === null || cost_basis === undefined
          ? {}
          : { cost_basis }),
        created_at: new Date(visible.created_at).toISOString(),
        updated_at: new Date(visible.updated_at).toISOString(),
        source: await decode(source_encrypted),
        prescriber: await decode(prescriber_encrypted),
        pharmacy: await decode(pharmacy_encrypted),
        dose_instructions: await decode(dose_instructions_encrypted),
      };
    })
  );
}
export async function listMedicationPrescriptions(
  owner: string,
  expected?: string
) {
  assertPrescriptionOwner(owner, expected);
  const c: PoolClient = await getClient(owner);
  try {
    return await read(c, owner);
  } finally {
    c.release();
  }
}
export async function getMedicationPrescription(
  owner: string,
  id: string,
  expected?: string
) {
  assertPrescriptionOwner(owner, expected);
  const c: PoolClient = await getClient(owner);
  try {
    const row = (await read(c, owner, id))[0];
    if (!row) throw problem('Prescription not found.', 404);
    return row;
  } finally {
    c.release();
  }
}
/** Call only after the parent's medication/course/stock locks. Omitted bindings never acquire an Rx lock. */
export async function validatePrescriptionLink(
  client: PoolClient,
  owner: string,
  medicationId: string | null,
  input: { prescription_id?: string | null },
  previous: string | null = null
): Promise<string | null> {
  if (input.prescription_id === undefined) return previous;
  assertPrescriptionOwner(owner);
  if (input.prescription_id === null) return null;
  if (!medicationId)
    throw problem('A prescription link requires an existing medication.', 422);
  const rx = await client.query<{ id: string }>(
    'SELECT id FROM medication_prescriptions WHERE id=$1 AND user_id=$2 AND medication_id=$3 FOR KEY SHARE',
    [input.prescription_id, owner, medicationId]
  );
  if (!rx.rows.length)
    throw problem('Select a prescription for this owned medication.', 422);
  return input.prescription_id;
}
export function publicPrescriptionCourse<
  T extends { revisions: Array<{ prescription_id?: string | null }> },
>(course: T, owner: string): T {
  return {
    ...course,
    revisions: course.revisions.map((revision) =>
      publicPrescriptionLink(revision, owner)
    ),
  };
}
export function publicPrescriptionLink<
  T extends { prescription_id?: string | null },
>(row: T, owner: string): T {
  if (prescriptionActor(owner) === owner) return row;
  const copy = { ...row };
  delete copy.prescription_id;
  return copy;
}
async function lockParents(
  client: PoolClient,
  owner: string,
  id: string | undefined,
  medicationId?: string
): Promise<LockedPrescriptionCost | null> {
  const initial = id
    ? await client.query<LockedPrescriptionCost>(
        'SELECT medication_id,version,cost::text,currency,cost_basis FROM medication_prescriptions WHERE user_id=$1 AND id=$2',
        [owner, id]
      )
    : null;
  if (id && !initial?.rows[0]) throw problem('Prescription not found.', 404);
  const med = medicationId ?? initial?.rows[0]?.medication_id ?? null;
  if (med) {
    const locked = await client.query(
      'SELECT id FROM medications WHERE user_id=$1 AND id=$2 FOR UPDATE',
      [owner, med]
    );
    if (!locked.rows.length)
      throw problem('Medication changed. Refresh the prescription.', 409);
  }
  if (id) {
    const courses = await client.query<{ id: string }>(
      'SELECT DISTINCT c.id FROM medication_courses c JOIN medication_course_revisions r ON r.course_id=c.id AND r.user_id=c.user_id WHERE c.user_id=$1 AND r.prescription_id=$2 ORDER BY c.id',
      [owner, id]
    );
    for (const course of courses.rows) {
      await client.query(
        'SELECT id FROM medication_courses WHERE user_id=$1 AND id=$2 FOR UPDATE',
        [owner, course.id]
      );
      await client.query(
        'SELECT id FROM medication_course_revisions WHERE user_id=$1 AND course_id=$2 ORDER BY revision_no,id FOR UPDATE',
        [owner, course.id]
      );
    }
    await client.query(
      'SELECT id FROM medication_pens WHERE user_id=$1 AND prescription_id=$2 ORDER BY id FOR UPDATE',
      [owner, id]
    );
    const locked = await client.query<LockedPrescriptionCost>(
      'SELECT medication_id,version,cost::text,currency,cost_basis FROM medication_prescriptions WHERE user_id=$1 AND id=$2 FOR UPDATE',
      [owner, id]
    );
    if (
      !locked.rows[0] ||
      locked.rows[0].medication_id !== initial?.rows[0]?.medication_id
    )
      throw problem('Prescription changed. Refresh before saving.');
    return locked.rows[0];
  }
  return null;
}
async function operation(
  owner: string,
  operationId: string,
  payload: unknown,
  work: (c: PoolClient) => Promise<MedicationPrescriptionMutationResult>
): Promise<MedicationPrescriptionMutationResult> {
  const c: PoolClient = await getClient(owner);
  const hash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'medication-prescriptions:' + owner,
    ]);
    const prior = await c.query<{
      request_hash: string;
      result: MedicationPrescriptionMutationResult;
    }>(
      'SELECT request_hash,result FROM medication_prescription_operations WHERE user_id=$1 AND operation_id=$2',
      [owner, operationId]
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].request_hash.length !== hash.length ||
        !timingSafeEqual(
          Buffer.from(prior.rows[0].request_hash),
          Buffer.from(hash)
        )
      )
        throw problem(
          'This operation was already used for a different prescription request.'
        );
      await c.query('COMMIT');
      return prior.rows[0].result;
    }
    const result = await work(c);
    await c.query(
      'INSERT INTO medication_prescription_operations(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
      [owner, operationId, hash, JSON.stringify(result)]
    );
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export async function createMedicationPrescription(
  owner: string,
  input: MedicationPrescriptionCreate,
  expected?: string
) {
  const data = medicationPrescriptionCreateSchema.parse(input);
  assertPrescriptionOwner(owner, expected);
  return operation(
    owner,
    data.operation_id,
    { action: 'create', data },
    async (c) => {
      await lockParents(c, owner, undefined, data.medication_id);
      const med = await c.query<{ name: string }>(
        "SELECT COALESCE(NULLIF(display_name,''),name) AS name FROM medications WHERE id=$1 AND user_id=$2",
        [data.medication_id, owner]
      );
      const id = randomUUID();
      const fields = [
        'id',
        'user_id',
        'medication_id',
        'medication_name_snapshot',
        ...privateFields.map((f) => f + '_encrypted'),
        ...publicFields,
        'cost_basis',
      ];
      const values: unknown[] = [
        id,
        owner,
        data.medication_id,
        med.rows[0]!.name,
      ];
      for (const field of privateFields)
        values.push(await encode(data[field] ?? null));
      for (const field of publicFields)
        values.push(data[field] ?? (field === 'status' ? 'active' : null));
      values.push(prescriptionCostBasis(data));
      await c.query(
        `INSERT INTO medication_prescriptions(${fields.join(',')}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')})`,
        values
      );
      return { id, version: 1, deleted: false };
    }
  );
}
export async function updateMedicationPrescription(
  owner: string,
  id: string,
  input: MedicationPrescriptionUpdate,
  expected?: string
) {
  const data = medicationPrescriptionUpdateSchema.parse(input);
  assertPrescriptionOwner(owner, expected);
  return operation(
    owner,
    data.operation_id,
    { action: 'update', id, data },
    async (c) => {
      const old = await lockParents(c, owner, id);
      if (old!.version !== data.expected_version)
        throw problem('Prescription changed. Refresh before saving.');
      if (
        data.medication_id !== undefined &&
        data.medication_id !== old!.medication_id
      )
        throw problem('The prescription medication cannot be changed.', 422);
      const values: unknown[] = [owner, id, data.expected_version];
      const setters: string[] = [];
      for (const field of privateFields)
        if (data[field] !== undefined) {
          values.push(await encode(data[field]));
          setters.push(field + '_encrypted=$' + values.length);
        }
      for (const field of publicFields)
        if (data[field] !== undefined) {
          values.push(data[field]);
          setters.push(field + '=$' + values.length);
        }
      values.push(
        prescriptionCostBasis(data, {
          cost: old!.cost,
          currency: old!.currency,
          cost_basis: old!.cost_basis,
        })
      );
      setters.push('cost_basis=$' + values.length);
      await c.query(
        `UPDATE medication_prescriptions SET ${[...setters, 'version=version+1', 'updated_at=NOW()'].join(',')} WHERE user_id=$1 AND id=$2 AND version=$3`,
        values
      );
      return { id, version: old!.version + 1, deleted: false };
    }
  );
}
export async function deleteMedicationPrescription(
  owner: string,
  id: string,
  input: MedicationPrescriptionDelete,
  expected?: string
) {
  const data = medicationPrescriptionDeleteSchema.parse(input);
  assertPrescriptionOwner(owner, expected);
  return operation(
    owner,
    data.operation_id,
    { action: 'delete', id, data },
    async (c) => {
      const old = await lockParents(c, owner, id);
      if (old!.version !== data.expected_version)
        throw problem('Prescription changed. Refresh before deleting.');
      // SET NULL performs field-only cleanup after the stable child lock sequence.
      await c.query(
        'DELETE FROM medication_prescriptions WHERE user_id=$1 AND id=$2',
        [owner, id]
      );
      return { id, version: null, deleted: true };
    }
  );
}

/** Only declared course envelopes are projected; unrelated user custom fields are untouched. */
export function publicCoursePrescriptionEnvelope<T>(
  value: T,
  owner: string
): T {
  if (
    prescriptionActor(owner) === owner ||
    value === null ||
    typeof value !== 'object'
  )
    return value;
  const copy = { ...value } as Record<string, unknown>;
  const course = (item: unknown): unknown => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('revisions' in item) ||
      !Array.isArray(item.revisions)
    )
      return item;
    return {
      ...item,
      revisions: item.revisions.map((revision: unknown) => {
        if (!revision || typeof revision !== 'object') return revision;
        const result = { ...revision } as Record<string, unknown>;
        delete result.prescription_id;
        return result;
      }),
    };
  };
  if (copy.course) copy.course = course(copy.course);
  if (Array.isArray(copy.courses)) copy.courses = copy.courses.map(course);
  for (const key of ['plan', 'proposed_plan'])
    if (copy[key] && typeof copy[key] === 'object') {
      const plan = { ...(copy[key] as Record<string, unknown>) };
      delete plan.prescription_id;
      copy[key] = plan;
    }
  return copy as T;
}
