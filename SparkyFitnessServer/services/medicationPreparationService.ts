import {
  preparationCreationValues,
  addDays,
  type MedicationPreparationInput,
} from '@workspace/shared';
import type {
  CreatePenBody,
  UpdatePenBody,
} from '../schemas/medicationSchemas.js';

export function preparationValues(input: MedicationPreparationInput) {
  const values = preparationCreationValues(input);
  if (!values)
    throw badPreparation(
      'Preparation amounts must produce a finite positive concentration.'
    );
  return {
    mass_mg: Number(values.mass_mg),
    concentration_mg_ml: Number(values.concentration_mg_ml),
  };
}
export function badPreparation(message: string) {
  return Object.assign(new Error(message), { status: 400, statusCode: 400 });
}

type Bud = Pick<
  CreatePenBody,
  'bud_mode' | 'bud_date' | 'bud_interval_days' | 'bud_base_date' | 'bud_source'
>;
/** Only explicitly changed basis fields recalculate a saved beyond-use date. */
export function resolveBud(
  data: CreatePenBody | UpdatePenBody,
  existing: Bud = {}
): Bud {
  const changed = ['bud_mode', 'bud_interval_days', 'bud_base_date'].some(
    (key) => Object.prototype.hasOwnProperty.call(data, key)
  );
  const merged = { ...existing, ...data };
  if (
    merged.bud_mode === 'date' &&
    !merged.bud_date &&
    (data.bud_mode !== undefined || data.bud_date !== undefined)
  ) {
    throw badPreparation('Date BUD requires an explicit calendar date.');
  }
  const explicitBasis = changed || data.bud_source !== undefined;
  if (
    data.bud_date !== undefined &&
    data.bud_date !== existing.bud_date &&
    ((existing.bud_mode !== null && existing.bud_mode !== undefined) ||
      existing.bud_source?.trim()) &&
    !explicitBasis
  ) {
    throw badPreparation(
      'Select an explicit beyond-use basis to change a configured date.'
    );
  }
  if (
    merged.bud_mode === 'interval' &&
    data.bud_source !== undefined &&
    !data.bud_source?.trim()
  ) {
    throw badPreparation('Interval BUD requires a source or reference.');
  }
  if (changed && merged.bud_mode === 'interval') {
    if (
      merged.bud_base_date === null ||
      merged.bud_base_date === undefined ||
      merged.bud_interval_days === null ||
      merged.bud_interval_days === undefined
    ) {
      throw badPreparation('Interval BUD requires a base date and interval.');
    }
    if (!merged.bud_source?.trim())
      throw badPreparation('Interval BUD requires a source or reference.');
    const calculated = addDays(merged.bud_base_date, merged.bud_interval_days);
    if (
      data.bud_date !== null &&
      data.bud_date !== undefined &&
      data.bud_date !== calculated
    ) {
      throw badPreparation(
        'Beyond-use date does not match its entered interval.'
      );
    }
    return { bud_date: calculated };
  }
  if (
    data.bud_date !== undefined &&
    merged.bud_mode === 'interval' &&
    !changed
  ) {
    if (data.bud_date !== existing.bud_date)
      throw badPreparation(
        'Change the interval basis or select date mode to edit its beyond-use date.'
      );
  }
  return {};
}
