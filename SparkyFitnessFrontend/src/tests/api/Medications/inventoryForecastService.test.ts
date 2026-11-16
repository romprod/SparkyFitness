import {
  getMedicationInventoryForecast,
  getMedicationReorderDefaults,
  saveMedicationReorderDefaults,
} from '@/api/Medications/inventoryForecastService';
import { apiCall } from '@/api/api';
import { inventoryForecastFixture } from '@/tests/fixtures/medicationInventoryForecast';
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
    params: { expected_owner_id: courseIds.owner },
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
