import type { PoolClient } from 'pg';
import type { MedicationStack, MedicationStackInput } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * Stacks group an owner's medications and supplements. They never alter the
 * members: no schedule, dose, stock or history is read or written here.
 */

const fail = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });

type StackRow = {
  id: string;
  name: string;
  notes: string | null;
  created_at: Date | string;
  members: MedicationStack['members'] | null;
};

const view = (row: StackRow): MedicationStack => ({
  id: row.id,
  name: row.name,
  notes: row.notes,
  members: row.members ?? [],
  created_at: new Date(row.created_at).toISOString(),
});

const SELECT_STACKS = `
  SELECT s.id, s.name, s.notes, s.created_at,
    COALESCE((
      SELECT json_agg(json_build_object(
        'medication_id', m.id,
        'name', COALESCE(NULLIF(m.display_name, ''), m.name),
        'is_supplement', COALESCE(m.is_supplement, false),
        'is_active', COALESCE(m.is_active, true)
      ) ORDER BY sm.position)
      FROM medication_stack_members sm
      JOIN medications m ON m.id = sm.medication_id AND m.user_id = sm.user_id
      WHERE sm.stack_id = s.id
    ), '[]'::json) AS members
  FROM medication_stacks s`;

export async function listStacks(owner: string): Promise<MedicationStack[]> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rows } = await client.query<StackRow>(
      `${SELECT_STACKS} WHERE s.user_id = $1 ORDER BY lower(s.name), s.created_at`,
      [owner]
    );
    return rows.map(view);
  } finally {
    client.release();
  }
}

async function replaceMembers(
  client: PoolClient,
  owner: string,
  stackId: string,
  medicationIds: string[]
) {
  const known = await client.query<{ id: string }>(
    'SELECT id FROM medications WHERE user_id = $1 AND id = ANY($2::uuid[])',
    [owner, medicationIds]
  );
  if (known.rowCount !== medicationIds.length)
    throw fail('One or more medications were not found.', 400);
  // Diff against the current rows so unchanged members keep their row: other
  // tables hang ON DELETE CASCADE rows off a member. (stack_id, position) has
  // no unique constraint, so positions can be rewritten in one statement.
  await client.query(
    'DELETE FROM medication_stack_members WHERE stack_id = $1 AND NOT (medication_id = ANY($2::uuid[]))',
    [stackId, medicationIds]
  );
  await client.query(
    `UPDATE medication_stack_members sm SET position = want.position - 1
     FROM unnest($2::uuid[]) WITH ORDINALITY AS want(medication_id, position)
     WHERE sm.stack_id = $1 AND sm.medication_id = want.medication_id
       AND sm.position <> want.position - 1`,
    [stackId, medicationIds]
  );
  await client.query(
    `INSERT INTO medication_stack_members(stack_id, user_id, medication_id, position)
     SELECT $1::uuid, $2::uuid, want.medication_id, want.position - 1
     FROM unnest($3::uuid[]) WITH ORDINALITY AS want(medication_id, position)
     WHERE NOT EXISTS (
       SELECT 1 FROM medication_stack_members sm
       WHERE sm.stack_id = $1 AND sm.medication_id = want.medication_id
     )
     ORDER BY want.medication_id`,
    [stackId, owner, medicationIds]
  );
}

const duplicateName = (error: unknown) =>
  (error as { code?: string }).code === '23505'
    ? fail('You already have a stack with that name.', 409)
    : error;

/** `joined` is a client inside a transaction the caller owns: no BEGIN, COMMIT, ROLLBACK or release here. */
export async function createStack(
  owner: string,
  input: MedicationStackInput,
  joined?: PoolClient
): Promise<string> {
  const client: PoolClient = joined ?? (await getClient(owner));
  try {
    if (!joined) await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO medication_stacks(user_id, name, notes) VALUES($1,$2,$3) RETURNING id',
      [owner, input.name, input.notes]
    );
    const id = rows[0]!.id;
    await replaceMembers(client, owner, id, input.medication_ids);
    if (!joined) await client.query('COMMIT');
    return id;
  } catch (error) {
    if (!joined) await client.query('ROLLBACK');
    throw duplicateName(error);
  } finally {
    if (!joined) client.release();
  }
}

/** One stack with its members, read on the caller's client (so a transaction sees its own writes). */
export async function loadStack(
  client: PoolClient,
  owner: string,
  id: string
): Promise<MedicationStack | null> {
  const { rows } = await client.query<StackRow>(
    `${SELECT_STACKS} WHERE s.user_id = $1 AND s.id = $2`,
    [owner, id]
  );
  return rows[0] ? view(rows[0]) : null;
}

/** Returns false when the stack does not exist for this owner. */
export async function updateStack(
  owner: string,
  id: string,
  input: MedicationStackInput
): Promise<boolean> {
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'UPDATE medication_stacks SET name = $3, notes = $4 WHERE id = $1 AND user_id = $2',
      [id, owner, input.name, input.notes]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    await replaceMembers(client, owner, id, input.medication_ids);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw duplicateName(error);
  } finally {
    client.release();
  }
}

export async function deleteStack(owner: string, id: string): Promise<boolean> {
  const client: PoolClient = await getClient(owner);
  try {
    const { rowCount } = await client.query(
      'DELETE FROM medication_stacks WHERE id = $1 AND user_id = $2',
      [id, owner]
    );
    return (rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}
