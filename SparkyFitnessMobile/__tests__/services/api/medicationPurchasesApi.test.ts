import {
  getMedicationCostIdentity,
  getMedicationCostAnalytics,
  listMedicationPurchases,
  getMedicationPurchaseEditorData,
  createMedicationPurchase,
  updateMedicationPurchase,
  deleteMedicationPurchase,
} from '../../../src/services/api/medicationPurchasesApi';
import { apiFetch } from '../../../src/services/api/apiClient';
import { getActiveServerConfig } from '../../../src/services/storage';
const context = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  configId: 'server-a',
  serverUrl: 'https://example.test',
};
const config = {
  id: 'server-a',
  url: 'https://example.test',
  apiKey: 'synthetic-key',
  authType: 'apiKey' as const,
};
jest.mock('../../../src/services/api/apiClient', () => ({
  apiFetch: jest.fn(),
}));
jest.mock('../../../src/services/storage', () => ({
  getActiveServerConfig: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getActiveServerConfig).mockResolvedValue(config);
});
test('identity proof caches only public account/server identifiers and pins its original server', async () => {
  jest.mocked(apiFetch).mockResolvedValue({
    authenticatedUserId: context.ownerId,
    activeUserId: context.ownerId,
    authenticatedUserEmail: 'synthetic@example.test',
  });
  const identity = await getMedicationCostIdentity();
  expect(identity).toEqual({
    authenticatedUserId: context.ownerId,
    activeUserId: context.ownerId,
    configId: config.id,
    serverUrl: config.url,
  });
  expect(identity).not.toHaveProperty('apiKey');
  expect(identity).not.toHaveProperty('authenticatedUserEmail');
  expect(apiFetch).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint: '/api/identity/user',
      serverConfig: config,
      logResponseBody: false,
    })
  );
});
test('all financial reads bind expected owner and retain abort support without logging response bodies', async () => {
  const controller = new AbortController();
  await listMedicationPurchases(context, controller.signal);
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      endpoint: `/api/v2/medication-purchases?expected_owner_id=${context.ownerId}`,
      signal: controller.signal,
      serverConfig: config,
      logResponseBody: false,
    })
  );
  await getMedicationPurchaseEditorData(context, 'invoice', controller.signal);
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      endpoint: expect.stringContaining('purchase_id=invoice'),
      serverConfig: config,
    })
  );
});
test('server switch blocks a stale invoice even when cloned instances share the same owner UUID', async () => {
  jest.mocked(getActiveServerConfig).mockResolvedValue({
    ...config,
    id: 'server-b',
    url: 'https://other.example.test',
  });
  await expect(listMedicationPurchases(context)).rejects.toThrow(
    'account changed'
  );
  expect(apiFetch).not.toHaveBeenCalled();
});
test('create preserves raw exact price and stable operation; update is PATCH and delete uses the owner/revision body', async () => {
  const body = {
    expected_owner_id: context.ownerId,
    operation_id: context.ownerId,
    ordered_date: '2026-11-15',
    items: [
      {
        kind: 'consumable' as const,
        description: 'Example needles',
        quantity: '1',
        unit_cost: '0.1234567890123456789',
        vial_ids: [],
      },
    ],
  };
  await createMedicationPurchase(body, context);
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: 'POST',
      body,
      serverConfig: config,
      logResponseBody: false,
    })
  );
  const { operation_id: _operation, ...values } = body;
  await updateMedicationPurchase(
    'invoice',
    { ...values, expected_revision: 4 },
    context
  );
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({
        expected_owner_id: context.ownerId,
        expected_revision: 4,
      }),
      serverConfig: config,
    })
  );
  await deleteMedicationPurchase(
    'invoice',
    { expected_owner_id: context.ownerId, expected_revision: 4 },
    context
  );
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: 'DELETE',
      body: { expected_owner_id: context.ownerId, expected_revision: 4 },
      serverConfig: config,
    })
  );
});

test('late identity from instance A cannot grant financial access after switching to instance B', async () => {
  let resolve!: (value: unknown) => void;
  jest.mocked(apiFetch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = getMedicationCostIdentity();
  await Promise.resolve();
  jest.mocked(getActiveServerConfig).mockResolvedValue({
    ...config,
    id: 'server-b',
    url: 'https://other.example.test',
  });
  resolve({
    authenticatedUserId: context.ownerId,
    activeUserId: context.ownerId,
  });
  await expect(pending).rejects.toThrow('account changed');
});

test('analytics sends only canonical report window plus bound owner, leaving ledger request independent', async () => {
  await getMedicationCostAnalytics(context, '3');
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      endpoint: `/api/v2/medication-purchases/analytics?expected_owner_id=${context.ownerId}&window=3`,
      serverConfig: config,
      logResponseBody: false,
    })
  );
  await listMedicationPurchases(context);
  expect(apiFetch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      endpoint: `/api/v2/medication-purchases?expected_owner_id=${context.ownerId}`,
    })
  );
});
