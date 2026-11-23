import type { PoolClient } from 'pg';
import type { MedicationBlend, MedicationBlendInput } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * What the owner's blends are made of. Components are reference data only: no dose, plan, stock
 * or schedule is read or written here.
 */

const fail = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });

type BlendRow = {
  blend_medication_id: string;
  name: string;
  components: MedicationBlend['components'] | null;
};

const selectBlends = (extra = '') => `
  SELECT b.id AS blend_medication_id,
         COALESCE(NULLIF(b.display_name, ''), b.name) AS name,
         COALESCE((
           SELECT json_agg(json_build_object(
             'component_medication_id', c.component_medication_id,
             'name', COALESCE(NULLIF(m.display_name, ''), m.name),
             'mass_mg', trim_scale(c.mass_mg)::text,
             'source', c.source,
             'sort_index', c.sort_index
           ) ORDER BY c.sort_index, c.created_at)
           FROM medication_blend_components c
           JOIN medications m ON m.id = c.component_medication_id
           WHERE c.blend_medication_id = b.id
         ), '[]'::json) AS components
    FROM medications b
   WHERE b.user_id = $1 ${extra}
     AND EXISTS (SELECT 1 FROM medication_blend_components c WHERE c.blend_medication_id = b.id)`;

const view = (row: BlendRow): MedicationBlend => ({
  blend_medication_id: row.blend_medication_id,
  name: row.name,
  components: row.components ?? [],
});

/** Every blend of the owner that has components, by name. */
export async function listBlends(
  owner: string,
  authenticatedUserId?: string
): Promise<MedicationBlend[]> {
  const client: PoolClient = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query<BlendRow>(
      `${selectBlends()} ORDER BY lower(COALESCE(NULLIF(b.display_name, ''), b.name)), b.id`,
      [owner]
    );
    return rows.map(view);
  } finally {
    client.release();
  }
}

/**
 * Replaces the components of one of the owner's medications. An empty list makes it a plain
 * medication again. Refuses a component that is itself a blend, a blend that is already a
 * component of another, and anything that is not the owner's.
 */
export async function replaceBlend(
  owner: string,
  blendId: string,
  input: MedicationBlendInput,
  authenticatedUserId?: string
): Promise<MedicationBlend> {
  const client: PoolClient = await getClient(owner, authenticatedUserId);
  try {
    await client.query('BEGIN');
    const blend = await client.query<{ name: string }>(
      `SELECT COALESCE(NULLIF(display_name, ''), name) AS name
         FROM medications WHERE id = $1 AND user_id = $2`,
      [blendId, owner]
    );
    if (!blend.rowCount) throw fail('Medication not found', 404);

    const ids = input.components.map((row) => row.component_medication_id);
    if (ids.includes(blendId))
      throw fail('A blend cannot contain itself.', 400);
    if (ids.length) {
      const known = await client.query(
        'SELECT 1 FROM medications WHERE user_id = $1 AND id = ANY($2::uuid[])',
        [owner, ids]
      );
      if (known.rowCount !== ids.length)
        throw fail('One or more components were not found.', 400);

      const nested = await client.query<{ name: string }>(
        `SELECT DISTINCT COALESCE(NULLIF(b.display_name, ''), b.name) AS name
           FROM medication_blend_components c
           JOIN medications b ON b.id = c.blend_medication_id
          WHERE c.blend_medication_id = ANY($1::uuid[])`,
        [ids]
      );
      if (nested.rowCount)
        throw fail(
          `${nested.rows.map((r) => r.name).join(', ')} is itself a blend, so it cannot be a component.`,
          400
        );
      const parent = await client.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(b.display_name, ''), b.name) AS name
           FROM medication_blend_components c
           JOIN medications b ON b.id = c.blend_medication_id
          WHERE c.component_medication_id = $1
          LIMIT 1`,
        [blendId]
      );
      if (parent.rowCount)
        throw fail(
          `This medication is a component of ${parent.rows[0]!.name}, so it cannot have components of its own.`,
          400
        );
    }

    await client.query(
      'DELETE FROM medication_blend_components WHERE blend_medication_id = $1 AND user_id = $2',
      [blendId, owner]
    );
    for (const [position, row] of input.components.entries())
      await client.query(
        `INSERT INTO medication_blend_components
           (blend_medication_id, component_medication_id, user_id, mass_mg, source, sort_index)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          blendId,
          row.component_medication_id,
          owner,
          row.mass_mg,
          row.source,
          position,
        ]
      );
    const saved = await client.query<BlendRow>(selectBlends('AND b.id = $2'), [
      owner,
      blendId,
    ]);
    await client.query('COMMIT');
    return saved.rows[0]
      ? view(saved.rows[0])
      : {
          blend_medication_id: blendId,
          name: blend.rows[0]!.name,
          components: [],
        };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The names of the blends a medication is a component of; empty when it is in none. Used to say
 * why it cannot be deleted yet.
 */
export async function blendsContaining(
  owner: string,
  medicationId: string,
  authenticatedUserId?: string
): Promise<string[]> {
  const client: PoolClient = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT DISTINCT COALESCE(NULLIF(b.display_name, ''), b.name) AS name
         FROM medication_blend_components c
         JOIN medications b ON b.id = c.blend_medication_id
        WHERE c.component_medication_id = $1 AND c.user_id = $2
        ORDER BY 1`,
      [medicationId, owner]
    );
    return rows.map((r) => r.name);
  } finally {
    client.release();
  }
}
