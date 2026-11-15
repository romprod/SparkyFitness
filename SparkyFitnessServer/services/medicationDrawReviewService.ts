import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  drawDeliveredMg,
  remainingDrawVolume,
  type CalculatedDrawInput,
  type DrawPreviewInput,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import {
  calculateStoredDraw,
  type StoredDrawContext,
} from '../models/medicationSyringeRepository.js';
import { badPreparation } from './medicationPreparationService.js';

export async function lockDrawMedication(
  client: PoolClient,
  userId: string,
  medicationId: string
) {
  const result = await client.query(
    'SELECT id,type_id,route_id FROM medications WHERE id=$1 AND user_id=$2 FOR SHARE',
    [medicationId, userId]
  );
  return result.rows[0];
}

export async function calculateMedicationDrawReview(
  client: PoolClient,
  userId: string,
  penId: string,
  input: CalculatedDrawInput,
  medicationId?: string,
  editingInjectionId?: string,
  forWrite = false
) {
  if (forWrite && input.review_intent && !input.expected_preview_state)
    throw badPreparation('Review the draw before confirming.');
  const captured: { context?: StoredDrawContext } = {};
  const draw = await calculateStoredDraw(
    client,
    userId,
    penId,
    input,
    medicationId,
    editingInjectionId,
    (context) => {
      captured.context = context;
    }
  ).catch((error: unknown) => {
    if (
      input.expected_preview_state &&
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 400
    ) {
      throw Object.assign(
        new Error('The draw has changed. Review it again before confirming.'),
        { statusCode: 409 }
      );
    }
    throw error;
  });
  const context = captured.context;
  if (!context) throw new Error('Draw context missing');
  const state = createHash('sha256')
    .update(
      JSON.stringify({
        userId,
        penId,
        editingInjectionId: editingInjectionId ?? null,
        dose: input.dose,
        syringeId: input.syringe_id,
        vial: context.vial,
        device: {
          id: context.device.id,
          device_type: context.device.device_type,
          graduation_type: context.device.graduation_type,
          units_per_ml: context.device.units_per_ml,
          capacity_ml: context.device.capacity_ml,
          capacity_units: context.device.capacity_units,
          increment: context.device.increment,
        },
        previous: context.previous,
      })
    )
    .digest('hex');
  if (input.expected_preview_state && input.expected_preview_state !== state)
    throw Object.assign(
      new Error('The draw has changed. Review it again before confirming.'),
      { statusCode: 409 }
    );
  const vial = context.vial;
  const known =
    Number(vial.missing_count) === 0 &&
    Number(vial.doses_used) === Number(vial.linked_count) &&
    vial.volume_ml !== null;
  const remaining = (credit = '0', debit = '0') =>
    remainingDrawVolume(
      context.concentrationMcgPerMl,
      String(vial.final_volume_ml ?? vial.volume_ml),
      String(vial.used_mg),
      credit,
      debit
    );
  return {
    ...draw,
    review: {
      state,
      ...(context.previous
        ? {
            previous: {
              doseMg: String(context.previous.dose_mg),
              volumeMl: String(context.previous.volume_ml),
            },
          }
        : {}),
      remainingBeforeMl: known ? remaining() : null,
      remainingAfterMl: known
        ? remaining(
            String(context.previous?.dose_mg ?? '0'),
            drawDeliveredMg(draw)
          )
        : null,
    },
  };
}

export async function previewMedicationDraw(
  userId: string,
  penId: string,
  input: DrawPreviewInput
) {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const reference = await client.query(
      'SELECT medication_id FROM medication_pens WHERE id=$1 AND user_id=$2',
      [penId, userId]
    );
    const medicationId = reference.rows[0]?.medication_id;
    if (
      !medicationId ||
      !(await lockDrawMedication(client, userId, medicationId))
    )
      throw badPreparation('Vial not found for this medication.');
    const locked = await client.query(
      'SELECT id FROM medication_pens WHERE id=$1 AND user_id=$2 AND medication_id=$3 FOR SHARE',
      [penId, userId, medicationId]
    );
    if (!locked.rows[0])
      throw badPreparation('Vial not found for this medication.');
    const result = await calculateMedicationDrawReview(
      client,
      userId,
      penId,
      input,
      medicationId,
      input.editing_injection_id
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
