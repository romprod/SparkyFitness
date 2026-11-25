import { latestMedicationCurrency } from '@/pages/Medications/lastUsedCurrency';

const row = (currency: string | null, created_at: string) => ({
  currency,
  created_at,
});

describe('latestMedicationCurrency', () => {
  it('is undefined with no prescriptions or invoices', () => {
    expect(latestMedicationCurrency()).toBeUndefined();
    expect(latestMedicationCurrency([], undefined)).toBeUndefined();
  });
  it('takes the newest created_at across both lists', () => {
    const prescriptions = [
      row('AUD', '2026-01-01T00:00:00Z'),
      row('GBP', '2026-11-20T09:00:00Z'),
    ];
    const invoices = [row('EUR', '2026-11-10T09:00:00Z')];
    expect(latestMedicationCurrency(prescriptions, invoices)).toBe('GBP');
    expect(
      latestMedicationCurrency(prescriptions, [
        row('USD', '2026-11-21T09:00:00Z'),
      ])
    ).toBe('USD');
  });
  it('reads Postgres-style offsets and ignores blank currencies', () => {
    expect(
      latestMedicationCurrency(
        [row(' ', '2026-11-22T00:00:00Z'), row(null, '2026-11-23T00:00:00Z')],
        [row(' gbp ', '2026-11-18 10:00:00+00')]
      )
    ).toBe('gbp');
  });
  it('lets an unparsable timestamp count only when nothing better exists', () => {
    expect(latestMedicationCurrency([row('GBP', 'not a date')])).toBe('GBP');
    expect(
      latestMedicationCurrency([
        row('GBP', 'not a date'),
        row('EUR', '2026-01-01T00:00:00Z'),
      ])
    ).toBe('EUR');
  });
});
