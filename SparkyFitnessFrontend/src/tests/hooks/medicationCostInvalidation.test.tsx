import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdatePenMutation,
  useUpdateInjectionMutation,
} from '@/hooks/useMedications';
import { medicationPurchaseKeys } from '@/hooks/useMedicationPurchases';
jest.mock('@/api/Medications/medicationService', () => ({
  updatePen: jest.fn(async () => ({})),
  updateInjection: jest.fn(async () => ({})),
}));
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const keys = {
    identity: medicationPurchaseKeys.identity('owner', 1),
    report3: medicationPurchaseKeys.analytics('owner', '3'),
    report12: medicationPurchaseKeys.analytics('owner', '12'),
    estimatedReport: medicationPurchaseKeys.analyticsWithPrescriptionEstimates(
      'owner',
      '12',
      1
    ),
    estimatedVials: medicationPurchaseKeys.vialsWithPrescriptionEstimates(
      'owner',
      1
    ),
    editor: medicationPurchaseKeys.editor('owner'),
    vials: medicationPurchaseKeys.vials('owner'),
    list: medicationPurchaseKeys.list('owner'),
  };
  Object.values(keys).forEach((key) => client.setQueryData(key, {}));
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, keys, wrapper };
}
it('refreshes label/report/matching data after a stock edit without invalidating identity proof', async () => {
  const { client, keys, wrapper } = setup();
  const { result } = renderHook(() => useUpdatePenMutation('med'), { wrapper });
  act(() =>
    result.current.mutate({ id: 'vial', body: { label_mass_mg: '20' } })
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(client.getQueryState(keys.report3)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.report12)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.editor)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.vials)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.estimatedReport)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.estimatedVials)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.identity)?.isInvalidated).toBe(false);
});
it('refreshes report windows and matching metadata after a recorded-dose correction', async () => {
  const { client, keys, wrapper } = setup();
  const { result } = renderHook(() => useUpdateInjectionMutation('med'), {
    wrapper,
  });
  act(() => result.current.mutate({ id: 'dose', body: { dose_mg: 0.5 } }));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(client.getQueryState(keys.report3)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.report12)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.editor)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.list)?.isInvalidated).toBe(false);
  expect(client.getQueryState(keys.estimatedReport)?.isInvalidated).toBe(true);
  expect(client.getQueryState(keys.estimatedVials)?.isInvalidated).toBe(false);
  expect(client.getQueryState(keys.identity)?.isInvalidated).toBe(false);
});
