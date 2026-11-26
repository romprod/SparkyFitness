import {
  prescriptionCostBasis,
  type PrescriptionCostBasis,
} from '../services/medicationPrescriptionCostBasis.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  medicationPrescriptionCreateSchemaV2,
  medicationPrescriptionUpdateSchemaV2,
  medicationPrescriptionDeleteSchema,
  type MedicationPrescription,
  type MedicationPrescriptionCoverage,
  type MedicationPrescriptionCreate,
  type MedicationPrescriptionCreateV2,
  type MedicationPrescriptionUpdate,
  type MedicationPrescriptionUpdateV2,
  type MedicationPrescriptionDelete,
  type MedicationPrescriptionMutationResult,
  type MedicationPrescriptionV2,
} from '@workspace/shared';
import { getClient, dbContextStorage } from '../db/poolManager.js';
import { encrypt, decrypt, ENCRYPTION_KEY } from '../security/encryption.js';
const problem = (message: string, statusCode = 409, code?: string) =>
  Object.assign(new Error(message), {
    statusCode,
    status: statusCode,
    ...(code ? { code } : {}),
  });
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
interface CoverageRow {
  id: string;
  medication_id: string | null;
  position: number;
}
interface LockedPrescriptionCost {
  medication_id: string | null;
  version: number;
  cost: string | null;
  currency: string;
  cost_basis: PrescriptionCostBasis;
}
interface LockedPrescription extends LockedPrescriptionCost {
  coverage: CoverageRow[];
}
/** Model 1 is the one-medicine contract; model 2 adds the covered medicines. */
export type PrescriptionModel = 1 | 2;
const liveIds = (rows: CoverageRow[]) =>
  rows.flatMap((row) => (row.medication_id ? [row.medication_id] : []));
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
  medications: Array<{
    medication_id: string | null;
    medication_name: string;
  }> | null;
  source_encrypted: Envelope | null;
  prescriber_encrypted: Envelope | null;
  pharmacy_encrypted: Envelope | null;
  dose_instructions_encrypted: Envelope | null;
};
const cols =
  'c.medications,p.id,p.user_id,p.medication_id,p.cost_basis,COALESCE(CASE WHEN length(m.display_name)>0 THEN m.display_name END,m.name,p.medication_name_snapshot) AS medication_name,p.source_encrypted,p.prescriber_encrypted,p.pharmacy_encrypted,p.dose_instructions_encrypted,p.cost::text,p.currency,p.quantity,p.refills_authorized,p.refills_remaining,p.date_written::text,p.next_refill::text,p.expiration::text,p.lead_time_days,p.status,p.version,p.created_at::text,p.updated_at::text';
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
const titleSeparator = ' + ';
async function read(
  client: PoolClient,
  owner: string,
  id: string | undefined,
  model: PrescriptionModel
): Promise<Array<MedicationPrescription | MedicationPrescriptionV2>> {
  const result = await client.query<Stored>(
    `SELECT ${cols} FROM medication_prescriptions p LEFT JOIN medications m ON m.id=p.medication_id AND m.user_id=p.user_id LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('medication_id',j.medication_id,'medication_name',COALESCE(CASE WHEN length(cm.display_name)>0 THEN cm.display_name END,cm.name,j.medication_name_snapshot)) ORDER BY j.position,j.created_at,j.id) AS medications FROM medication_prescription_medications j LEFT JOIN medications cm ON cm.id=j.medication_id AND cm.user_id=j.user_id WHERE j.prescription_id=p.id AND j.user_id=p.user_id) c ON true WHERE p.user_id=$1${id ? ' AND p.id=$2' : ''} ORDER BY p.status,p.expiration,p.id`,
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
        medications,
        ...visible
      } = row;
      const covered: MedicationPrescriptionCoverage[] = (medications ?? []).map(
        (entry, position) => ({ ...entry, position })
      );
      // One medicine keeps its own name; several are titled by their joined names.
      const title =
        covered.length > 1
          ? covered.map((entry) => entry.medication_name).join(titleSeparator)
          : (covered[0]?.medication_name ?? visible.medication_name);
      return {
        ...visible,
        medication_name: title,
        // Only the model 2 contract knows every basis; model 1 shows the original per-vial one.
        ...(cost_basis === null ||
        cost_basis === undefined ||
        (model === 1 && cost_basis !== 'per_vial')
          ? {}
          : { cost_basis }),
        created_at: new Date(visible.created_at).toISOString(),
        updated_at: new Date(visible.updated_at).toISOString(),
        source: await decode(source_encrypted),
        prescriber: await decode(prescriber_encrypted),
        pharmacy: await decode(pharmacy_encrypted),
        dose_instructions: await decode(dose_instructions_encrypted),
        ...(model === 2
          ? {
              medications: covered.length
                ? covered
                : [
                    {
                      medication_id: visible.medication_id,
                      medication_name: title,
                      position: 0,
                    },
                  ],
            }
          : {}),
      };
    })
  );
}
export async function listMedicationPrescriptions(
  owner: string,
  expected?: string,
  model: PrescriptionModel = 1
) {
  assertPrescriptionOwner(owner, expected);
  const c: PoolClient = await getClient(owner);
  try {
    return await read(c, owner, undefined, model);
  } finally {
    c.release();
  }
}
export async function getMedicationPrescription(
  owner: string,
  id: string,
  expected?: string,
  model: PrescriptionModel = 1
) {
  assertPrescriptionOwner(owner, expected);
  const c: PoolClient = await getClient(owner);
  try {
    const row = (await read(c, owner, id, model))[0];
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
  // The prescription must cover the medication; the lock on its coverage row
  // keeps a concurrent removal of that medicine from the prescription out.
  const rx = await client.query<{ id: string }>(
    'SELECT p.id FROM medication_prescriptions p JOIN medication_prescription_medications j ON j.prescription_id=p.id AND j.user_id=p.user_id WHERE p.id=$1 AND p.user_id=$2 AND j.medication_id=$3 FOR KEY SHARE OF p, j',
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
async function coverageRows(client: PoolClient, id: string, lock = false) {
  const rows = await client.query<CoverageRow>(
    `SELECT id,medication_id,position FROM medication_prescription_medications WHERE prescription_id=$1 ORDER BY position,created_at,id${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows.rows;
}
/**
 * Locks parents before children: the covered and requested medicines in id order (so two
 * prescriptions sharing medicines cannot deadlock), then every plan and stock row that links
 * the prescription, then the prescription and its coverage rows. Omitted bindings never lock.
 */
async function lockParents(
  client: PoolClient,
  owner: string,
  id: string | undefined,
  requested: string[] = []
): Promise<LockedPrescription | null> {
  const initial = id
    ? await client.query<LockedPrescriptionCost>(
        'SELECT medication_id,version,cost::text,currency,cost_basis FROM medication_prescriptions WHERE user_id=$1 AND id=$2',
        [owner, id]
      )
    : null;
  if (id && !initial?.rows[0]) throw problem('Prescription not found.', 404);
  const before = id ? await coverageRows(client, id) : [];
  const medicines = [...new Set([...liveIds(before), ...requested])].sort();
  if (medicines.length) {
    const locked = await client.query(
      'SELECT id FROM medications WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [owner, medicines]
    );
    if (locked.rows.length !== medicines.length)
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
    const coverage = await coverageRows(client, id, true);
    if (
      !locked.rows[0] ||
      locked.rows[0].medication_id !== initial?.rows[0]?.medication_id ||
      coverage.length !== before.length ||
      coverage.some(
        (row, index) =>
          row.id !== before[index]?.id ||
          row.medication_id !== before[index]?.medication_id
      )
    )
      throw problem('Prescription changed. Refresh before saving.');
    return { ...locked.rows[0], coverage };
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
  // The payload is the request as authored: a legacy single-medicine body hashes exactly as it did
  // before several medicines existed, so a retried older operation still replays.
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
const medicationName = "COALESCE(NULLIF(display_name,''),name) AS name";
async function medicationNames(
  c: PoolClient,
  owner: string,
  ids: string[]
): Promise<Map<string, string>> {
  const rows = await c.query<{ id: string; name: string }>(
    `SELECT id,${medicationName} FROM medications WHERE user_id=$1 AND id=ANY($2::uuid[])`,
    [owner, ids]
  );
  return new Map(rows.rows.map((row) => [row.id, row.name]));
}
/** A per-vial price is one unit price: it cannot sit on a fill that covers several medicines. */
function assertBasisFitsCoverage(
  basis: PrescriptionCostBasis,
  liveCount: number
) {
  if (basis === 'per_vial' && liveCount > 1)
    throw problem(
      'A per-vial price belongs to one medication. Clear the per-vial price or enter a total price for the prescription.',
      422,
      'cost_basis_per_vial_needs_one_medication'
    );
}
export async function createMedicationPrescription(
  owner: string,
  input: MedicationPrescriptionCreate | MedicationPrescriptionCreateV2,
  expected?: string
) {
  const data = medicationPrescriptionCreateSchemaV2.parse(input);
  assertPrescriptionOwner(owner, expected);
  return operation(
    owner,
    data.operation_id,
    { action: 'create', data },
    async (c) => {
      const ids = data.medication_ids ?? [data.medication_id!];
      await lockParents(c, owner, undefined, ids);
      const names = await medicationNames(c, owner, ids);
      const basis = prescriptionCostBasis(data);
      assertBasisFitsCoverage(basis, ids.length);
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
      const values: unknown[] = [id, owner, ids[0], names.get(ids[0]!)];
      for (const field of privateFields)
        values.push(await encode(data[field] ?? null));
      for (const field of publicFields)
        values.push(data[field] ?? (field === 'status' ? 'active' : null));
      values.push(basis);
      await c.query(
        `INSERT INTO medication_prescriptions(${fields.join(',')}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')})`,
        values
      );
      for (const [position, medication] of ids.entries())
        await c.query(
          'INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot,position) VALUES($1,$2,$3,$4,$5)',
          [id, owner, medication, names.get(medication), position]
        );
      return { id, version: 1, deleted: false };
    }
  );
}
/** Replaces the live covered set as a diff: unchanged rows keep their identity, tombstones stay. */
async function applyCoverage(
  c: PoolClient,
  owner: string,
  id: string,
  current: CoverageRow[],
  next: string[]
) {
  const live = new Map(
    current.flatMap((row) =>
      row.medication_id ? [[row.medication_id, row] as const] : []
    )
  );
  const wanted = new Set(next);
  const removed = [...live.keys()].filter(
    (medication) => !wanted.has(medication)
  );
  if (removed.length) {
    const links = await c.query<{ pens: number; plans: number }>(
      'SELECT (SELECT count(*) FROM medication_pens WHERE user_id=$1 AND prescription_id=$2 AND medication_id=ANY($3::uuid[]))::int AS pens,(SELECT count(*) FROM medication_course_revisions r JOIN medication_courses c ON c.id=r.course_id AND c.user_id=r.user_id WHERE r.user_id=$1 AND r.prescription_id=$2 AND c.medication_id=ANY($3::uuid[]))::int AS plans',
      [owner, id, removed]
    );
    const { pens, plans } = links.rows[0]!;
    if (pens || plans) {
      const names = await medicationNames(c, owner, removed);
      throw problem(
        `Cannot remove ${removed.map((medication) => names.get(medication) ?? 'a medication').join(', ')} while ${pens} stock item${pens === 1 ? '' : 's'} and ${plans} plan revision${plans === 1 ? '' : 's'} still link this prescription. Unlink them first.`,
        409,
        'prescription_medication_linked'
      );
    }
  }
  const added = next.filter((medication) => !live.has(medication));
  if (added.length) {
    const names = await medicationNames(c, owner, added);
    for (const medication of added)
      await c.query(
        'INSERT INTO medication_prescription_medications(prescription_id,user_id,medication_id,medication_name_snapshot,position) VALUES($1,$2,$3,$4,$5)',
        [id, owner, medication, names.get(medication), 1000000]
      );
  }
  if (removed.length)
    await c.query(
      'DELETE FROM medication_prescription_medications WHERE prescription_id=$1 AND user_id=$2 AND medication_id=ANY($3::uuid[])',
      [id, owner, removed]
    );
  // Dense order: the requested medicines first (the first is the primary), then the tombstones.
  const rows = await coverageRows(c, id);
  const order = [
    ...next.flatMap((medication) => {
      const row = rows.find(
        (candidate) => candidate.medication_id === medication
      );
      return row ? [row] : [];
    }),
    ...rows.filter((row) => row.medication_id === null),
  ];
  for (const [position, row] of order.entries())
    if (row.position !== position)
      await c.query(
        'UPDATE medication_prescription_medications SET position=$2 WHERE id=$1',
        [row.id, position]
      );
}
export async function updateMedicationPrescription(
  owner: string,
  id: string,
  input: MedicationPrescriptionUpdate | MedicationPrescriptionUpdateV2,
  expected?: string
) {
  const data = medicationPrescriptionUpdateSchemaV2.parse(input);
  assertPrescriptionOwner(owner, expected);
  return operation(
    owner,
    data.operation_id,
    { action: 'update', id, data },
    async (c) => {
      const old = (await lockParents(c, owner, id, data.medication_ids))!;
      if (old.version !== data.expected_version)
        throw problem('Prescription changed. Refresh before saving.');
      // The legacy column is only an echo of the current primary medicine.
      if (
        data.medication_id !== undefined &&
        data.medication_id !== old.medication_id
      )
        throw problem('The prescription medication cannot be changed.', 422);
      const basis = prescriptionCostBasis(data, {
        cost: old.cost,
        currency: old.currency,
        cost_basis: old.cost_basis,
      });
      assertBasisFitsCoverage(
        basis,
        data.medication_ids?.length ?? liveIds(old.coverage).length
      );
      if (data.medication_ids)
        await applyCoverage(c, owner, id, old.coverage, data.medication_ids);
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
      values.push(basis);
      setters.push('cost_basis=$' + values.length);
      await c.query(
        `UPDATE medication_prescriptions SET ${[...setters, 'version=version+1', 'updated_at=NOW()'].join(',')} WHERE user_id=$1 AND id=$2 AND version=$3`,
        values
      );
      return { id, version: old.version + 1, deleted: false };
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
