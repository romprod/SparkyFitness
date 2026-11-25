import { getClient } from '../db/poolManager.js';

const TABLE_NAME = 'medication_smooth_week_pins';

/** Medication ids the user has pinned "keep as is" for Smooth your week. */
export async function listSmoothWeekPins(userId: string): Promise<string[]> {
  const client = await getClient(userId);
  try {
    const { rows } = await client.query(
      `SELECT medication_id FROM ${TABLE_NAME} WHERE user_id = $1 ORDER BY created_at, medication_id`,
      [userId]
    );
    return rows.map((row: { medication_id: string }) => row.medication_id);
  } finally {
    client.release();
  }
}

/**
 * Pins a medication. Idempotent. Returns false when the medication is not the
 * user's, so the route can answer 404 without revealing whether it exists.
 */
export async function pinSmoothWeekMedication(
  userId: string,
  medicationId: string
): Promise<boolean> {
  const client = await getClient(userId);
  try {
    const owned = await client.query(
      'SELECT 1 FROM medications WHERE id = $1 AND user_id = $2',
      [medicationId, userId]
    );
    if (owned.rowCount === 0) return false;
    await client.query(
      `INSERT INTO ${TABLE_NAME} (user_id, medication_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, medicationId]
    );
    return true;
  } finally {
    client.release();
  }
}

/** Removes a pin. Idempotent: a pin that does not exist is not an error. */
export async function unpinSmoothWeekMedication(
  userId: string,
  medicationId: string
): Promise<void> {
  const client = await getClient(userId);
  try {
    await client.query(
      `DELETE FROM ${TABLE_NAME} WHERE user_id = $1 AND medication_id = $2`,
      [userId, medicationId]
    );
  } finally {
    client.release();
  }
}
