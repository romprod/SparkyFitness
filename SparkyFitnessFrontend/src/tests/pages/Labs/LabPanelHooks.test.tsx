import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useCreateManualLabPanel,
  useLabPanels,
} from '@/hooks/Labs/useLabResults';
import { labKeys } from '@/api/keys/labs';
import * as api from '@/api/Labs/labResultsApi';
import type { LabPanelHistoryResponse } from '@workspace/shared';
import { wrapper } from './labsTestKit';
jest.mock('@/api/Labs/labResultsApi');
const mocks = jest.mocked(api);
beforeEach(() => jest.clearAllMocks());
it('drops the previous context panel cache on the existing identity-clear lifecycle', async () => {
  const { client, Wrapper } = wrapper();
  client.setQueryDefaults(labKeys.panels(), { staleTime: Infinity });
  const oldData = {
    panels: [
      {
        id: 'old-owner-panel',
        collected_on: null,
        lab_name: null,
        created_at: '2026-01-01',
        results: [],
      },
    ],
  };
  client.setQueryData(labKeys.panels(), oldData);
  let finish: (value: LabPanelHistoryResponse) => void = () => undefined;
  mocks.listLabPanels.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const hook = renderHook(() => useLabPanels(), { wrapper: Wrapper });
  expect(hook.result.current.data).toEqual(oldData);
  act(() => {
    client.clear();
  });
  hook.rerender();
  expect(hook.result.current.data).toBeUndefined();
  finish({ panels: [] });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data).toEqual({ panels: [] });
});
it('invalidates catalog, latest, comparison, panel and marker history after a manual panel save', async () => {
  mocks.createManualLabPanel.mockResolvedValue({} as never);
  const { client, Wrapper } = wrapper();
  const keys = [
    labKeys.markers(),
    labKeys.latest(),
    labKeys.comparison(),
    labKeys.panels(),
    labKeys.history('builtin:hba1c'),
  ];
  for (const key of keys) client.setQueryData(key, []);
  const hook = renderHook(() => useCreateManualLabPanel(), {
    wrapper: Wrapper,
  });
  act(() =>
    hook.result.current.mutate({
      entry_date: '2026-01-01',
      results: [{ marker_key: 'hba1c', value_text: '<3', unit: '%' }],
    })
  );
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
