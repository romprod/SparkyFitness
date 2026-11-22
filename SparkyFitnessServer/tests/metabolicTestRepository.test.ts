import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metabolicTestInputSchema } from '@workspace/shared';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  createMetabolicTest,
  deleteMetabolicTest,
  listMetabolicTests,
  toMetabolicTest,
} from '../models/metabolicTestRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const parse = (patch: Record<string, unknown> = {}) =>
  metabolicTestInputSchema.parse({
    tested_day: '2026-10-05',
    method: 'ic_vo2_only',
    measured_rmr_kcal: 1950,
    sex: 'male',
    age_years: 41,
    height_cm: 180,
    weight_kg: 92,
    ...patch,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('reading tests back', () => {
  const row = {
    id: 'a1',
    tested_day: '2026-10-05',
    method: 'ic_vo2_vco2',
    device_label: null,
    facility: 'Clinic',
    measured_rmr_kcal: '1950.5',
    kcal_per_litre_o2: '4.81',
    vo2_ml_min: null,
    vco2_ml_min: null,
    rq: '0.82',
    duration_min: 15,
    steady_state_cv_pct: '6.5',
    sex: 'female',
    age_years: '41.5',
    height_cm: '165',
    weight_kg: '70.2',
    fat_free_mass_kg: null,
    reported_predicted_kcal: null,
    reported_prediction_equation: null,
    reported_activity_factor: '1.4',
    reported_activity_label: 'Moderate',
    prep_fasted: true,
    prep_fasting_hours: '12',
    prep_no_caffeine: false,
    prep_no_training_prior_day: null,
    prep_active_travel: null,
    prep_rested: true,
    prep_rest_min_before_test: 20,
    prep_illness_free_14d: null,
    prep_awake_quiet: null,
    room_temp_c: '21.5',
    notes: null,
  };

  it('turns the database’s text numbers into numbers and keeps nulls as null', () => {
    const out = toMetabolicTest(row);
    expect(out).toMatchObject({
      measured_rmr_kcal: 1950.5,
      kcal_per_litre_o2: 4.81,
      rq: 0.82,
      age_years: 41.5,
      weight_kg: 70.2,
      reported_activity_factor: 1.4,
      room_temp_c: 21.5,
      vo2_ml_min: null,
      fat_free_mass_kg: null,
      duration_min: 15,
    });
    expect(out.prep).toEqual({
      fasted: true,
      fasting_hours: 12,
      no_caffeine: false,
      no_training_prior_day: null,
      active_travel: null,
      rested: true,
      rest_min_before_test: 20,
      illness_free_14d: null,
      awake_quiet: null,
    });
  });

  it('lists the owner’s tests newest first', async () => {
    mocks.query.mockResolvedValue({ rows: [row] });
    const out = await listMetabolicTests(owner, owner);
    expect(out).toHaveLength(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM metabolic_tests/);
    expect(sql).toMatch(/ORDER BY tested_day DESC, created_at DESC/);
    expect(params).toEqual([owner]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalled();
  });
});

describe('saving a test', () => {
  const insert = async (patch: Record<string, unknown> = {}) => {
    mocks.query.mockResolvedValue({ rows: [{ id: 'new-id' }] });
    const id = await createMetabolicTest(owner, parse(patch), owner);
    expect(id).toBe('new-id');
    return (mocks.query.mock.calls[0] as [string, unknown[]])[1];
  };

  it('stores every value against the owner and releases the connection', async () => {
    const params = await insert({ device_label: 'Analyser', notes: 'n' });
    expect(params[0]).toBe(owner);
    expect(params[1]).toBe('2026-10-05');
    expect(params[2]).toBe('ic_vo2_only');
    expect(params[3]).toBe('Analyser');
    expect(params[5]).toBe(1950);
    expect(params[31]).toBe('n');
    expect(params).toHaveLength(32);
    expect(mocks.release).toHaveBeenCalled();
  });

  it('keeps the hours fasted and minutes rested only when the answer is yes', async () => {
    const yes = await insert({
      prep: {
        fasted: true,
        fasting_hours: 12,
        rested: true,
        rest_min_before_test: 20,
      },
    });
    // Positions: 21 fasted, 22 fasting hours, 26 rested, 27 minutes rested.
    expect([yes[21], yes[22], yes[26], yes[27]]).toEqual([true, 12, true, 20]);
    mocks.query.mockClear();
    const no = await insert({
      prep: {
        fasted: false,
        fasting_hours: 12,
        rested: null,
        rest_min_before_test: 20,
      },
    });
    expect([no[21], no[22], no[26], no[27]]).toEqual([false, null, null, null]);
  });

  it('records unanswered conditions as not recorded', async () => {
    const params = await insert();
    expect([21, 23, 24, 25, 26, 28, 29].map((i) => params[i])).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('releases the connection even when the write fails', async () => {
    mocks.query.mockRejectedValue(new Error('constraint'));
    await expect(createMetabolicTest(owner, parse(), owner)).rejects.toThrow(
      'constraint'
    );
    expect(mocks.release).toHaveBeenCalled();
  });
});

it('deletes only the owner’s test', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await deleteMetabolicTest(owner, 'a1', owner);
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringMatching(
      /DELETE FROM metabolic_tests WHERE user_id = \$1 AND id = \$2/
    ),
    [owner, 'a1']
  );
  expect(mocks.release).toHaveBeenCalled();
});
