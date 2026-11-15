import { renderHook, waitFor } from '@testing-library/react-native';
import {
  useDeleteLabImports,
  useDeleteLabMarker,
  useSaveLabResult,
  useLabComparison,
} from '../../src/hooks/useLabResults';
import {
  createLabMarker,
  createLabResult,
  deleteLabMarker,
  fetchLabComparison,
  fetchLabMarkers,
} from '../../src/services/api/labResultsApi';
import {
  deleteBuiltinMarkerResults,
  deleteLabImports,
} from '../../src/services/api/labReportApi';
import { ApiError } from '../../src/services/api/errors';
import { createQueryWrapper, createTestQueryClient } from './queryTestUtils';

jest.mock('../../src/services/api/labResultsApi', () => ({
  createLabMarker: jest.fn(),
  createLabResult: jest.fn(),
  deleteLabMarker: jest.fn(),
  deleteLabResult: jest.fn(),
  fetchLabMarkers: jest.fn(),
  fetchLabResults: jest.fn(),
  fetchLatestLabResults: jest.fn(),
  fetchLabComparison: jest.fn(),
}));
jest.mock('../../src/services/api/labReportApi', () => ({
  deleteBuiltinMarkerResults: jest.fn(),
  deleteLabImports: jest.fn(),
}));
jest.mock('../../src/hooks/useProfile', () => ({
  useProfile: () => ({ profile: undefined }),
}));

const base = {
  value: 5.4,
  unit: '%',
  ref_range_low: 4.8,
  ref_range_high: 5.6,
  date: '2026-09-20',
  notes: ' fasting ',
};

const renderSave = () =>
  renderHook(() => useSaveLabResult(), {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });

describe('useSaveLabResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createLabResult).mockResolvedValue({ id: 'r-1' } as never);
  });

  it('saves a built-in marker result with its own unit and range', async () => {
    const { result } = renderSave();

    result.current.mutate({ ...base, target: { markerKey: 'hba1c' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createLabResult).toHaveBeenCalledWith({
      marker_key: 'hba1c',
      entry_date: '2026-09-20',
      value_numeric: 5.4,
      unit: '%',
      ref_range_low: 4.8,
      ref_range_high: 5.6,
      notes: 'fasting',
    });
  });

  it('saves straight to one of the user markers', async () => {
    const { result } = renderSave();

    result.current.mutate({ ...base, notes: '', target: { markerId: 'm-1' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createLabResult).toHaveBeenCalledWith(
      expect.objectContaining({ custom_marker_id: 'm-1', notes: undefined })
    );
  });

  it('names a new marker in the result request, so the server creates both together', async () => {
    jest.mocked(createLabResult).mockResolvedValue({ id: 'r-1' } as never);
    const { result } = renderSave();

    result.current.mutate({ ...base, target: { newMarkerName: 'ApoB' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createLabResult).toHaveBeenCalledTimes(1);
    expect(createLabResult).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_marker_name: 'ApoB',
        unit: '%',
        ref_range_low: 4.8,
        ref_range_high: 5.6,
      })
    );
    expect(jest.mocked(createLabResult).mock.calls[0]?.[0]).not.toHaveProperty(
      'custom_marker_id'
    );
  });
  it('falls back to creating the marker first on an older server', async () => {
    jest
      .mocked(createLabResult)
      .mockRejectedValueOnce(
        new ApiError(
          'Server error: 400',
          400,
          '{"error":"Invalid request body","details":{"marker_key":{"_errors":["Provide exactly one of marker_key or custom_marker_id"]}}}'
        )
      )
      .mockResolvedValueOnce({ id: 'r-1' } as never);
    jest.mocked(createLabMarker).mockResolvedValue({ id: 'm-9' } as never);
    const { result } = renderSave();

    result.current.mutate({ ...base, target: { newMarkerName: 'ApoB' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createLabMarker).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ApoB', unit: '%' })
    );
    expect(jest.mocked(createLabResult).mock.calls[1]?.[0]).toMatchObject({
      custom_marker_id: 'm-9',
    });
  });

  it('does not fall back on an ordinary refusal from a current server', async () => {
    jest
      .mocked(createLabResult)
      .mockRejectedValue(
        new ApiError(
          'Server error: 400',
          400,
          '{"error":"Invalid request body","details":{"ref_range_low":{"_errors":["ref_range_low must not exceed ref_range_high"]}}}'
        )
      );
    const { result } = renderSave();

    result.current.mutate({ ...base, target: { newMarkerName: 'ApoB' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(createLabMarker).not.toHaveBeenCalled();
  });
});

describe('deleting lab data', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes a built-in marker by clearing its results', async () => {
    const { result } = renderHook(() => useDeleteLabMarker(), {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });

    result.current.mutate({ markerKey: 'hba1c' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteBuiltinMarkerResults).toHaveBeenCalledWith('hba1c');
    expect(deleteLabMarker).not.toHaveBeenCalled();
  });

  it('deletes one of the user’s own markers outright', async () => {
    const { result } = renderHook(() => useDeleteLabMarker(), {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });

    result.current.mutate({ markerId: 'm-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteLabMarker).toHaveBeenCalledWith('m-1');
    expect(deleteBuiltinMarkerResults).not.toHaveBeenCalled();
  });

  it('deletes every imported report', async () => {
    jest
      .mocked(deleteLabImports)
      .mockResolvedValue({ reports: 1, results: 3, markers: 0 });
    const client = createTestQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteLabImports(), {
      wrapper: createQueryWrapper(client),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteLabImports).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['labComparison'] });
  });
});

test('loads bounded imported-report panels and combines current custom-marker metadata', async () => {
  jest.mocked(fetchLabComparison).mockResolvedValue({
    panels: [
      {
        id: 'report',
        lab_name: 'Example lab',
        collected_on: '2026-01-30',
        created_at: '2026-01-30T12:00:00Z',
        results: [
          {
            id: 'result',
            marker_key: null,
            custom_marker_id: 'example',
            entry_date: '2026-01-30',
            value_numeric: 4,
            value_text: null,
            unit: 'mg/L',
            ref_range_low: null,
            ref_range_high: null,
          },
        ],
      },
    ],
  });
  jest.mocked(fetchLabMarkers).mockResolvedValue([
    {
      id: 'example',
      user_id: 'example-user',
      name: 'Example analyte',
      unit: 'mg/L',
      ref_range_low: 0,
      ref_range_high: 5,
      created_at: '',
      updated_at: '',
    },
  ]);
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(() => useLabComparison(), {
    wrapper: createQueryWrapper(client),
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.isError).toBe(false);
  expect(result.current.comparison.panels.map((panel) => panel.id)).toEqual([
    'report',
  ]);
  expect(result.current.comparison.rows[0]?.name).toBe('Example analyte');
  expect(result.current.comparison.rows[0]?.cells[0]?.range).toEqual({
    low: 0,
    high: 5,
  });
  unmount();
  client.clear();
});
