import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { DrawResult, CalculatedDrawInput } from '@workspace/shared';
import { useSyringeDrawPreview } from '../../src/hooks/useSyringes';
import { previewSyringeDraw } from '../../src/services/api/syringesApi';
import { createQueryWrapper, createTestQueryClient } from './queryTestUtils';
jest.mock('../../src/services/api/syringesApi', () => ({
  previewSyringeDraw: jest.fn(),
}));
jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));
const input = (value: string): CalculatedDrawInput => ({
  syringe_id: '11111111-1111-4111-8111-111111111111',
  dose: { unit: 'mg', value },
});
const result = (value: string): DrawResult => ({
  targetMassMcg: value,
  targetVolumeMl: value,
  rawUnits: value,
  markingValue: value,
  markingScale: 'units',
  deliveredMassMcg: value,
  deliveredVolumeMl: value,
  roundingErrorMcg: '0',
  warnings: [],
});
test('late preview responses cannot replace the current vial/device/dose result', async () => {
  const client = createTestQueryClient();
  let resolveOld!: (value: DrawResult) => void;
  jest
    .mocked(previewSyringeDraw)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValueOnce(result('new'));
  const {
    result: query,
    rerender,
    unmount,
  } = renderHook(({ pen, dose }) => useSyringeDrawPreview(pen, dose), {
    initialProps: { pen: 'old-vial', dose: input('1') },
    wrapper: createQueryWrapper(client),
  });
  await waitFor(() => expect(previewSyringeDraw).toHaveBeenCalledTimes(1));
  rerender({ pen: 'new-vial', dose: input('2') });
  await waitFor(() => expect(query.current.data?.markingValue).toBe('new'));
  await act(async () => {
    resolveOld(result('old'));
  });
  expect(query.current.data?.markingValue).toBe('new');
  unmount();
  client.clear();
});
