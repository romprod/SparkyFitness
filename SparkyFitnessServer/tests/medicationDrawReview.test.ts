import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { computeDraw } from '@workspace/shared';
import {
  calculateStoredDraw,
  type StoredDrawContext,
} from '../models/medicationSyringeRepository.js';
import { calculateMedicationDrawReview } from '../services/medicationDrawReviewService.js';
vi.mock('../models/medicationSyringeRepository.js', () => ({
  calculateStoredDraw: vi.fn(),
}));
const device = {
  id: 'device',
  user_id: 'owner',
  name: 'Synthetic',
  device_type: 'syringe' as const,
  graduation_type: 'units' as const,
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
  is_shared: false,
  is_default: false,
  created_at: '',
  updated_at: '',
};
let context: StoredDrawContext;
const client = {} as PoolClient;
const input = {
  syringe_id: 'device',
  dose: { value: '0.3', unit: 'mg' as const },
};
beforeEach(() => {
  context = {
    device,
    vial: {
      volume_ml: '1',
      final_volume_ml: '1',
      doses_used: 1,
      linked_count: '1',
      missing_count: '0',
      used_mg: '0.2',
      preparation_state: 'revision1',
    },
    previous: { dose_mg: '0.2', volume_ml: '0.2', updated_at: 'original' },
    concentrationMcgPerMl: '1000',
  };
  vi.mocked(calculateStoredDraw).mockImplementation(
    async (_c, _u, _p, i, _m, _e, callback) => {
      callback?.(context);
      return {
        ...computeDraw({
          dose: i.dose as typeof input.dose,
          concentrationMcgPerMl: '1000',
          syringe: device,
        }),
        syringeCapacityMl: '1',
        administrationRoute: 'injection' as const,
        doseInputUnit: 'mg' as const,
        device,
      };
    }
  );
});
describe('review state and physical stock impact', () => {
  it('credits original dose exactly once in replacement and retains uncredited before balance', async () => {
    const result = await calculateMedicationDrawReview(
      client,
      'owner',
      'vial',
      input,
      'med',
      'entry'
    );
    expect(result.review).toMatchObject({
      previous: { doseMg: '0.2', volumeMl: '0.2' },
      remainingBeforeMl: '0.8',
      remainingAfterMl: '0.7',
    });
  });
  it('does not fabricate balances for unknown legacy stock', async () => {
    context.vial.missing_count = '1';
    const result = await calculateMedicationDrawReview(
      client,
      'owner',
      'vial',
      input
    );
    expect(result.review.remainingBeforeMl).toBeNull();
    expect(result.review.remainingAfterMl).toBeNull();
  });
  it('requires review only for new explicit intent, preserving old writes', async () => {
    await expect(
      calculateMedicationDrawReview(
        client,
        'owner',
        'vial',
        { ...input, review_intent: true },
        'med',
        undefined,
        true
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      calculateMedicationDrawReview(
        client,
        'owner',
        'vial',
        input,
        'med',
        undefined,
        true
      )
    ).resolves.toBeDefined();
  });
  it.each([
    'target',
    'calibration',
    'preparation',
    'quantity',
    'old-entry',
  ] as const)('rejects stale %s state', async (change) => {
    const initial = await calculateMedicationDrawReview(
      client,
      'owner',
      'vial',
      input,
      'med',
      'entry'
    );
    let changed = input;
    if (change === 'target')
      changed = { ...input, dose: { ...input.dose, value: '0.4' } };
    if (change === 'calibration')
      context.device = { ...device, increment: '2' };
    if (change === 'preparation') context.vial.preparation_state = 'revision2';
    if (change === 'quantity') context.vial.used_mg = '0.25';
    if (change === 'old-entry')
      context.previous = { ...context.previous, updated_at: 'changed' };
    await expect(
      calculateMedicationDrawReview(
        client,
        'owner',
        'vial',
        { ...changed, expected_preview_state: initial.review.state },
        'med',
        'entry',
        true
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('returns stale-review conflict if changed source state no longer permits calculation', async () => {
    vi.mocked(calculateStoredDraw).mockRejectedValueOnce(
      Object.assign(new Error('Device route changed'), { statusCode: 400 })
    );
    await expect(
      calculateMedicationDrawReview(
        client,
        'owner',
        'vial',
        { ...input, expected_preview_state: 'old-state' },
        undefined,
        undefined,
        true
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('accepts unchanged reviewed input and preserves zero calculation semantics', async () => {
    const zero = { ...input, dose: { ...input.dose, value: '0' } };
    const preview = await calculateMedicationDrawReview(
      client,
      'owner',
      'vial',
      zero
    );
    const saved = await calculateMedicationDrawReview(
      client,
      'owner',
      'vial',
      {
        ...zero,
        review_intent: true,
        expected_preview_state: preview.review.state,
      },
      undefined,
      undefined,
      true
    );
    expect(saved.deliveredMassMcg).toBe('0');
  });
});
