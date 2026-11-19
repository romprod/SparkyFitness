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
  await client.query(
    'DELETE FROM medication_stack_members WHERE stack_id = $1',
    [stackId]
  );
  for (const [position, medicationId] of medicationIds.entries())
    await client.query(
      'INSERT INTO medication_stack_members(stack_id, user_id, medication_id, position) VALUES($1,$2,$3,$4)',
      [stackId, owner, medicationId, position]
    );
}

const duplicateName = (error: unknown) =>
  (error as { code?: string }).code === '23505'
    ? fail('You already have a stack with that name.', 409)
    : error;

export async function createStack(
  owner: string,
  input: MedicationStackInput
): Promise<string> {
  const client: PoolClient = await getClient(owner);
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO medication_stacks(user_id, name, notes) VALUES($1,$2,$3) RETURNING id',
      [owner, input.name, input.notes]
    );
    const id = rows[0]!.id;
    await replaceMembers(client, owner, id, input.medication_ids);
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw duplicateName(error);
  } finally {
    client.release();
  }
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
