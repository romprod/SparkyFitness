import {
  latestPurchaseCurrency,
  purchaseDraft,
} from '../../src/utils/medicationPurchases';

const row = (currency: string, created_at: string) => ({
  currency,
  created_at,
});

describe('latestPurchaseCurrency', () => {
  test('is undefined with no invoices', () => {
    expect(latestPurchaseCurrency([])).toBeUndefined();
  });
  test('takes the currency of the newest invoice by created_at', () => {
    expect(
      latestPurchaseCurrency([
        row('AUD', '2026-01-01T00:00:00Z'),
        row('GBP', '2026-11-20T00:00:00Z'),
        row('EUR', '2026-11-10 09:00:00+00'),
      ])
    ).toBe('GBP');
  });
  test('ignores blank currencies', () => {
    expect(
      latestPurchaseCurrency([
        row(' ', '2026-11-20T00:00:00Z'),
        row('EUR', '2026-01-01T00:00:00Z'),
      ])
    ).toBe('EUR');
  });
});
test('a new draft has no currency until one is chosen', () => {
  expect(purchaseDraft().currency).toBe('');
});
