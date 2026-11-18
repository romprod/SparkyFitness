import type { PoolClient } from 'pg';
import { packDeduction } from '@workspace/shared';
import { userToday } from './medicationPackRepository.js';

/** Statuses that mean the dose was actually taken, and so use up stock. */
export const TAKEN_STATUSES = ['taken', 'prn_taken'] as const;

export interface PackEntryFacts {
  id: string;
  medication_id: string | null;
  status: string;
  dose_amount_snapshot: string | number | null;
  dose_unit_snapshot: string | null;
  pack_id?: string | null;
  pack_units_deducted?: string | number | null;
}
export type PackDeductionOutcome =
  | { deducted: true; pack_id: string; units: string }
  | {
      deducted: false;
      reason:
        | 'no_medication'
        | 'not_taken'
        | 'opted_out'
        | 'no_dose'
        | 'unit_mismatch'
        | 'no_pack';
    };

interface Candidate {
  id: string;
  unit_label: string;
}

/**
 * Takes a taken dose out of the right pack, inside the caller's transaction.
 * An explicit pack wins; otherwise the in-use pack that expires first, then the
 * oldest sealed one (which becomes in use). Doses in another unit take nothing.
 */
export async function deductForEntry(
  client: PoolClient,
  userId: string,
  entry: PackEntryFacts,
  explicitPackId?: string | null
): Promise<PackDeductionOutcome> {
  if (!entry.medication_id) return { deducted: false, reason: 'no_medication' };
  if (!(TAKEN_STATUSES as readonly string[]).includes(entry.status))
    return { deducted: false, reason: 'not_taken' };
  const found = await client.query<Candidate>(
    `SELECT id, unit_label FROM medication_packs
      WHERE user_id = $1 AND medication_id = $2 AND status IN ('sealed', 'in_use')
        AND ($3::uuid IS NULL OR id = $3::uuid)
      ORDER BY (status = 'in_use') DESC, expiry_date NULLS LAST, created_at, id
      FOR UPDATE`,
    [userId, entry.medication_id, explicitPackId ?? null]
  );
  if (explicitPackId && found.rows.length === 0)
    throw Object.assign(
      new Error('That pack is not available for this medication.'),
      { statusCode: 422 }
    );
  if (found.rows.length === 0) return { deducted: false, reason: 'no_pack' };
  let miss: 'no_dose' | 'unit_mismatch' = 'unit_mismatch';
  for (const pack of found.rows) {
    const result = packDeduction({
      doseAmount: entry.dose_amount_snapshot,
      doseUnit: entry.dose_unit_snapshot,
      packUnitLabel: pack.unit_label,
    });
    if (!result.deducted) {
      miss = result.reason;
      continue;
    }
    const today = await userToday(client, userId);
    await client.query(
      `UPDATE medication_packs SET
         units_used = units_used + $3,
         status = CASE WHEN units_used + $3 >= units_total THEN 'finished'
                       WHEN status = 'sealed' THEN 'in_use' ELSE status END,
         opened_at = CASE WHEN status = 'sealed' THEN COALESCE(opened_at, $4::date) ELSE opened_at END,
         finished_at = CASE WHEN units_used + $3 >= units_total THEN NOW() ELSE finished_at END,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [pack.id, userId, result.units, today]
    );
    await client.query(
      'UPDATE medication_entries SET pack_id = $3, pack_units_deducted = $4 WHERE id = $1 AND user_id = $2',
      [entry.id, userId, pack.id, result.units]
    );
    return { deducted: true, pack_id: pack.id, units: result.units };
  }
  return { deducted: false, reason: miss };
}

/** Gives back exactly what an entry took, reopening a pack its dose had just emptied. */
export async function restoreForEntry(
  client: PoolClient,
  userId: string,
  entry: Pick<PackEntryFacts, 'id' | 'pack_id' | 'pack_units_deducted'>,
  clearEntry: boolean
): Promise<void> {
  if (
    !entry.pack_id ||
    entry.pack_units_deducted === null ||
    entry.pack_units_deducted === undefined
  )
    return;
  await client.query(
    `UPDATE medication_packs SET
       status = CASE WHEN status = 'finished' AND units_used >= units_total
                      AND units_used - $3 < units_total THEN 'in_use' ELSE status END,
       finished_at = CASE WHEN status = 'finished' AND units_used >= units_total
                      AND units_used - $3 < units_total THEN NULL ELSE finished_at END,
       units_used = GREATEST(units_used - $3, 0),
       updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [entry.pack_id, userId, entry.pack_units_deducted]
  );
  if (clearEntry)
    await client.query(
      'UPDATE medication_entries SET pack_id = NULL, pack_units_deducted = NULL WHERE id = $1 AND user_id = $2',
      [entry.id, userId]
    );
}
