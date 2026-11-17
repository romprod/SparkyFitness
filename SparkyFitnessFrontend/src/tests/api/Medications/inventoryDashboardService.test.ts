import { ZodError } from 'zod';
import { medicationInventoryDashboardResponseSchema } from '@workspace/shared';
import { apiCall } from '@/api/api';
import { getMedicationStockDashboard } from '@/api/Medications/inventoryDashboardService';
import {
  dashboardFixture,
  queueItem,
} from '@/tests/fixtures/medicationInventoryDashboard';
import { courseIds } from '@/tests/fixtures/medicationCourses';
import { forecastCoverage } from '@/tests/fixtures/medicationInventoryForecast';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
const request = jest.mocked(apiCall);
beforeEach(() => request.mockReset());
it('reads one owner-bound current dashboard with canonical GET and caller cancellation', async () => {
  const response = dashboardFixture();
  const signal = new AbortController().signal;
  request.mockResolvedValue(response);
  await expect(
    getMedicationStockDashboard(courseIds.owner, signal)
  ).resolves.toEqual(response);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/v2/medication-inventory/dashboard', {
    method: 'GET',
    params: {
      expected_owner_id: courseIds.owner,
      forecast_mode: 'planned_cycles',
    },
    signal,
    suppressErrorToast: true,
  });
});
it('retains exact queue display strings and opaque state proof without reconstructing stock', async () => {
  const response = dashboardFixture({
    preparation_queue: [queueItem({ label_mass_mg: '10.000000000000000001' })],
  });
  request.mockResolvedValue(response);
  const result = await getMedicationStockDashboard(courseIds.owner);
  expect(result.preparation_queue[0]).toMatchObject({
    label_mass_mg: '10.000000000000000001',
    preparation_queue_state: 'a'.repeat(64),
  });
});
it('accepts explicit no-demand with null selection, distinct from a selected unknown forecast', async () => {
  const empty = dashboardFixture({
    supply: { state: 'no_demand', medication_id: null },
  });
  empty.forecast.medications = [];
  request.mockResolvedValueOnce(empty);
  await expect(getMedicationStockDashboard(courseIds.owner)).resolves.toEqual(
    empty
  );
  const unknown = dashboardFixture({
    supply: { state: 'unavailable', medication_id: courseIds.med },
  });
  Object.assign(
    unknown.forecast.medications[0]!,
    forecastCoverage({
      status: 'unknown',
      basis: 'unknown',
      coverage_through: null,
      depletion_date: null,
      reorder_by: null,
      days_left: null,
    })
  );
  request.mockResolvedValueOnce(unknown);
  await expect(getMedicationStockDashboard(courseIds.owner)).resolves.toEqual(
    unknown
  );
});
it.each([
  {
    name: 'no-demand with a selected medication',
    response: () => ({
      ...dashboardFixture(),
      supply: { state: 'no_demand', medication_id: courseIds.med },
    }),
  },
  {
    name: 'selected ID absent from the same forecast snapshot',
    response: () =>
      dashboardFixture({
        supply: { state: 'forecast', medication_id: courseIds.revision2 },
      }),
  },
  {
    name: 'unavailable state pointing to known coverage',
    response: () =>
      dashboardFixture({
        supply: { state: 'unavailable', medication_id: courseIds.med },
      }),
  },
  {
    name: 'duplicate stable queue IDs',
    response: () =>
      dashboardFixture({ preparation_queue: [queueItem(), queueItem()] }),
  },
  {
    name: 'invalid preparation state proof',
    response: () =>
      dashboardFixture({
        preparation_queue: [
          queueItem({ preparation_queue_state: 'not-a-proof' }),
        ],
      }),
  },
  {
    name: 'expired annotation without recorded expiry',
    response: () =>
      dashboardFixture({
        preparation_queue: [queueItem({ expired: true, expiry_date: null })],
      }),
  },
  {
    name: 'missing queue projection',
    response: () => ({
      forecast: dashboardFixture().forecast,
      supply: dashboardFixture().supply,
    }),
  },
  { name: 'empty response', response: () => undefined },
])(
  'rejects malformed $name through the real shared response contract',
  async ({ response }) => {
    request.mockResolvedValue(response());
    await expect(
      getMedicationStockDashboard(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
  }
);
it('propagates ownership rejection without retry or an empty-dashboard fallback', async () => {
  const error = Object.assign(new Error('Owner changed'), { status: 409 });
  request.mockRejectedValue(error);
  await expect(getMedicationStockDashboard(courseIds.owner)).rejects.toBe(
    error
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'committed'] as const)(
  'rejects a dashboard with %s planned-mode echo instead of using old committed coverage',
  async (mode) => {
    const old =
      medicationInventoryDashboardResponseSchema.parse(dashboardFixture());
    request.mockResolvedValue(
      mode === 'missing'
        ? old
        : {
            ...dashboardFixture(),
            forecast: {
              ...dashboardFixture().forecast,
              forecast_mode: 'committed',
            },
          }
    );
    await expect(
      getMedicationStockDashboard(courseIds.owner)
    ).rejects.toBeInstanceOf(ZodError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]!.params).toEqual({
      expected_owner_id: courseIds.owner,
      forecast_mode: 'planned_cycles',
    });
  }
);
it('rejects a planned-mode dashboard missing required coverage provenance despite a valid unchanged queue', async () => {
  const result = dashboardFixture();
  request.mockResolvedValue({
    ...result,
    forecast: {
      ...result.forecast,
      medications: [
        { ...result.forecast.medications[0], projection: undefined },
      ],
    },
  });
  await expect(
    getMedicationStockDashboard(courseIds.owner)
  ).rejects.toBeInstanceOf(ZodError);
});
