import { createHash } from 'node:crypto';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SerumCurveResponse } from '@workspace/shared';
import injectionRepository from '../models/injectionRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import glp1Service from '../services/glp1Service.js';

vi.mock('../models/injectionRepository.js');
vi.mock('../models/medicationRepository.js');

const USER_ID = 'user-1';
const MED_ID = 'med-1';

// `name` has to resolve to a real GLP-1 profile, otherwise the service short-circuits
// to the empty-curve branch before it ever computes an anchor.
const OZEMPIC = {
  id: MED_ID,
  name: 'Ozempic',
  custom_fields: null,
};

function mockInjections(injectedAt: string[]) {
  vi.mocked(injectionRepository.listInjections).mockResolvedValue(
    injectedAt.map((at, i) => ({
      id: `inj-${i}`,
      injected_at: at,
      site: null,
      dose_mg: 1,
    })) as never
  );
}

describe('glp1Service.getSerumCurve — anchorDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      OZEMPIC as never
    );
  });

  it('anchors day 0 at the earliest injection', async () => {
    mockInjections([
      '2026-03-10T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBe('2026-03-03T09:00:00.000Z');
  });

  it('anchors on the earliest injection even when rows arrive out of order', async () => {
    mockInjections([
      '2026-05-20T12:00:00.000Z',
      '2026-05-06T12:00:00.000Z',
      '2026-05-13T12:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBe('2026-05-06T12:00:00.000Z');
  });

  it('places each doseDay at the offset the anchor implies', async () => {
    mockInjections([
      '2026-03-03T09:00:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    // Weekly dosing anchored at the first shot: day 0, 7 and 14. This is what lets a
    // client reconstruct real dates as anchorDate + day, so it has to stay in step.
    expect(result.doseDays).toEqual([0, 7, 14]);
    expect(result.anchorDate).toBe('2026-03-03T09:00:00.000Z');
  });

  it('returns a null anchor when there are no injections to anchor to', async () => {
    mockInjections([]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBeNull();
    expect(result.curve).toEqual([]);
  });

  it('returns a null anchor when the drug is not a recognized GLP-1', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      id: MED_ID,
      name: 'Not A GLP-1',
      custom_fields: null,
    } as never);
    mockInjections(['2026-03-03T09:00:00.000Z']);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBeNull();
  });
});

describe('serum model availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T09:00:00Z'));
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      OZEMPIC as never
    );
    vi.mocked(injectionRepository.listInjections).mockResolvedValue(
      [
        '2026-03-17T09:00:00Z',
        '2026-03-03T09:00:00Z',
        '2026-03-10T09:00:00Z',
      ].map((injected_at, i) => ({
        id: String(i),
        injected_at,
        site: null,
        dose_mg: [2, 1, 0.5][i],
      })) as never
    );
  });
  afterEach(() => vi.useRealTimers());

  it.each([{ history: [] }, { history: ['2026-03-03T09:00:00Z'] }])(
    'distinguishes unresolved parameters before absent history: %j',
    async ({ history }) => {
      vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
        name: 'Synthetic unknown',
        custom_fields: null,
      } as never);
      mockInjections(history);
      expect(await glp1Service.getSerumCurve(USER_ID, MED_ID)).toMatchObject({
        modelAvailability: {
          status: 'unavailable',
          reason: 'unresolved_profile',
        },
        drugId: null,
        curve: [],
        currentLevelFraction: null,
        doseDays: [],
        anchorDate: null,
      });
    }
  );

  it('reports absent logged history with a recognized model', async () => {
    mockInjections([]);
    expect(await glp1Service.getSerumCurve(USER_ID, MED_ID)).toMatchObject({
      modelAvailability: { status: 'no_logged_history', reason: null },
      drugId: 'semaglutide',
      curve: [],
      anchorDate: null,
    });
    expect(injectionRepository.listInjections).toHaveBeenCalledWith(USER_ID, {
      medicationId: MED_ID,
      limit: 60,
    });
    expect(medicationRepository.getMedicationById).toHaveBeenCalledWith(
      USER_ID,
      MED_ID
    );
  });

  it.each([
    {
      name: 'Ozempic',
      custom_fields: { glp1_drug: 'tirzepatide', custom_half_life_days: '-1' },
      expected: 'semaglutide',
    },
    {
      name: 'Synthetic',
      custom_fields: { glp1_drug: 'tirzepatide' },
      expected: 'tirzepatide',
    },
    {
      name: 'Synthetic',
      custom_fields: { glp1_drug: 'custom' },
      expected: 'custom',
    },
  ])(
    'preserves name, configured ID and custom resolution: $expected',
    async ({ name, custom_fields, expected }) => {
      vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
        name,
        custom_fields,
      } as never);
      const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);
      expect(result.drugId).toBe(expected);
      expect(result.modelAvailability).toEqual({
        status: 'available',
        reason: null,
      });
      expect(result.curve.length).toBeGreaterThan(0);
    }
  );

  it.each([undefined, null, '', '0', 'NaN', 'not-a-number'])(
    'retains effective custom defaults for raw %s parameters',
    async (value) => {
      vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
        name: 'Synthetic',
        custom_fields: {
          glp1_drug: 'custom',
          custom_half_life_days: value,
          custom_t_max_days: value,
        },
      } as never);
      const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);
      expect(result.modelAvailability).toEqual({
        status: 'available',
        reason: null,
      });
      expect(result.curve.every((point) => Number.isFinite(point.level))).toBe(
        true
      );
    }
  );

  it.each([
    { half: '-1', peak: '1', invalidParameters: ['halfLifeDays'] },
    { half: 'Infinity', peak: '1', invalidParameters: ['halfLifeDays'] },
    { half: '7', peak: '-0.5', invalidParameters: ['tMaxDays'] },
    { half: '7', peak: 'Infinity', invalidParameters: ['tMaxDays'] },
    {
      half: '-Infinity',
      peak: '-1',
      invalidParameters: ['halfLifeDays', 'tMaxDays'],
    },
  ])(
    'returns an empty estimate for invalid effective parameters $half / $peak',
    async ({ half, peak, invalidParameters }) => {
      vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
        name: 'Synthetic',
        custom_fields: {
          glp1_drug: 'custom',
          custom_half_life_days: half,
          custom_t_max_days: peak,
        },
      } as never);
      const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);
      expect(result).toMatchObject({
        modelAvailability: {
          status: 'unavailable',
          reason: 'invalid_parameters',
          invalidParameters,
        },
        drugId: 'custom',
        curve: [],
        currentLevelFraction: null,
        doseDays: [],
        anchorDate: null,
      });
      expect(JSON.parse(JSON.stringify(result))).toMatchObject({
        modelAvailability: {
          status: 'unavailable',
          reason: 'invalid_parameters',
          invalidParameters,
        },
        drugId: 'custom',
        curve: [],
        currentLevelFraction: null,
        doseDays: [],
        anchorDate: null,
      });
      expect(JSON.stringify(result)).not.toContain('Infinity');
    }
  );

  it('reports invalid effective parameters before absent history', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      name: 'Synthetic',
      custom_fields: { glp1_drug: 'custom', custom_half_life_days: '-1' },
    } as never);
    mockInjections([]);
    expect(
      (await glp1Service.getSerumCurve(USER_ID, MED_ID)).modelAvailability
    ).toEqual({
      status: 'unavailable',
      reason: 'invalid_parameters',
      invalidParameters: ['halfLifeDays'],
    });
  });

  // Captured from the unchanged da4b6e52c service using these synthetic inputs and frozen clock.
  it.each([
    {
      name: 'Ozempic',
      custom_fields: null,
      hash: '2f651f9b66745c938399bc3d928fedf93a60b58793776c743ab5d1ef758ad915',
    },
    {
      name: 'Synthetic',
      custom_fields: {
        glp1_drug: 'custom',
        custom_glp1_name: 'Synthetic model',
        custom_half_life_days: '4.5',
        custom_t_max_days: '0.75',
        custom_cadence: 'daily',
      },
      hash: '5f7688b6951abe5444a09a075bc4bcaa58486a3b9fdd3bd8513827b4254ed690',
    },
    {
      name: 'Synthetic',
      custom_fields: { glp1_drug: 'custom' },
      hash: '6c9b70cf4cb72b2845128f5c1318706f1d09b39001597171a648d2134cf8ada8',
    },
  ])(
    'preserves every legacy serialized value for $name',
    async ({ name, custom_fields, hash }) => {
      vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
        name,
        custom_fields,
      } as never);
      const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);
      const { modelAvailability, ...legacy } = result;
      expect(modelAvailability?.status).toBe('available');
      expect(
        createHash('sha256').update(JSON.stringify(legacy)).digest('hex')
      ).toBe(hash);
      // Older payloads remain assignable to the shared response contract.
      const olderPayload: SerumCurveResponse = legacy;
      expect(olderPayload).not.toHaveProperty('modelAvailability');
    }
  );
});
