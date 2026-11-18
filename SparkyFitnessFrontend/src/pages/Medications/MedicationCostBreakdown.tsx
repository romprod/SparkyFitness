import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCostAnalytics,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { CostSection } from './MedicationCostSection';

function useCostFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const number = (value: string | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
          Number(value)
        );
  const money = (
    value: string | null,
    currency: string | null,
    mixed = false
  ) =>
    mixed || value === null || currency === null
      ? '—'
      : formatPurchaseMoney(value, currency);
  const warning = (
    <Badge
      variant="destructive"
      className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
    >
      {t(
        'medications.costReport.mixed',
        'Mixed currencies: affected figures are hidden.'
      )}
    </Badge>
  );
  return { t, locale, number, money, warning };
}

const BANDS = [
  { key: 'medication', swatch: 'bg-primary' },
  { key: 'consumables', swatch: 'bg-primary/40' },
  { key: 'overhead', swatch: 'bg-amber-500' },
] as const;

/** Horizontal stacked bars per month: medication, sundries, shipping and fees. */
export function MedicationSpendByMonth({
  data,
}: {
  data: MedicationCostAnalytics;
}) {
  const { t, locale, money, warning } = useCostFormat();
  const bandLabel: Record<(typeof BANDS)[number]['key'], string> = {
    medication: t('medications.costs.medication', 'Medication'),
    consumables: t('medications.costReport.sundriesBand', 'Sundries'),
    overhead: t('medications.costReport.overhead', 'Shipping & fees'),
  };
  const monthName = (month: string) => {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year!, monthIndex! - 1, 1)));
  };
  const monthly = data.monthly_spend;
  const currencies = new Set(
    monthly
      .map((row) => row.currency)
      .filter((currency): currency is string => currency !== null)
  );
  const mixed =
    currencies.size > 1 || monthly.some((row) => row.mixed_currency);
  const parts = (row: (typeof monthly)[number]) => ({
    medication: Math.max(0, Number(row.medication_subtotal ?? 0)),
    consumables: Math.max(0, Number(row.consumable_subtotal ?? 0)),
    overhead: Math.max(0, Number(row.overhead ?? 0)),
  });
  const sumOf = (row: (typeof monthly)[number]) => {
    const p = parts(row);
    return p.medication + p.consumables + p.overhead;
  };
  const widest = Math.max(1, ...monthly.map(sumOf));
  return (
    <CostSection
      title={t('medications.costReport.monthlyTitle', 'Spend by month')}
    >
      {'cost_basis' in data &&
        data.cost_basis === 'with_prescription_estimates' && (
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.costEstimates.monthlyCash',
              'Monthly bars and invoice totals show recorded invoice cash only; prescription estimates are excluded.'
            )}
          </p>
        )}
      {mixed && warning}
      {monthly.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.costReport.noInvoices',
            'No invoices in this window.'
          )}
        </p>
      ) : (
        <>
          <ul
            className="space-y-2"
            aria-label={t(
              'medications.costReport.monthlyTable',
              'Monthly invoice spend'
            )}
          >
            {monthly.map((row) => {
              const p = parts(row);
              const total = sumOf(row);
              const share = (value: number) =>
                total > 0 ? (value / total) * 100 : 0;
              const raw = {
                medication: row.medication_subtotal,
                consumables: row.consumable_subtotal,
                overhead: row.overhead,
              };
              return (
                <li key={row.month}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">
                      {monthName(row.month)}
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(row.total, row.currency, row.mixed_currency)}
                    </span>
                  </div>
                  {!mixed && (
                    <div
                      aria-hidden="true"
                      className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted"
                      style={{
                        width: `${Math.max(4, (total / widest) * 100)}%`,
                      }}
                    >
                      {BANDS.map((band) => (
                        <div
                          key={band.key}
                          className={band.swatch}
                          style={{ width: `${share(p[band.key])}%` }}
                        />
                      ))}
                    </div>
                  )}
                  <p className="sr-only">
                    {BANDS.map(
                      (band) =>
                        `${bandLabel[band.key]} ${money(raw[band.key], row.currency, row.mixed_currency)}. `
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {BANDS.map((band) => (
              <li key={band.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${band.swatch}`}
                />
                {bandLabel[band.key]}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.costReport.monthlyNote',
              'Invoice totals in the selected window. Shipping & fees includes tax and discounts; negative values remain below zero. Category totals include rounding adjustments.'
            )}
          </p>
        </>
      )}
    </CostSection>
  );
}

/** Consumables by category, with the modelled or amortised per-dose estimate. */
export function MedicationSundries({
  data,
}: {
  data: MedicationCostAnalytics;
}) {
  const { t, number, money, warning } = useCostFormat();
  const consumables = data.consumables;
  return (
    <CostSection
      title={t(
        'medications.costReport.consumablesTitle',
        'Sundries & consumables'
      )}
    >
      {(consumables.spend_mixed_currency ||
        consumables.cost_per_dose_mixed_currency) &&
        warning}
      {consumables.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'medications.costReport.noConsumables',
            'None recorded. Add needles, swabs, pen tips or a sharps container as consumable lines on an invoice to see their share of each dose.'
          )}
        </p>
      ) : (
        <>
          <ul
            className="space-y-3"
            aria-label={t(
              'medications.costReport.consumablesTable',
              'Consumable costs by category'
            )}
          >
            {consumables.rows.map((row) => (
              <li
                key={row.category}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="break-words">
                    {t(
                      `medications.costs.categories.${row.category}`,
                      row.category
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      'medications.costReport.piecesEach',
                      '{{pieces}} pieces · {{rate}} each',
                      {
                        pieces: number(row.pieces),
                        rate: row.spend_mixed_currency
                          ? '—'
                          : formatPurchaseRate(
                              row.cost_per_piece,
                              row.spend_currency
                            ),
                      }
                    )}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums">
                  {money(
                    row.spend,
                    row.spend_currency,
                    row.spend_mixed_currency
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {t(
                  'medications.costReport.perDoseEstimate',
                  'Per dose estimate'
                )}
              </span>
              <span className="font-semibold tabular-nums">
                {consumables.cost_per_dose_mixed_currency
                  ? '—'
                  : formatPurchaseRate(
                      consumables.cost_per_dose,
                      consumables.cost_per_dose_currency
                    )}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {consumables.cost_per_dose_basis === 'modelled'
                ? t(
                    'medications.costReport.modelledBasis',
                    'Modelled from landed cost per piece × declared units per dose. Declared lines included: {{included}}; lines without a positive units-per-dose value excluded: {{excluded}}.',
                    {
                      included: consumables.modelled_lines,
                      excluded: consumables.unmodelled_lines,
                    }
                  )
                : consumables.cost_per_dose_basis === 'amortised'
                  ? t(
                      'medications.costReport.amortisedBasis',
                      'Amortised: landed sundry spend in the invoice-date window ÷ {{count}} logged doses in the tracking-day window.',
                      { count: consumables.dose_count }
                    )
                  : t(
                      'medications.costReport.unavailableBasis',
                      'Estimate unavailable. A modelled estimate needs a positive units-per-dose value; an amortised estimate needs logged doses and one currency.'
                    )}
            </p>
          </div>
        </>
      )}
    </CostSection>
  );
}

/** Estimated value of mass never delivered from finished or discarded vials. */
export function MedicationWaste({ data }: { data: MedicationCostAnalytics }) {
  const { t, number, money, warning } = useCostFormat();
  const waste = data.waste;
  const valuedWaste = waste.rows.filter((row) => !row.value_unavailable);
  return (
    <CostSection
      title={t('medications.costReport.wasteTitle', 'Wasted product')}
    >
      {waste.mixed_currency && warning}
      <div>
        <p className="text-xl font-semibold tabular-nums">
          {money(
            waste.estimated_unused_value,
            waste.currency,
            waste.mixed_currency
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(
            'medications.costReport.wasteEstimate',
            'Current closed-stock unused value estimate'
          )}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.costReport.wasteBasis',
          'Uses all logged delivered history, independent of the selected window. Includes priced, labelled finished or discarded vials with at most 70% delivered. Sealed and in-use vials are excluded. This is a display rule, not a clinical threshold.'
        )}
      </p>
      {waste.unavailable_vials > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.costReport.wasteUnavailable',
            'Closed vials with missing cost, label or delivered history: {{count}}. The estimate excludes them.',
            { count: waste.unavailable_vials }
          )}
        </p>
      )}
      {valuedWaste.length > 0 && (
        <ul className="divide-y">
          {valuedWaste.slice(0, 6).map((row) => (
            <li
              key={row.vial_id}
              className="flex items-baseline justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="break-words font-medium">
                  {row.medication_name}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(
                    `medications.stock.status.${row.status}`,
                    row.status === 'finished' ? 'Finished' : 'Discarded'
                  )}{' '}
                  ·{' '}
                  {t(
                    'medications.costReport.unusedMass',
                    '{{mass}} mg estimated unused',
                    { mass: number(row.estimated_unused_mg) }
                  )}
                </span>
                {'cost_source' in row && row.cost_source === 'prescription' && (
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      'medications.costEstimates.prescriptionEstimate',
                      'Prescription estimate'
                    )}{' '}
                    · {t('medications.costEstimates.noShipping', 'no shipping')}
                  </span>
                )}
                {'cost_source' in row && row.cost_source === 'invoice' && (
                  <span className="block text-xs text-muted-foreground">
                    {t('medications.costs.invoice', 'Invoice')}
                  </span>
                )}
              </div>
              <span className="shrink-0 tabular-nums">
                {money(
                  row.estimated_unused_value,
                  row.currency,
                  row.value_unavailable
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {valuedWaste.length > 6 && (
        <p className="text-xs text-muted-foreground">
          {t(
            'medications.costReport.wasteFirstSix',
            'Showing six eligible closed vials.'
          )}
        </p>
      )}
    </CostSection>
  );
}
