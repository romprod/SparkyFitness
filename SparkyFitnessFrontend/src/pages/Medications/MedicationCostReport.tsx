import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPurchaseMoney,
  formatPurchaseRate,
  type MedicationCostWindow,
} from '@workspace/shared';
import { useMedicationCostAnalytics } from '@/hooks/useMedicationPurchases';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import MedicationCostBreakdown from './MedicationCostBreakdown';
import MedicationPrescriptionEstimates, {
  PrescriptionAccountedLines,
} from './MedicationPrescriptionEstimates';

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
  return (
    <>
      {data && <MedicationPrescriptionEstimates buckets={data.accounted} />}
      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('medications.costReport.runRate', 'Run rate')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {data.run_rate.mixed_currency ||
              data.run_rate.per_month === null ||
              data.run_rate.currency === null
                ? '—'
                : t('medications.costReport.runRateValue', '{{amount}} /mo', {
                    amount: formatPurchaseMoney(
                      data.run_rate.per_month,
                      data.run_rate.currency
                    ),
                  })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.run_rate.mixed_currency
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
                    )}
            </p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>
            {t('medications.costReport.title', 'By medication')}
          </CardTitle>
          <div
            role="group"
            aria-label={t('medications.costReport.window', 'Reporting window')}
            className="flex flex-wrap gap-1"
          >
            {(['3', '6', '12', 'all'] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={window === value ? 'secondary' : 'ghost'}
                aria-pressed={window === value}
                onClick={() => setWindow(value)}
              >
                {value === 'all'
                  ? t('medications.costReport.all', 'All')
                  : `${value}m`}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.costReport.note',
              'Rates use current invoice or confirmed stock-linked prescription prices and vial label data. Prescription estimates exclude shipping; uncosted doses are excluded.'
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => report.refetch()}
              >
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
          {data &&
            (data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.costReport.empty',
                  'Nothing bought or dosed in this reporting window.'
                )}
              </p>
            ) : (
              <div
                className="relative overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                role="region"
                tabIndex={0}
                aria-label={t(
                  'medications.costReport.table',
                  'Medication cost report'
                )}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="min-w-36 p-3 font-medium">
                        {t('medications.costs.medication', 'Medication')}
                      </th>
                      <th className="min-w-24 p-3 text-right font-medium">
                        {t(
                          'medications.costEstimates.invoiceSpend',
                          'Invoice spend'
                        )}
                      </th>
                      <th className="min-w-24 p-3 text-right font-medium">
                        {t('medications.costReport.perDose', 'Per dose')}
                      </th>
                      <th className="min-w-24 p-3 text-right font-medium">
                        {t('medications.costReport.perMg', 'Per mg')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr
                        key={row.medication_id}
                        className="border-b last:border-b-0"
                      >
                        <td className="p-3">
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
                        <td className="p-3 text-right tabular-nums">
                          <span
                            title={
                              row.spend_mixed_currency ? mixedSpend : undefined
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
                              : '—'}
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
                        <td className="p-3 text-right tabular-nums">
                          <span
                            title={
                              row.usage_mixed_currency ? mixedUsage : undefined
                            }
                          >
                            {row.usage_mixed_currency
                              ? '—'
                              : formatPurchaseRate(
                                  row.cost_per_dose,
                                  row.usage_currency
                                )}
                          </span>
                          {row.usage_mixed_currency && (
                            <span className="sr-only">{mixedUsage}</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          <span
                            title={
                              row.usage_mixed_currency ? mixedUsage : undefined
                            }
                          >
                            {row.usage_mixed_currency
                              ? '—'
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
            ))}
        </CardContent>
      </Card>
      {data && <MedicationCostBreakdown data={data} />}
    </>
  );
}
