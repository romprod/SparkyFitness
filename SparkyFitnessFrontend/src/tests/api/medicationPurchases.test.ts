import * as purchases from '@/api/Medications/purchaseService';
import { apiCall } from '@/api/api';
import type { MedicationPurchaseUpdateInput } from '@workspace/shared';
jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
it('binds all financial reads to the captured expected owner', () => {
  purchases.listMedicationPurchases('owner');
  purchases.getMedicationPurchase('owner', 'invoice');
  purchases.getMedicationPurchaseEditorData('owner', 'invoice');
  purchases.getMedicationVialCosts('owner');
  expect(apiCall).toHaveBeenNthCalledWith(1, '/v2/medication-purchases', {
    method: 'GET',
    params: { expected_owner_id: 'owner' },
  });
  expect(apiCall).toHaveBeenNthCalledWith(
    2,
    '/v2/medication-purchases/invoice',
    { method: 'GET', params: { expected_owner_id: 'owner' } }
  );
  expect(apiCall).toHaveBeenNthCalledWith(
    3,
    '/v2/medication-purchases/editor-data',
    {
      method: 'GET',
      params: { expected_owner_id: 'owner', purchase_id: 'invoice' },
    }
  );
  expect(apiCall).toHaveBeenNthCalledWith(
    4,
    '/v2/medication-purchases/vial-costs',
    { method: 'GET', params: { expected_owner_id: 'owner' } }
  );
});
it('uses the canonical PATCH update method and a revision-bound DELETE body', () => {
  const body = {
    expected_owner_id: 'owner',
    expected_revision: 2,
  } as MedicationPurchaseUpdateInput;
  purchases.updateMedicationPurchase('invoice', body);
  purchases.deleteMedicationPurchase('invoice', body);
  expect(apiCall).toHaveBeenNthCalledWith(
    1,
    '/v2/medication-purchases/invoice',
    { method: 'PATCH', body, suppressErrorToast: true }
  );
  expect(apiCall).toHaveBeenNthCalledWith(
    2,
    '/v2/medication-purchases/invoice',
    { method: 'DELETE', body, suppressErrorToast: true }
  );
});

it('obtains an abortable proof from the existing nonfinancial identity endpoint', () => {
  const signal = new AbortController().signal;
  purchases.getMedicationPurchaseIdentity(signal);
  expect(apiCall).toHaveBeenCalledWith('/identity/user', {
    method: 'GET',
    signal,
    suppressErrorToast: true,
  });
});

it('sends the owner-bound reporting window and validates its canonical response', async () => {
  const response = {
    window: { key: '3', from_date: '2026-08-15', to_date: '2026-11-15' },
    rows: [],
  };
  jest.mocked(apiCall).mockResolvedValueOnce(response);
  const signal = new AbortController().signal;
  await expect(
    purchases.getMedicationCostAnalytics('owner', '3', signal)
  ).resolves.toEqual(response);
  expect(apiCall).toHaveBeenCalledWith('/v2/medication-purchases/analytics', {
    method: 'GET',
    params: { expected_owner_id: 'owner', window: '3' },
    signal,
    suppressErrorToast: true,
  });
});
