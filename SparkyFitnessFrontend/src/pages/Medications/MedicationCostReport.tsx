import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCostWindow,
} from '@workspace/shared';
import { useMedicationCostAnalytics } from '@/hooks/useMedicationPurchases';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MedicationSpendByMonth,
  MedicationSundries,
  MedicationWaste,
} from './MedicationCostBreakdown';
import { CostSection, CostStat } from './MedicationCostSection';
import MedicationPrescriptionEstimates, {
  PrescriptionAccountedLines,
} from './MedicationPrescriptionEstimates';

const WINDOWS: MedicationCostWindow[] = ['3', '6', '12', 'all'];

export default function MedicationCostReport({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation();
  const [window, setWindow] = useState<MedicationCostWindow>('12');
  const report = useMedicationCostAnalytics(ownerId, window, true);
  const mismatched = !!report.data && report.data.window.key !== window;
  const data =
    !report.isFetching && !report.isError && !mismatched
      ? report.data
      : undefined;
  const mixed = data?.rows.some(
    (row) => row.spend_mixed_currency || row.usage_mixed_currency
  );
  const mixedSpend = t(
    'medications.costReport.mixedSpend',
    'Spend is unavailable because its contributors use different currencies.'
  );
  const mixedUsage = t(
    'medications.costReport.mixedUsage',
    'Rates are unavailable because their contributors use different currencies.'
  );
  const summary = data?.summary;
  const accounted = data?.accounted;
  const single = accounted?.length === 1 ? accounted[0] : undefined;
  const total =
    single !== undefined
      ? { value: single.accounted_total, currency: single.currency }
      : accounted === undefined && summary?.invoice_total != null
        ? { value: summary.invoice_total, currency: summary.currency }
        : null;
  const dash = '—';
  const uncostedVials = summary
    ? summary.coverage.vials_total - summary.coverage.vials_costed
    : 0;
  const uncostedDoses = summary
    ? summary.coverage.doses_in_window - summary.coverage.doses_costed
    : 0;
  const windowLabel = (value: MedicationCostWindow) =>
    value === 'all' ? t('medications.costReport.all', 'All') : `${value}m`;
  return (
    <div className="space-y-6">
      <nav
        aria-label={t('medications.costReport.window', 'Reporting window')}
        className="flex flex-wrap gap-1"
      >
        {WINDOWS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={window === value ? 'default' : 'outline'}
            className="h-8 rounded-md px-3 text-xs"
            aria-pressed={window === value}
            onClick={() => setWindow(value)}
          >
            {windowLabel(value)}
          </Button>
        ))}
      </nav>
      {report.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('medications.costReport.loading', 'Loading cost report…')}
        </p>
      )}
      {(report.isError || mismatched) && (
        <div className="space-y-2">
          <Badge
            variant="destructive"
            className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
          >
            {t(
              'medications.costReport.loadFailed',
              'Could not load the cost report.'
            )}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => report.refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      )}
      {mixed && (
        <Badge
          variant="destructive"
          className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
        >
          {t(
            'medications.costReport.mixed',
            'Mixed currencies: affected figures are hidden.'
          )}
        </Badge>
      )}
      {data && summary && (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              {window === 'all'
                ? t('medications.costReport.allTime', 'All time')
                : t(
                    'medications.costReport.lastMonths',
                    'Last {{count}} months',
                    {
                      count: Number(window),
                    }
                  )}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <CostStat
                label={t('medications.costReport.totalSpend', 'Total spend')}
                value={
                  total && total.currency
                    ? formatPurchaseMoney(total.value, total.currency)
                    : dash
                }
                sub={
                  single && Number(single.prescription_estimate) > 0
                    ? t(
                        'medications.costReport.invoicesPlusScripts',
                        '{{count}} invoices + {{amount}} from prescriptions',
                        {
                          count: summary.invoice_count,
                          amount: formatPurchaseMoney(
                            single.prescription_estimate,
                            single.currency
                          ),
                        }
                      )
                    : t(
                        'medications.costReport.invoiceCount',
                        '{{count}} invoices',
                        { count: summary.invoice_count }
                      )
                }
              />
              <CostStat
                label={t(
                  'medications.costReport.perDoseTotal',
                  'Cost per dose'
                )}
                value={formatPurchaseRate(
                  summary.per_dose.total,
                  summary.per_dose.currency
                )}
                sub={
                  summary.per_dose.total === null
                    ? t(
                        'medications.costReport.perDoseNone',
                        'No costed doses yet'
                      )
                    : summary.per_dose.sundries !== null
                      ? t(
                          'medications.costReport.perDoseSplit',
                          'medication {{peptide}} + sundries {{sundries}} ({{basis}})',
                          {
                            peptide: formatPurchaseRate(
                              summary.per_dose.peptide,
                              summary.per_dose.currency
                            ),
                            sundries: formatPurchaseRate(
                              summary.per_dose.sundries,
                              summary.per_dose.currency
                            ),
                            basis: summary.per_dose.basis ?? '',
                          }
                        )
                      : t(
                          'medications.costReport.perDosePeptideOnly',
                          'medication only — no sundries recorded'
                        )
                }
              />
              <CostStat
                label={t('medications.costReport.overhead', 'Shipping & fees')}
                value={
                  summary.currency && summary.overhead_total !== null
                    ? formatPurchaseMoney(
                        summary.overhead_total,
                        summary.currency
                      )
                    : dash
                }
                sub={t(
                  'medications.costReport.overheadSub',
                  'shipping, tax and discounts'
                )}
              />
              <CostStat
                label={t('medications.costReport.runRate', 'Run rate')}
                value={
                  data.run_rate.mixed_currency ||
                  data.run_rate.per_month === null ||
                  data.run_rate.currency === null
                    ? dash
                    : t(
                        'medications.costReport.runRateValue',
                        '{{amount}} /mo',
                        {
                          amount: formatPurchaseMoney(
                            data.run_rate.per_month,
                            data.run_rate.currency
                          ),
                        }
                      )
                }
                sub={
                  data.run_rate.mixed_currency
                    ? t(
                        'medications.costReport.runRateMixed',
                        'Unavailable because costs use different currencies.'
                      )
                    : data.run_rate.months_of_data === 1
                      ? t(
                          'medications.costReport.runRateMonthsOne',
                          'over {{count}} month of use',
                          { count: 1 }
                        )
                      : t(
                          'medications.costReport.runRateMonthsOther',
                          'over {{count}} months of use',
                          { count: data.run_rate.months_of_data }
                        )
                }
              />
            </div>
          </section>
          {(uncostedVials > 0 || uncostedDoses > 0) && (
            <section
              role="note"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
            >
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {t('medications.costReport.partial', 'Figures are partial')}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800/90 dark:text-amber-300/90">
                {uncostedVials > 0 && (
                  <li>
                    {t(
                      'medications.costReport.partialVials',
                      '{{missing}} of {{total}} vials have no invoice line and no prescription cost — their doses are excluded, not counted as free.',
                      {
                        missing: uncostedVials,
                        total: summary.coverage.vials_total,
                      }
                    )}
                  </li>
                )}
                {uncostedDoses > 0 && (
                  <li>
                    {t(
                      'medications.costReport.partialDoses',
                      '{{missing}} of {{total}} doses in this window came from an uncosted or unlinked vial.',
                      {
                        missing: uncostedDoses,
                        total: summary.coverage.doses_in_window,
                      }
                    )}
                  </li>
                )}
              </ul>
            </section>
          )}
          <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
            <CostSection
              title={t('medications.costReport.title', 'By medication')}
              cardClassName="overflow-x-auto"
            >
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.costReport.note',
                  'Rates use current invoice or confirmed stock-linked prescription prices and vial label data. Prescription estimates exclude shipping; uncosted doses are excluded.'
                )}
              </p>
              {data.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.costReport.empty',
                    'Nothing bought or dosed in this reporting window.'
                  )}
                </p>
              ) : (
                <div
                  className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="region"
                  tabIndex={0}
                  aria-label={t(
                    'medications.costReport.table',
                    'Medication cost report'
                  )}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="min-w-32 pb-2 font-medium">
                          {t('medications.costs.medication', 'Medication')}
                        </th>
                        <th className="min-w-20 pb-2 text-right font-medium">
                          {t(
                            'medications.costEstimates.invoiceSpend',
                            'Invoice spend'
                          )}
                        </th>
                        <th className="min-w-20 pb-2 text-right font-medium">
                          {t('medications.costReport.perDose', 'Per dose')}
                        </th>
                        <th className="min-w-20 pb-2 text-right font-medium">
                          {t('medications.costReport.perMg', 'Per mg')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.medication_id} className="border-t">
                          <td className="py-2 pr-2">
                            <span className="break-words font-medium">
                              {row.medication_name}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {t(
                                'medications.costReport.counts',
                                '{{costed}} costed doses · {{uncosted}} uncosted',
                                {
                                  costed: row.costed_doses,
                                  uncosted: row.uncosted_doses,
                                }
                              )}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {t(
                                'medications.costEstimates.usageSources',
                                '{{invoice}} doses priced from invoices · {{prescription}} from prescription estimates',
                                {
                                  invoice: row.usage_sources.invoice,
                                  prescription: row.usage_sources.prescription,
                                }
                              )}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            <span
                              title={
                                row.spend_mixed_currency
                                  ? mixedSpend
                                  : undefined
                              }
                            >
                              {row.spend_present &&
                              row.spend !== null &&
                              row.spend_currency !== null &&
                              !row.spend_mixed_currency
                                ? formatPurchaseMoney(
                                    row.spend,
                                    row.spend_currency
                                  )
                                : dash}
                            </span>
                            {row.spend_mixed_currency && (
                              <span className="sr-only">{mixedSpend}</span>
                            )}
                            {row.accounted.some(
                              (bucket) => bucket.estimated_vials > 0
                            ) && (
                              <div className="mt-2">
                                <PrescriptionAccountedLines
                                  buckets={row.accounted}
                                />
                              </div>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            <span
                              title={
                                row.usage_mixed_currency
                                  ? mixedUsage
                                  : undefined
                              }
                            >
                              {row.usage_mixed_currency
                                ? dash
                                : formatPurchaseRate(
                                    row.cost_per_dose,
                                    row.usage_currency
                                  )}
                            </span>
                            {row.usage_mixed_currency && (
                              <span className="sr-only">{mixedUsage}</span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            <span
                              title={
                                row.usage_mixed_currency
                                  ? mixedUsage
                                  : undefined
                              }
                            >
                              {row.usage_mixed_currency
                                ? dash
                                : formatPurchaseRate(
                                    row.cost_per_mg,
                                    row.usage_currency
                                  )}
                            </span>
                            {row.usage_mixed_currency && (
                              <span className="sr-only">{mixedUsage}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CostSection>
            <MedicationSpendByMonth data={data} />
          </div>
          <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
            <MedicationSundries data={data} />
            <MedicationWaste data={data} />
          </div>
          <MedicationPrescriptionEstimates buckets={data.accounted} />
        </>
      )}
    </div>
  );
}
