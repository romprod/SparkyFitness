import { useQuery } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import {
  usePreparationReview,
  usePreparationCorrection,
} from '../../src/hooks/usePreparationCorrection';
import { apiFetch } from '../../src/services/api/apiClient';
import { createTestQueryClient, createQueryWrapper } from './queryTestUtils';
import type { MedicationPreparationReviewInput } from '@workspace/shared';

jest.mock('../../src/services/api/apiClient', () => ({ apiFetch: jest.fn() }));
const request: MedicationPreparationReviewInput = {
  expected_revision: 0,
  preparation: {
    mode: 'reconstituted',
    mass_value: '10',
    mass_unit: 'mg',
    final_volume_ml: '2',
    prepared_date: '2026-11-15',
  },
};
const fetch = jest.mocked(apiFetch);
afterEach(() => jest.resetAllMocks());
test('a pending review cannot publish after the existing account cache clear', async () => {
  const client = createTestQueryClient();
  client.setQueryData(['medications', 'pens', 'vial'], []);
  let resolve!: (value: unknown) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result } = renderHook(
    () => {
      useQuery({
        queryKey: ['medications', 'pens', 'vial'],
        queryFn: async () => [],
        enabled: false,
      });
      return usePreparationReview('vial');
    },
    {
      wrapper: createQueryWrapper(client),
    }
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync(request).catch((error) => error);
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => client.clear());
  await act(async () => {
    resolve({ review_hash: 'old-owner' });
    expect(await pending).toBeInstanceOf(Error);
  });
  expect(result.current.data).toBeUndefined();
  expect(result.current.scopeValid).toBe(false);
});
test('a mounted correction cannot start under the replacement account', async () => {
  const client = createTestQueryClient();
  client.setQueryData(['medications', 'pens', 'vial'], []);
  const { result } = renderHook(
    () => {
      useQuery({
        queryKey: ['medications', 'pens', 'vial'],
        queryFn: async () => [],
        enabled: false,
      });
      return usePreparationCorrection('vial');
    },
    {
      wrapper: createQueryWrapper(client),
    }
  );
  act(() => client.clear());
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        ...request,
        review_hash: 'old-review',
        operation_id: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toThrow('active account changed');
  });
  expect(fetch).not.toHaveBeenCalled();
});
