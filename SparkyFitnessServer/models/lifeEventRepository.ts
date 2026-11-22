import type { LifeEvent, lifeEventInputSchema } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * Illness, travel and other windows of the owner. A window is context for the report charts and
 * changes nothing else: no dose, plan, stock or schedule is read or written here.
 */
export type NewLifeEvent = ReturnType<typeof lifeEventInputSchema.parse>;

export async function listLifeEvents(
  owner: string,
  authenticatedUserId?: string
): Promise<LifeEvent[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT id, kind, start_day::text AS start_day, end_day::text AS end_day, label, notes
         FROM life_events
        WHERE user_id = $1
        ORDER BY start_day, created_at`,
      [owner]
    );
    return rows as LifeEvent[];
  } finally {
    client.release();
  }
}

export async function createLifeEvent(
  owner: string,
  input: NewLifeEvent,
  authenticatedUserId?: string
): Promise<string> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `INSERT INTO life_events (user_id, kind, start_day, end_day, label, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        owner,
        input.kind,
        input.start_day,
        input.end_day,
        input.label,
        input.notes,
      ]
    );
    return (rows[0] as { id: string }).id;
  } finally {
    client.release();
  }
}

/** Deletes a window of the owner. A window already gone counts as deleted. */
export async function deleteLifeEvent(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<void> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    await client.query(
      'DELETE FROM life_events WHERE user_id = $1 AND id = $2',
      [owner, id]
    );
  } finally {
    client.release();
  }
}
