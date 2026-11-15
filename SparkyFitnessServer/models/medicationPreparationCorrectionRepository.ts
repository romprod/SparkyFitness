import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  preparationCorrectionValues,
  correctedDeliveredMass,
  isRecordedNonnegativeDecimal,
  samePreparationConcentration,
  unchangedPreparationRatio,
  preparationCorrectionBalance as balance,
  type MedicationPreparationCorrectionInput,
  type MedicationPreparationReviewInput,
  type MedicationPreparationReview,
  type MedicationPreparationCorrectionResult,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { resolveBud } from '../services/medicationPreparationService.js';

function problem(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { status: statusCode, statusCode });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
interface Snapshot {
  id: string;
  pen_id: string;
  user_id: string;
  medication_id: string;
  mode: 'reconstituted' | 'premixed';
  mass_value: string;
  mass_unit: 'mg' | 'mcg';
  final_volume_ml: string;
  mass_mg: string;
  concentration_mg_ml: string;
  prepared_date: string;
  diluent: string | null;
  created_at: string;
  revision: number;
  current_correction_id: string | null;
  label_concentration_value: string | null;
  label_concentration_unit: 'mg/ml' | null;
}
interface Bud {
  bud_mode: 'date' | 'interval' | null;
  bud_date: string | null;
  bud_interval_days: number | null;
  bud_base_date: string | null;
  bud_source: string | null;
}
interface Pen extends Bud {
  id: string;
  medication_id: string;
  user_id: string;
  kind: string;
  doses_used: number;
  status: string;
  finished_at: string | null;
  updated_at: string;
  concentration_mg_ml: string | null;
  volume_ml: string | null;
}
interface Dose {
  id: string;
  preparation_id: string | null;
  medication_id: string | null;
  dose_mg: string | null;
  volume_ml: string | null;
  dose_input_unit: string | null;
  updated_at: string;
}
function budOf(pen: Bud): Bud {
  return {
    bud_mode: pen.bud_mode,
    bud_date: pen.bud_date,
    bud_interval_days: pen.bud_interval_days,
    bud_base_date: pen.bud_base_date,
    bud_source: pen.bud_source,
  };
}
async function load(client: PoolClient, userId: string, penId: string) {
  const reference = await client.query<{ medication_id: string }>(
    'SELECT medication_id FROM public.medication_pens WHERE id=$1 AND user_id=$2',
    [penId, userId]
  );
  if (!reference.rows[0]) throw problem('Vial not found.', 404);
  const medication = await client.query(
    'SELECT id FROM public.medications WHERE id=$1 AND user_id=$2 FOR SHARE',
    [reference.rows[0].medication_id, userId]
  );
  if (!medication.rows[0]) throw problem('Medication not found.', 404);
  const rows = await client.query<Pen>(
    `SELECT id,medication_id,user_id,kind,doses_used,status,finished_at::text,updated_at::text,
    concentration_mg_ml::text,volume_ml::text,bud_mode,bud_date::text,bud_interval_days,bud_base_date::text,bud_source
    FROM public.medication_pens WHERE id=$1 AND user_id=$2 FOR UPDATE`,
    [penId, userId]
  );
  const pen = rows.rows[0];
  if (
    !pen ||
    pen.kind !== 'vial' ||
    pen.medication_id !== reference.rows[0].medication_id
  )
    throw problem('Prepared vial not found.', 404);
  const preps = await client.query<{ snapshot: Snapshot }>(
    'SELECT public.medication_preparation_snapshot(p) AS snapshot FROM public.medication_preparations p WHERE pen_id=$1 AND user_id=$2 AND medication_id=$3 FOR UPDATE',
    [penId, userId, pen.medication_id]
  );
  const prep = preps.rows[0]?.snapshot;
  if (!prep) throw problem('No active preparation to correct.', 404);
  const history = await client.query<Dose>(
    `SELECT id,preparation_id,medication_id,dose_mg::text,volume_ml::text,dose_input_unit,updated_at::text
    FROM public.injection_entries WHERE pen_id=$1 AND user_id=$2 ORDER BY id FOR UPDATE`,
    [penId, userId]
  );
  return { pen, prep, doses: history.rows };
}
function build(
  input: MedicationPreparationReviewInput,
  state: Awaited<ReturnType<typeof load>>
) {
  const { pen, prep, doses } = state;
  if (prep.revision !== input.expected_revision)
    throw problem('Preparation changed. Review the current values again.', 409);
  const values = preparationCorrectionValues(input.preparation);
  const unchangedLabel =
    input.preparation.mode === 'premixed' &&
    prep.mode === 'premixed' &&
    prep.label_concentration_value !== null &&
    samePreparationConcentration(
      input.preparation.label_concentration_value,
      prep.label_concentration_value
    ) &&
    samePreparationConcentration(
      input.preparation.final_volume_ml,
      prep.final_volume_ml
    );
  if (unchangedLabel) {
    values.mass_value = prep.mass_value;
    values.mass_unit = prep.mass_unit;
    values.mass_mg = prep.mass_mg;
    values.concentration_mg_ml = prep.concentration_mg_ml;
  }

  if (
    unchangedPreparationRatio(
      values.concentration_mg_ml,
      prep.mass_mg,
      prep.final_volume_ml
    )
  )
    values.concentration_mg_ml = prep.concentration_mg_ml;
  const concentrationChanged = !samePreparationConcentration(
    prep.concentration_mg_ml,
    values.concentration_mg_ml
  );
  const accounted = pen.doses_used === doses.length;
  const completePhysical =
    accounted &&
    doses.every(
      (dose) =>
        dose.preparation_id === prep.id &&
        dose.medication_id === pen.medication_id &&
        isRecordedNonnegativeDecimal(dose.volume_ml)
    );
  const blocked = concentrationChanged && !completePhysical;
  const changes =
    concentrationChanged && !blocked
      ? doses.map((dose) => ({
          ...dose,
          dose_mg: correctedDeliveredMass(
            dose.volume_ml!,
            values.concentration_mg_ml
          ),
        }))
      : doses;
  const before = balance(
    prep.concentration_mg_ml,
    prep.final_volume_ml,
    doses,
    accounted
  );
  const after = balance(
    values.concentration_mg_ml,
    values.final_volume_ml,
    changes,
    accounted
  );
  const existingBud = budOf(pen);
  const afterBud = input.bud
    ? { ...existingBud, ...input.bud, ...resolveBud(input.bud, existingBud) }
    : existingBud;
  const review: MedicationPreparationReview = {
    expected_revision: prep.revision,
    review_hash: hash({ input, pen, prep, doses, afterBud }),
    before: before.view,
    after: blocked
      ? { ...after.view, remaining_mg: null, remaining_ml: null }
      : after.view,
    affected_dose_count: concentrationChanged && !blocked ? doses.length : 0,
    overdrawn_mg: blocked ? null : after.overdrawn,
    overdraw_warning:
      !blocked && after.overdrawn !== null && after.overdrawn !== '0',
    stock_unknown: blocked || after.view.remaining_mg === null,
    can_confirm: !blocked,
    blocking_reason: blocked ? 'INCOMPLETE_PHYSICAL_HISTORY' : null,
  };
  return { review, values, afterBud, changes, concentrationChanged };
}
export async function reviewPreparationCorrection(
  userId: string,
  penId: string,
  input: MedicationPreparationReviewInput
): Promise<MedicationPreparationReview> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const state = await load(client, userId, penId);
    const { review } = build(input, state);
    await client.query('COMMIT');
    return review;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function commitPreparationCorrection(
  userId: string,
  penId: string,
  input: MedicationPreparationCorrectionInput
): Promise<MedicationPreparationCorrectionResult> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `preparation:${userId}:${input.operation_id}`,
    ]);
    const { operation_id, review_hash, ...request } = input;
    const requestHash = hash({ penId, request, review_hash });
    const replay = await client.query<{
      request_hash: string;
      result: MedicationPreparationCorrectionResult;
    }>(
      'SELECT request_hash,result FROM public.medication_preparation_corrections WHERE user_id=$1 AND operation_id=$2',
      [userId, operation_id]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== requestHash)
        throw problem(
          'This operation ID was already used for different changes.',
          409
        );
      await client.query('COMMIT');
      return replay.rows[0].result;
    }
    const state = await load(client, userId, penId);
    const impact = build(request, state);
    if (impact.review.review_hash !== review_hash)
      throw problem(
        'Preparation or dose history changed. Review the changes again.',
        409
      );
    if (!impact.review.can_confirm)
      throw problem(
        'Recorded physical draw history is incomplete. Concentration cannot be corrected without it.'
      );
    const id = randomUUID();
    const revision = state.prep.revision + 1;
    const patch = {
      ...impact.values,
      mode: request.preparation.mode,
      prepared_date: request.preparation.prepared_date,
      diluent:
        request.preparation.diluent === undefined
          ? state.prep.diluent
          : request.preparation.diluent,
      revision,
      current_correction_id: id,
    };
    const projected = await client.query<{ snapshot: Snapshot }>(
      'SELECT public.medication_preparation_snapshot(jsonb_populate_record(p,$3::jsonb)) AS snapshot FROM public.medication_preparations p WHERE id=$1 AND user_id=$2',
      [state.prep.id, userId, JSON.stringify(patch)]
    );
    const result: MedicationPreparationCorrectionResult = {
      correction_id: id,
      revision,
      review: impact.review,
    };
    await client.query(
      `INSERT INTO public.medication_preparation_corrections
      (id,user_id,preparation_id,pen_id,medication_id,from_revision,to_revision,operation_id,request_hash,before_snapshot,after_snapshot,before_bud,after_bud,result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb)`,
      [
        id,
        userId,
        state.prep.id,
        penId,
        state.pen.medication_id,
        state.prep.revision,
        revision,
        operation_id,
        requestHash,
        JSON.stringify(state.prep),
        JSON.stringify(projected.rows[0]!.snapshot),
        JSON.stringify(budOf(state.pen)),
        JSON.stringify(impact.afterBud),
        JSON.stringify(result),
      ]
    );
    if (impact.concentrationChanged) {
      for (let i = 0; i < state.doses.length; i++) {
        const original = state.doses[i]!;
        const corrected = impact.changes[i]!;
        await client.query(
          `INSERT INTO public.medication_preparation_dose_corrections (user_id,correction_id,injection_id,before_dose_mg,after_dose_mg,volume_ml)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            userId,
            id,
            original.id,
            original.dose_mg,
            corrected.dose_mg,
            original.volume_ml,
          ]
        );
        await client.query(
          'UPDATE public.injection_entries SET dose_mg=$3 WHERE id=$1 AND user_id=$2',
          [original.id, userId, corrected.dose_mg]
        );
      }
    }
    await client.query(
      `UPDATE public.medication_preparations SET mode=$3,mass_value=$4,mass_unit=$5,final_volume_ml=$6,mass_mg=$7,
      concentration_mg_ml=$8,prepared_date=$9,diluent=$10,revision=$11,current_correction_id=$12,label_concentration_value=$13,label_concentration_unit=$14
      WHERE id=$1 AND user_id=$2`,
      [
        state.prep.id,
        userId,
        patch.mode,
        patch.mass_value,
        patch.mass_unit,
        patch.final_volume_ml,
        patch.mass_mg,
        patch.concentration_mg_ml,
        patch.prepared_date,
        patch.diluent,
        revision,
        id,
        patch.label_concentration_value,
        patch.label_concentration_unit,
      ]
    );
    await client.query(
      `UPDATE public.medication_pens SET concentration_mg_ml=$3,volume_ml=$4,bud_mode=$5,bud_date=$6,bud_interval_days=$7,bud_base_date=$8,bud_source=$9,
      status=CASE WHEN finished_at IS NOT NULL OR status='discarded' THEN status WHEN $10::numeric IS NULL THEN status WHEN $10::numeric<=0 THEN 'finished' WHEN status='finished' THEN 'in_use' ELSE status END,
      updated_at=NOW() WHERE id=$1 AND user_id=$2`,
      [
        penId,
        userId,
        patch.concentration_mg_ml,
        patch.final_volume_ml,
        impact.afterBud.bud_mode,
        impact.afterBud.bud_date,
        impact.afterBud.bud_interval_days,
        impact.afterBud.bud_base_date,
        impact.afterBud.bud_source,
        impact.review.after.remaining_mg,
      ]
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
