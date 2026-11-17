import { ZodError } from 'zod';
import { medicationInventoryForecastResponseSchema } from '@workspace/shared';
import {
  getMedicationInventoryForecast,
  getMedicationReorderDefaults,
  saveMedicationReorderDefaults,
} from '@/api/Medications/inventoryForecastService';
import { apiCall } from '@/api/api';
import {
  forecastCoverage,
  inventoryForecastFixture,
} from '@/tests/fixtures/medicationInventoryForecast';
import { courseIds } from '@/tests/fixtures/medicationCourses';
jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
beforeEach(() => request.mockReset());
it('requests only the authoritative current forecast, bound to active owner and cancellable', async () => {
  const result = inventoryForecastFixture();
  request.mockResolvedValue(result);
  const controller = new AbortController();
  expect(
    await getMedicationInventoryForecast(courseIds.owner, controller.signal)
  ).toEqual(result);
  expect(request).toHaveBeenCalledWith('/v2/medication-inventory/forecast', {
    params: {
      expected_owner_id: courseIds.owner,
      forecast_mode: 'planned_cycles',
    },
    signal: controller.signal,
    suppressErrorToast: true,
  });
});
it('reads and saves self defaults with explicit PUT, owner assertion and valid zero values', async () => {
  request.mockResolvedValue({ lead_days: 0, buffer_days: 0 });
  expect(await getMedicationReorderDefaults(courseIds.owner)).toEqual({
    lead_days: 0,
    buffer_days: 0,
  });
  expect(
    await saveMedicationReorderDefaults(
      { lead_days: 0, buffer_days: 0 },
      courseIds.owner
    )
  ).toEqual({ lead_days: 0, buffer_days: 0 });
  expect(request.mock.calls[1]).toEqual([
    '/v2/preferences/medication-reorder',
    {
      method: 'PUT',
      body: { lead_days: 0, buffer_days: 0 },
      params: { expected_owner_id: courseIds.owner },
      signal: undefined,
      suppressErrorToast: true,
    },
  ]);
});
it('rejects malformed responses instead of presenting a default or invented coverage', async () => {
  request.mockResolvedValue({ lead_days: '14', buffer_days: 3 });
  await expect(getMedicationReorderDefaults(courseIds.owner)).rejects.toThrow();
  request.mockResolvedValue({
    ...inventoryForecastFixture(),
    medications: [{ status: 'covered' }],
  });
  await expect(
    getMedicationInventoryForecast(courseIds.owner)
  ).rejects.toThrow();
});

