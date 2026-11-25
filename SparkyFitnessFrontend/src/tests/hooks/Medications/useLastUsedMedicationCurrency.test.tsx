import { renderHook } from '@testing-library/react';
import { useLastUsedMedicationCurrency } from '@/hooks/Medications/useLastUsedMedicationCurrency';

const mockRx = jest.fn();
const mockPurchases = jest.fn();
jest.mock('@/hooks/Medications/useMedicationPrescriptions', () => ({
  useMedicationPrescriptions: (enabled: boolean) => mockRx(enabled),
}));
jest.mock('@/hooks/useMedicationPurchases', () => ({
  useMedicationPurchases: (owner: string, enabled: boolean) =>
    mockPurchases(owner, enabled),
}));

const rx = (rows: { currency: string; created_at: string }[] | undefined) => ({
  scope: { ownerId: 'owner', ready: true },
  data: rows && { prescriptions: rows },
});

it('uses the newest record across prescriptions and invoices', () => {
  mockRx.mockReturnValue(
    rx([{ currency: 'AUD', created_at: '2026-01-01T00:00:00Z' }])
  );
  mockPurchases.mockReturnValue({
    data: {
      purchases: [{ currency: 'GBP', created_at: '2026-11-01T00:00:00Z' }],
    },
  });
  const { result } = renderHook(() => useLastUsedMedicationCurrency(true));
  expect(result.current).toBe('GBP');
  expect(mockPurchases).toHaveBeenCalledWith('owner', true);
});
it('is undefined with no history and does not enable the lists when idle', () => {
  mockRx.mockReturnValue(rx([]));
  mockPurchases.mockReturnValue({ data: { purchases: [] } });
  const { result } = renderHook(() => useLastUsedMedicationCurrency(false));
  expect(result.current).toBeUndefined();
  expect(mockRx).toHaveBeenCalledWith(false);
  expect(mockPurchases).toHaveBeenLastCalledWith('owner', false);
});
