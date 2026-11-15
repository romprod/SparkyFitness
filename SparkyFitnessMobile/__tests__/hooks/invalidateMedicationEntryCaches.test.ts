import { createTestQueryClient } from './queryTestUtils';
import { invalidateMedicationEntryCaches } from '../../src/hooks/invalidateMedicationEntryCaches';
test('stock and dose changes invalidate current-price reports and linked invoice views without inventing new values', () => {
  const client = createTestQueryClient();
  const report = [
      'medicationPurchases',
      'owner',
      'server',
      'https://example.test',
      'analytics',
      '12',
    ],
    stock = [
      'medicationPurchases',
      'owner',
      'server',
      'https://example.test',
      'vialCosts',
    ];
  client.setQueryData(report, { cost_per_dose: '0.123456789' });
  client.setQueryData(stock, { is_costed: true, landed_unit: '0' });
  invalidateMedicationEntryCaches(client);
  expect(client.getQueryState(report)?.isInvalidated).toBe(true);
  expect(client.getQueryState(stock)?.isInvalidated).toBe(true);
  expect(client.getQueryData(stock)).toEqual({
    is_costed: true,
    landed_unit: '0',
  });
  client.clear();
});
