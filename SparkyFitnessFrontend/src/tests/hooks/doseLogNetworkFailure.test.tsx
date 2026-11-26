import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query';
import { NetworkApiError } from '@/api/api';
import { toast } from '@/hooks/use-toast';
import { createMutationCache } from '@/lib/mutationCache';
import {
  useCreateMedicationEntryMutation,
  useLogGlpInjectionEntryMutation,
  useLogInjectionMutation,
} from '@/hooks/useMedications';

jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/utils/logging');

const mockToast = jest.mocked(toast);

const wrapper = () => {
  // The app's own mutation cache, so the test sees the toasts the app raises.
  const client = new QueryClient({
    mutationCache: createMutationCache(),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const response = (status: number, body: string) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    redirected: false,
    url: 'http://localhost/api/x',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  }) as unknown as Response;

const titles = () => mockToast.mock.calls.map(([t]) => t.title);

const injection = { medication_id: 'med', dose_mg: 0.5 };
const entry = { medication_id: 'med', status: 'taken' as const };

describe.each([
  [
    'log injection (Log tab card)',
    () => useLogInjectionMutation('med'),
    injection,
  ],
  [
    'log injection (Today / quick log)',
    () => useLogGlpInjectionEntryMutation(),
    injection,
  ],
  [
    'create entry (Take, course dose, add dose, stack)',
    () => useCreateMedicationEntryMutation(),
    entry,
  ],
] as const)('%s', (_name, useHook, body) => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('shows exactly one "Could not save" toast on a network failure and never runs onSuccess', async () => {
    jest
      .mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useHook(), { wrapper: wrapper() });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.current as any).mutate(body, { onSuccess, onError });
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(titles()).toEqual(['Could not save']);
    expect(mockToast.mock.calls[0]?.[0].description).toContain(
      'may have been saved'
    );
    // The form resets its draft only in onSuccess, so the draft stays.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps today's API Error and Error toasts for an HTTP error", async () => {
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(response(500, '{"error":"Server exploded"}'));
    const { result } = renderHook(() => useHook(), { wrapper: wrapper() });
    const onError = jest.fn();
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.current as any).mutate(body, { onError });
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(titles()).toEqual(['API Error', 'Error']);
  });
});

describe('mutation cache and a network failure that did not opt in', () => {
  beforeEach(() => jest.clearAllMocks());

  it('still toasts the generic Error for a NetworkApiError that is not flagged', async () => {
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            throw new NetworkApiError('offline');
          },
        }),
      { wrapper: wrapper() }
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(titles()).toEqual(['Error']);
  });
});