it.each(['missing', 'committed'] as const)(
  'rejects an old or wrong-mode forecast echo (%s) without a committed fallback',
  async (mode) => {
    const old = medicationInventoryForecastResponseSchema.parse(
      inventoryForecastFixture()
    );
    request.mockResolvedValue(
      mode === 'missing'
        ? old
        : { ...inventoryForecastFixture(), forecast_mode: 'committed' }
    );
    await expect(
      getMedicationInventoryForecast(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]!.params).toEqual({
      expected_owner_id: courseIds.owner,
      forecast_mode: 'planned_cycles',
    });
  }
);
it.each([
  'whole medication',
  'prepared only',
  'container',
  'cycle assumptions',
])(
  'rejects a planned echo missing required %s projection metadata',
  async (scope) => {
    const result = inventoryForecastFixture();
    const row = result.medications[0]!;
    const { projection: _projection, ...withoutProjection } =
      forecastCoverage();
    let response: unknown = result;
    if (scope === 'whole medication')
      response = {
        ...result,
        medications: [{ ...row, projection: undefined }],
      };
    if (scope === 'prepared only')
      response = {
        ...result,
        medications: [{ ...row, prepared_only: withoutProjection }],
      };
    if (scope === 'container')
      response = {
        ...result,
        medications: [
          {
            ...row,
            containers: [
              {
                container_id: courseIds.legacy,
                coverage: withoutProjection,
                remaining_doses: 3,
                current_dose: null,
              },
            ],
          },
        ],
      };
    if (scope === 'cycle assumptions')
      response = {
        ...result,
        medications: [{ ...row, cycle_assumptions: undefined }],
      };
    request.mockResolvedValue(response);
    await expect(
      getMedicationInventoryForecast(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it('keeps reorder-preference requests and zero defaults independent of forecast mode', async () => {
  const signal = new AbortController().signal;
  request.mockResolvedValue({ lead_days: 0, buffer_days: 0 });
  await getMedicationReorderDefaults(courseIds.owner, signal);
  await saveMedicationReorderDefaults(
    { lead_days: 0, buffer_days: 0 },
    courseIds.owner,
    signal
  );
  for (const [path, options] of request.mock.calls) {
    expect(path).toBe('/v2/preferences/medication-reorder');
    expect(options!.params).toEqual({ expected_owner_id: courseIds.owner });
    expect(options!.signal).toBe(signal);
  }
});
it('propagates planned endpoint errors without retrying a committed request', async () => {
  const error = Object.assign(new Error('Mode unavailable'), { status: 400 });
  request.mockRejectedValue(error);
  await expect(getMedicationInventoryForecast(courseIds.owner)).rejects.toBe(
    error
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  { claim: 'projected_restart', kind: 'projected_restart' },
  { claim: 'projected_coverage', kind: 'committed' },
] as const)(
  'preserves $claim provenance and named manual-cycle assumptions without recategorising the first failed demand',
  async ({ claim, kind }) => {
    const result = inventoryForecastFixture();
    Object.assign(
      result.medications[0]!,
      forecastCoverage({
        status: 'ok',
        basis: 'depleted',
        coverage_through: '2026-11-30',
        depletion_date: '2026-11-30',
        reorder_by: '2026-12-02',
        days_left: 14,
        projection: {
          provisional_slots: 3,
          projection_starts_on: '2026-11-22',
          first_unserved_day: '2026-12-16',
          first_unserved_kind: kind,
          claim_basis: claim,
        },
      })
    );
    result.medications[0]!.cycle_assumptions = [
      {
        course_id: courseIds.course,
        revision_id: courseIds.revision,
        plan_name: 'Example authored plan',
        timezone: 'Europe/London',
        anchor_date: '2026-11-01',
        committed_end_date: '2026-11-14',
        on_weeks: 2,
        off_weeks: 1,
        next_restart_date: '2026-11-22',
        projection_starts_on: '2026-11-22',
        overdue: false,
        manual_restart_required: true,
      },
    ];
    request.mockResolvedValue(result);
    await expect(
      getMedicationInventoryForecast(courseIds.owner)
    ).resolves.toEqual(result);
  }
);

it('retains authoritative cross-zone untimed projection uncertainty without precise need, coverage or reorder dates', async () => {
  const result = inventoryForecastFixture();
  result.timezone = 'America/Los_Angeles';
  const unknown = forecastCoverage({
    status: 'unknown',
    basis: 'unknown',
    coverage_through: null,
    depletion_date: null,
    reorder_by: null,
    days_left: null,
    served_slots: 0,
    expected_slots: 1,
    limitations: ['unknown_projection_date'],
    projection: {
      provisional_slots: 1,
      projection_starts_on: null,
      first_unserved_day: null,
      first_unserved_kind: null,
      claim_basis: 'unknown',
    },
  });
  Object.assign(result.medications[0]!, unknown);
  result.medications[0]!.prepared_only = unknown;
  result.medications[0]!.containers = [
    {
      container_id: courseIds.legacy,
      coverage: unknown,
      remaining_doses: null,
      current_dose: null,
    },
  ];
  result.medications[0]!.cycle_assumptions = [
    {
      course_id: courseIds.course,
      revision_id: courseIds.revision,
      plan_name: 'Example untimed plan',
      timezone: 'Pacific/Auckland',
      anchor_date: '2026-11-01',
      committed_end_date: '2026-11-14',
      on_weeks: 2,
      off_weeks: 1,
      next_restart_date: '2026-11-22',
      projection_starts_on: null,
      overdue: false,
      manual_restart_required: true,
    },
  ];
  request.mockResolvedValue(result);
  const response = await getMedicationInventoryForecast(courseIds.owner);
  expect(response).toEqual(result);
  for (const coverage of [
    response.medications[0]!,
    response.medications[0]!.prepared_only,
    response.medications[0]!.containers[0]!.coverage,
  ]) {
    expect(coverage).toMatchObject({
      status: 'unknown',
      coverage_through: null,
      depletion_date: null,
      reorder_by: null,
      days_left: null,
      limitations: ['unknown_projection_date'],
      projection: {
        provisional_slots: 1,
        projection_starts_on: null,
        first_unserved_day: null,
        first_unserved_kind: null,
        claim_basis: 'unknown',
      },
    });
  }
  expect(response.medications[0]!.cycle_assumptions[0]).toMatchObject({
    plan_name: 'Example untimed plan',
    timezone: 'Pacific/Auckland',
    next_restart_date: '2026-11-22',
    projection_starts_on: null,
    manual_restart_required: true,
  });
});
